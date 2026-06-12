import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { migrateStoredChatMode, type UserSettings } from "@/lib/schemas";
import { apps, chats, messages } from "@/db/schema";
import type { App, AppSearchResult, ListAppsResponse } from "../types/app";
import type { Chat } from "../types/chat";
import type {
  AppCollectionDto,
  CustomTheme,
  FreeAgentQuotaStatus,
  LanguageModel,
  LanguageModelProvider,
  McpListToolsResult,
  McpServer,
  McpToolConsent,
  InstallPnpmResult,
  NodeSystemInfo,
  PromptDto,
  SystemDebugInfo,
  Template,
  Theme,
  UserBudgetInfo,
  Version,
} from "../types";
import type { ProblemReport } from "../types/agent";
import type { ConsoleEntry } from "../types/supabase";
import type { BranchResult } from "../types/version";
import type {
  CheckoutVersionParams,
  RevertVersionParams,
  RevertVersionResponse,
} from "../types/version";
import type { ListAllMediaResponseSchema } from "../types/media";
import type { z } from "zod";

type AppRecord = typeof apps.$inferSelect;
type ListedChatRecord = Pick<
  typeof chats.$inferSelect,
  "id" | "appId" | "title" | "createdAt" | "chatMode"
>;
type ChatRecord = typeof chats.$inferSelect & {
  messages: (typeof messages.$inferSelect)[];
};
type MediaList = z.infer<typeof ListAllMediaResponseSchema>;

export interface LocalWebCoreServiceDependencies {
  findAppById(appId: number): Promise<AppRecord | undefined>;
  findChatWithMessagesById(chatId: number): Promise<ChatRecord | undefined>;
  listApps(): Promise<AppRecord[]>;
  listChats(appId?: number): Promise<ListedChatRecord[]>;
  findChatMetadataById(chatId: number): Promise<ListedChatRecord | undefined>;
  searchApps(query: string): Promise<AppSearchResult[]>;
  listPrompts(): Promise<PromptDto[]>;
  listAppCollections(): Promise<AppCollectionDto[]>;
  listCustomThemes(): Promise<CustomTheme[]>;
  listMcpServers(): Promise<McpServer[]>;
  listMcpToolConsents(): Promise<McpToolConsent[]>;
  listVersions(appId: number): Promise<Version[]>;
  getCurrentBranch(appId: number): Promise<BranchResult>;
  revertVersion(params: RevertVersionParams): Promise<RevertVersionResponse>;
  checkoutVersion(params: CheckoutVersionParams): Promise<void>;
  checkProblems(appId: number): Promise<ProblemReport>;
  addLog(entry: ConsoleEntry): void;
  clearLogs(appId: number): void;
  listAllMedia(): Promise<MediaList>;
  listAppScreenshots(
    appId: number,
  ): Promise<{ screenshots: { commitHash: string; url: string }[] }>;
  listAppThumbnails(
    appIds: number[],
  ): Promise<{ thumbnails: { appId: number; thumbnailUrl: string | null }[] }>;
  getCurrentCommitHash(appId: number): Promise<{ commitHash: string | null }>;
  saveAppScreenshot(params: {
    appId: number;
    dataUrl: string;
    commitHash: string;
  }): Promise<void>;
  resolveAppPath(appPath: string): string;
  listAppFiles(appPath: string): string[];
  normalizePath(path: string): string;
  readSettings(): UserSettings;
  writeSettings(settings: Partial<UserSettings>): void;
  getEnvVar(name: string): string | undefined;
  getSystemPlatform(): string;
  getAppVersion(): string;
  getCustomAppsFolder(): {
    path: string;
    isPathAvailable: boolean;
    isPathDefault: boolean;
  };
  getSystemDebugInfo(): Promise<SystemDebugInfo>;
  getNodejsStatus(): Promise<NodeSystemInfo>;
  installPnpm(): Promise<InstallPnpmResult>;
  getTemplates(): Promise<Template[]>;
  getThemes(): Promise<Theme[]>;
  getLanguageModelProviders(): Promise<LanguageModelProvider[]>;
  getLanguageModels(providerId: string): Promise<LanguageModel[]>;
  getLanguageModelsByProviders(): Promise<Record<string, LanguageModel[]>>;
  getFreeAgentQuotaStatus(): Promise<FreeAgentQuotaStatus>;
  getUserBudget(): Promise<UserBudgetInfo>;
  getAppTheme(appId: number): Promise<string | null>;
  listMcpTools(serverId: number): Promise<McpListToolsResult>;
  isMcpOauthStorageEncrypted(): Promise<{ available: boolean }>;
  probeMcpCallbackPort(): Promise<{ port: number }>;
  getSupabaseProjectName(
    projectId: string,
    organizationSlug?: string,
  ): Promise<string | null>;
  getVercelTeamSlug(teamId: string): Promise<string | null>;
  detectFrameworkType(appPath: string): AppFrameworkType | null;
  onRecoverableError?(message: string, error: unknown): void;
}

export class LocalWebCoreService {
  constructor(private readonly deps: LocalWebCoreServiceDependencies) {}

  async getApp(appId: number): Promise<App> {
    const app = await this.deps.findAppById(appId);

    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    const appPath = this.deps.resolveAppPath(app.path);
    const files = this.getNormalizedAppFiles(appId, appPath);

    return {
      ...app,
      files,
      frameworkType: this.deps.detectFrameworkType(appPath),
      resolvedPath: appPath,
      supabaseProjectName: await this.getSupabaseProjectName(app),
      vercelTeamSlug: await this.getVercelTeamSlug(app),
    };
  }

  async listApps(): Promise<ListAppsResponse> {
    const allApps = await this.deps.listApps();
    return {
      apps: allApps.map((app) => ({
        ...app,
        resolvedPath: this.deps.resolveAppPath(app.path),
      })),
    };
  }

  async searchApps(query: string): Promise<AppSearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }
    return this.deps.searchApps(trimmedQuery);
  }

  async getChat(chatId: number): Promise<Chat> {
    const chat = await this.deps.findChatWithMessagesById(chatId);

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    return {
      ...chat,
      title: chat.title ?? "",
      chatMode: migrateStoredChatMode(chat.chatMode ?? undefined) ?? null,
      messages: chat.messages.map((message) => ({
        ...message,
        role: message.role as "user" | "assistant",
        totalTokens: message.maxTokensUsed,
      })),
    };
  }

  async getChats(appId?: number) {
    const allChats = await this.deps.listChats(appId);
    return allChats.map((chat) => this.toChatMetadata(chat));
  }

  async getChatMetadata(chatId: number) {
    const chat = await this.deps.findChatMetadataById(chatId);
    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }
    return this.toChatMetadata(chat);
  }

  getSettings(): UserSettings {
    return this.deps.readSettings();
  }

  setSettings(settings: Partial<UserSettings>): UserSettings {
    this.deps.writeSettings(settings);
    return this.deps.readSettings();
  }

  async getEnvVars(): Promise<Record<string, string | undefined>> {
    const envVars: Record<string, string | undefined> = {};
    const providers = await this.deps.getLanguageModelProviders();
    for (const provider of providers) {
      if (provider.envVarName) {
        envVars[provider.envVarName] = this.deps.getEnvVar(provider.envVarName);
      }
    }
    return envVars;
  }

  getSystemPlatform(): string {
    return this.deps.getSystemPlatform();
  }

  getInitialLoadTelemetryContext(): { isFirstSession: boolean } {
    return { isFirstSession: false };
  }

  getSystemDebugInfo(): Promise<SystemDebugInfo> {
    return this.deps.getSystemDebugInfo();
  }

  getAppVersion(): { version: string } {
    return { version: this.deps.getAppVersion() };
  }

  getNodejsStatus(): Promise<NodeSystemInfo> {
    return this.deps.getNodejsStatus();
  }

  installPnpm(): Promise<InstallPnpmResult> {
    return this.deps.installPnpm();
  }

  getCustomAppsFolder() {
    return this.deps.getCustomAppsFolder();
  }

  getUserBudget(): Promise<UserBudgetInfo> {
    return this.deps.getUserBudget();
  }

  getTemplates(): Promise<Template[]> {
    return this.deps.getTemplates();
  }

  getThemes(): Promise<Theme[]> {
    return this.deps.getThemes();
  }

  getCustomThemes(): Promise<CustomTheme[]> {
    return this.deps.listCustomThemes();
  }

  getAppTheme(appId: number): Promise<string | null> {
    return this.deps.getAppTheme(appId);
  }

  listPrompts(): Promise<PromptDto[]> {
    return this.deps.listPrompts();
  }

  listAppCollections(): Promise<AppCollectionDto[]> {
    return this.deps.listAppCollections();
  }

  getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
    return this.deps.getLanguageModelProviders();
  }

  getLanguageModels(providerId: string): Promise<LanguageModel[]> {
    return this.deps.getLanguageModels(providerId);
  }

  getLanguageModelsByProviders(): Promise<Record<string, LanguageModel[]>> {
    return this.deps.getLanguageModelsByProviders();
  }

  getFreeAgentQuotaStatus(): Promise<FreeAgentQuotaStatus> {
    return this.deps.getFreeAgentQuotaStatus();
  }

  listVersions(appId: number): Promise<Version[]> {
    return this.deps.listVersions(appId);
  }

  getCurrentBranch(appId: number): Promise<BranchResult> {
    return this.deps.getCurrentBranch(appId);
  }

  revertVersion(params: RevertVersionParams): Promise<RevertVersionResponse> {
    return this.deps.revertVersion(params);
  }

  checkoutVersion(params: CheckoutVersionParams): Promise<void> {
    return this.deps.checkoutVersion(params);
  }

  checkProblems(appId: number): Promise<ProblemReport> {
    return this.deps.checkProblems(appId);
  }

  addLog(entry: ConsoleEntry): void {
    this.deps.addLog(entry);
  }

  clearLogs(appId: number): void {
    this.deps.clearLogs(appId);
  }

  listAppScreenshots(appId: number) {
    return this.deps.listAppScreenshots(appId);
  }

  listAppThumbnails(appIds: number[]) {
    return this.deps.listAppThumbnails(appIds);
  }

  getCurrentCommitHash(appId: number) {
    return this.deps.getCurrentCommitHash(appId);
  }

  saveAppScreenshot(params: {
    appId: number;
    dataUrl: string;
    commitHash: string;
  }) {
    return this.deps.saveAppScreenshot(params);
  }

  listAllMedia(): Promise<MediaList> {
    return this.deps.listAllMedia();
  }

  listMcpServers(): Promise<McpServer[]> {
    return this.deps.listMcpServers();
  }

  listMcpToolConsents(): Promise<McpToolConsent[]> {
    return this.deps.listMcpToolConsents();
  }

  listMcpTools(serverId: number): Promise<McpListToolsResult> {
    return this.deps.listMcpTools(serverId);
  }

  isMcpOauthStorageEncrypted(): Promise<{ available: boolean }> {
    return this.deps.isMcpOauthStorageEncrypted();
  }

  probeMcpCallbackPort(): Promise<{ port: number }> {
    return this.deps.probeMcpCallbackPort();
  }

  rendererErrorToastReady(): void {
    // Browser mode has no Electron WebContents. Keep the startup handshake a no-op.
  }

  private toChatMetadata(chat: ListedChatRecord) {
    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title,
      createdAt: chat.createdAt,
      chatMode: migrateStoredChatMode(chat.chatMode ?? undefined) ?? null,
    };
  }

  private getNormalizedAppFiles(appId: number, appPath: string): string[] {
    try {
      return this.deps
        .listAppFiles(appPath)
        .map((filePath) => this.deps.normalizePath(filePath));
    } catch (error) {
      this.deps.onRecoverableError?.(
        `Error reading files for app ${appId}:`,
        error,
      );
      return [];
    }
  }

  private async getSupabaseProjectName(app: AppRecord): Promise<string | null> {
    let supabaseProjectName: string | null = null;
    const settings = this.deps.readSettings();
    const hasSupabaseCredentials =
      (app.supabaseOrganizationSlug &&
        settings.supabase?.organizations?.[app.supabaseOrganizationSlug]
          ?.accessToken?.value) ||
      settings.supabase?.accessToken?.value;
    if (app.supabaseProjectId && hasSupabaseCredentials) {
      supabaseProjectName = await this.deps.getSupabaseProjectName(
        app.supabaseParentProjectId || app.supabaseProjectId,
        app.supabaseOrganizationSlug ?? undefined,
      );
    }
    return supabaseProjectName;
  }

  private async getVercelTeamSlug(app: AppRecord): Promise<string | null> {
    if (!app.vercelTeamId) {
      return null;
    }
    return this.deps.getVercelTeamSlug(app.vercelTeamId);
  }
}

export function createLocalWebCoreService(
  deps: LocalWebCoreServiceDependencies,
): LocalWebCoreService {
  return new LocalWebCoreService(deps);
}
