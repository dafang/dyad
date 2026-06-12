import path from "node:path";
import { spawn } from "node:child_process";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  AppChatContext,
  AppCollectionDto,
  AppFileSearchResult,
  AssignAppsParams,
  ChangeAppLocationResult,
  CopyAppParams,
  CreateAppParams,
  CreateAppResult,
  CreateCustomThemeParams,
  CreatePromptParamsDto,
  CustomTheme,
  DeleteMediaFileParams,
  EnvVar,
  ImportAppParams,
  ImportAppResult,
  MoveMediaFileParams,
  PromptDto,
  RenameMediaFileParams,
  UpdateCustomThemeParams,
  UpdatePromptParamsDto,
} from "@/ipc/types";
import type { ChatMode, UserSettings } from "@/lib/schemas";
import type { apps, chats } from "@/db/schema";
import { getMimeType, MIME_TYPE_MAP } from "@/ipc/utils/mime_utils";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { safeJoin } from "@/ipc/utils/path_utils";
import { INVALID_FILE_NAME_CHARS } from "@/shared/media_validation";
import { normalizePath } from "../../../shared/normalizePath";

const ENV_FILE_NAME = ".env.local";

type AppRecord = typeof apps.$inferSelect;
type ChatRecord = typeof chats.$inferSelect;

type AppInsert = Pick<
  typeof apps.$inferInsert,
  | "name"
  | "path"
  | "needsAppBlueprint"
  | "installCommand"
  | "startCommand"
  | "supabaseProjectId"
  | "githubOrg"
  | "githubRepo"
>;

type AppUpdate = Partial<
  Pick<
    typeof apps.$inferInsert,
    | "name"
    | "path"
    | "isFavorite"
    | "collectionId"
    | "chatContext"
    | "installCommand"
    | "startCommand"
    | "themeId"
  >
>;

type ChatInsert = Pick<
  typeof chats.$inferInsert,
  "appId" | "chatMode" | "initialCommitHash"
>;

type ChatUpdate = Partial<
  Pick<typeof chats.$inferInsert, "title" | "chatMode">
>;

export interface LocalWebMutationServiceDependencies {
  findAppById(appId: number): Promise<AppRecord | undefined>;
  findAppByName(name: string): Promise<AppRecord | undefined>;
  listApps(): Promise<AppRecord[]>;
  insertApp(values: AppInsert): Promise<AppRecord>;
  updateApp(appId: number, values: AppUpdate): Promise<AppRecord | undefined>;
  deleteApp(appId: number): Promise<void>;
  insertChat(values: ChatInsert): Promise<ChatRecord>;
  updateChat(chatId: number, values: ChatUpdate): Promise<void>;
  deleteChat(chatId: number): Promise<void>;
  deleteMessages(chatId: number): Promise<void>;
  searchChats(params: { appId: number; query: string }): Promise<
    {
      id: number;
      appId: number;
      title: string | null;
      createdAt: Date;
      matchedMessageContent: string | null;
    }[]
  >;
  listPrompts(): Promise<PromptDto[]>;
  insertPrompt(values: {
    title: string;
    description: string | null;
    content: string;
    slug: string | null;
  }): Promise<PromptDto>;
  updatePrompt(id: number, values: Partial<PromptDto>): Promise<void>;
  deletePrompt(id: number): Promise<void>;
  listAppCollections(): Promise<AppCollectionDto[]>;
  createAppCollection(params: {
    name: string;
    appIds?: number[];
  }): Promise<AppCollectionDto>;
  updateAppCollection(params: {
    id: number;
    name: string;
    appIds?: number[];
  }): Promise<void>;
  deleteAppCollection(id: number): Promise<void>;
  assignApps(params: AssignAppsParams): Promise<void>;
  listCustomThemes(): Promise<CustomTheme[]>;
  findCustomThemeById(id: number): Promise<CustomTheme | undefined>;
  findCustomThemeByName(
    name: string,
    excludeId?: number,
  ): Promise<CustomTheme | undefined>;
  insertCustomTheme(values: {
    name: string;
    description: string | null;
    prompt: string;
  }): Promise<CustomTheme>;
  updateCustomTheme(
    id: number,
    values: Partial<Pick<CustomTheme, "name" | "description" | "prompt">>,
  ): Promise<CustomTheme | undefined>;
  deleteCustomTheme(id: number): Promise<void>;
  resolveAppPath(appPath: string): string;
  getScaffoldPath(): string;
  isDirectoryAccessible(directory: string): boolean;
  readSettings(): UserSettings;
  copyPath(
    source: string,
    destination: string,
    options?: { excludeNodeModules?: boolean; excludeGit?: boolean },
  ): Promise<void>;
  ensureDirectory(directory: string): Promise<void>;
  removePath(targetPath: string): Promise<void>;
  renamePath(source: string, destination: string): Promise<void>;
  pathExists(targetPath: string): Promise<boolean>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  listDirectory(
    directory: string,
  ): Promise<{ name: string; isFile(): boolean; isDirectory(): boolean }[]>;
  stat(filePath: string): Promise<{ size: number }>;
  unlink(filePath: string): Promise<void>;
  gitInit(appPath: string): Promise<void>;
  gitAdd(appPath: string, filePath: string): Promise<void>;
  gitCommit(appPath: string, message: string): Promise<string | null>;
  getCurrentCommitHash(appPath: string): Promise<string | null>;
  searchFiles(appPath: string, query: string): Promise<AppFileSearchResult[]>;
}

export class LocalWebMutationService {
  constructor(private readonly deps: LocalWebMutationServiceDependencies) {}

  async createApp(params: CreateAppParams): Promise<CreateAppResult> {
    const appName = assertAppName(params.name);
    const appPath = appName;
    const fullAppPath = this.deps.resolveAppPath(appPath);

    assertRelativeAppPath(appPath);
    await this.assertDestinationAvailable(fullAppPath);

    const settings = this.deps.readSettings();
    const app = await this.deps.insertApp({
      name: appName,
      path: appPath,
      needsAppBlueprint: settings.enableAppBlueprint ?? true,
    });

    let chat: ChatRecord;
    try {
      await this.deps.copyPath(this.deps.getScaffoldPath(), fullAppPath, {
        excludeNodeModules: true,
      });
      await ensureDyadGitignored(fullAppPath, this.deps);
      await this.deps.gitInit(fullAppPath);
      await this.deps.gitAdd(fullAppPath, ".");
      const commitHash = await this.deps.gitCommit(
        fullAppPath,
        "Init Dyad app",
      );
      chat = await this.deps.insertChat({
        appId: app.id,
        chatMode: resolveInitialChatMode(params.initialChatMode, settings),
        initialCommitHash: commitHash,
      });
    } catch (error) {
      await this.bestEffortCleanupCreatedApp(app.id, fullAppPath);
      throw classifyExternal("Failed to create app", error);
    }

    return {
      app: { ...app, resolvedPath: fullAppPath },
      chatId: chat.id,
    };
  }

  async copyApp(params: CopyAppParams) {
    const newAppName = assertAppName(params.newAppName);
    if (await this.deps.findAppByName(newAppName)) {
      throw new DyadError(
        `An app named "${newAppName}" already exists.`,
        DyadErrorKind.Conflict,
      );
    }

    const originalApp = await this.getAppOrThrow(params.appId, "Original app");
    const originalAppPath = this.deps.resolveAppPath(originalApp.path);
    const newAppPath = this.deps.resolveAppPath(newAppName);
    await this.assertDestinationAvailable(newAppPath);

    try {
      await this.deps.copyPath(originalAppPath, newAppPath, {
        excludeNodeModules: true,
        excludeGit: !params.withHistory,
      });
      if (!params.withHistory) {
        await this.deps.gitInit(newAppPath);
        await this.deps.gitAdd(newAppPath, ".");
        await this.deps.gitCommit(newAppPath, "Init Dyad app");
      }
    } catch (error) {
      await bestEffort(() => this.deps.removePath(newAppPath));
      throw classifyExternal("Failed to copy app directory", error);
    }

    const app = await this.deps.insertApp({
      name: newAppName,
      path: newAppName,
      supabaseProjectId: null,
      githubOrg: null,
      githubRepo: null,
      installCommand: originalApp.installCommand,
      startCommand: originalApp.startCommand,
    });

    return {
      app: { ...app, resolvedPath: newAppPath },
    };
  }

  async deleteApp(appId: number): Promise<void> {
    const app = await this.getAppOrThrow(appId);
    await this.deps.deleteApp(appId);
    await this.deps.removePath(this.deps.resolveAppPath(app.path));
  }

  async deleteApps(appIds: number[]) {
    const results: { appId: number; success: boolean; error?: string }[] = [];
    await Promise.all(
      appIds.map(async (appId) => {
        try {
          await this.deleteApp(appId);
          results.push({ appId, success: true });
        } catch (error) {
          results.push({
            appId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    return { results };
  }

  async renameApp(params: {
    appId: number;
    appName: string;
    appPath: string;
  }): Promise<void> {
    const appName = assertAppName(params.appName);
    const appPath = assertAppPathName(params.appPath);
    const app = await this.getAppOrThrow(params.appId);
    const pathChanged = app.path !== appPath;

    if (pathChanged && path.isAbsolute(appPath)) {
      throw new DyadError(
        "Absolute paths are not allowed when renaming an app folder.",
        DyadErrorKind.Validation,
      );
    }

    const nameConflict = await this.deps.findAppByName(appName);
    if (nameConflict && nameConflict.id !== params.appId) {
      throw new DyadError(
        `An app with the name '${appName}' already exists`,
        DyadErrorKind.Conflict,
      );
    }

    const oldAbsPath = this.deps.resolveAppPath(app.path);
    const newAbsPath = path.isAbsolute(app.path)
      ? path.join(path.dirname(app.path), appPath)
      : this.deps.resolveAppPath(appPath);

    if (pathChanged) {
      await this.assertNoAppPathConflict(params.appId, newAbsPath);
      if (await this.deps.pathExists(newAbsPath)) {
        throw new DyadError(
          `Destination path '${newAbsPath}' already exists`,
          DyadErrorKind.Conflict,
        );
      }
      await this.deps.ensureDirectory(path.dirname(newAbsPath));
      try {
        await this.deps.copyPath(oldAbsPath, newAbsPath, {
          excludeNodeModules: true,
        });
      } catch (error) {
        await bestEffort(() => this.deps.removePath(newAbsPath));
        throw classifyExternal("Failed to move app files", error);
      }
    }

    try {
      await this.deps.updateApp(params.appId, {
        name: appName,
        path: path.isAbsolute(app.path) ? newAbsPath : appPath,
      });
    } catch (error) {
      if (pathChanged) {
        await bestEffort(() => this.deps.copyPath(newAbsPath, oldAbsPath));
        await bestEffort(() => this.deps.removePath(newAbsPath));
      }
      throw classifyExternal("Failed to update app in database", error);
    }

    if (pathChanged) {
      await bestEffort(() => this.deps.removePath(oldAbsPath));
    }
  }

  async toggleFavorite(appId: number): Promise<{ isFavorite: boolean }> {
    const app = await this.getAppOrThrow(appId);
    const updated = await this.deps.updateApp(appId, {
      isFavorite: !app.isFavorite,
    });
    if (!updated) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }
    return { isFavorite: updated.isFavorite };
  }

  async changeAppLocation(params: {
    appId: number;
    parentDirectory: string;
  }): Promise<ChangeAppLocationResult> {
    if (!params.parentDirectory || !path.isAbsolute(params.parentDirectory)) {
      throw new DyadError(
        "Please select an absolute destination folder.",
        DyadErrorKind.Validation,
      );
    }

    const app = await this.getAppOrThrow(params.appId);
    const normalizedParentDirectory = path.normalize(params.parentDirectory);
    const currentResolvedPath = this.deps.resolveAppPath(app.path);
    const appFolderName = path.basename(
      path.isAbsolute(app.path) ? app.path : currentResolvedPath,
    );
    const nextResolvedPath = path.join(
      normalizedParentDirectory,
      appFolderName,
    );

    if (currentResolvedPath === nextResolvedPath) {
      if (!path.isAbsolute(app.path)) {
        await this.deps.updateApp(params.appId, { path: nextResolvedPath });
      }
      return { resolvedPath: nextResolvedPath };
    }

    await this.assertNoAppPathConflict(params.appId, nextResolvedPath);
    if (await this.deps.pathExists(nextResolvedPath)) {
      throw new DyadError(
        `Destination path '${nextResolvedPath}' already exists. Please choose an empty folder.`,
        DyadErrorKind.Conflict,
      );
    }

    if (!(await this.deps.pathExists(currentResolvedPath))) {
      await this.deps.updateApp(params.appId, { path: nextResolvedPath });
      return { resolvedPath: nextResolvedPath };
    }

    await this.deps.ensureDirectory(normalizedParentDirectory);
    try {
      await this.deps.copyPath(currentResolvedPath, nextResolvedPath, {
        excludeNodeModules: true,
      });
      await this.deps.updateApp(params.appId, { path: nextResolvedPath });
      await bestEffort(() => this.deps.removePath(currentResolvedPath));
      return { resolvedPath: nextResolvedPath };
    } catch (error) {
      await bestEffort(() => this.deps.removePath(nextResolvedPath));
      throw classifyExternal("Failed to move app files", error);
    }
  }

  async updateAppCommands(params: {
    appId: number;
    installCommand: string | null;
    startCommand: string | null;
  }): Promise<void> {
    await this.getAppOrThrow(params.appId);
    const installCommand = params.installCommand?.trim() || null;
    const startCommand = params.startCommand?.trim() || null;

    if ((installCommand === null) !== (startCommand === null)) {
      throw new DyadError(
        "Both install and start commands are required when customizing",
        DyadErrorKind.Validation,
      );
    }

    await this.deps.updateApp(params.appId, {
      installCommand,
      startCommand,
    });
  }

  async checkAppName(appName: string, skipCopy = false) {
    const trimmed = assertAppName(appName);
    if (!skipCopy) {
      const appPath = this.deps.resolveAppPath(trimmed);
      if (await this.deps.pathExists(appPath)) {
        return { exists: true };
      }
    }
    return { exists: Boolean(await this.deps.findAppByName(trimmed)) };
  }

  async importApp(params: ImportAppParams): Promise<ImportAppResult> {
    const appName = assertAppName(params.appName);
    const sourcePath = path.resolve(params.path);
    if (!(await this.deps.pathExists(sourcePath))) {
      throw new DyadError(
        "Source folder does not exist",
        DyadErrorKind.NotFound,
      );
    }

    const appPath = params.skipCopy
      ? sourcePath
      : this.deps.resolveAppPath(appName);
    if (!params.skipCopy) {
      await this.assertDestinationAvailable(appPath);
      await this.deps.copyPath(sourcePath, appPath, {
        excludeNodeModules: true,
      });
    }

    if (!(await this.deps.pathExists(path.join(appPath, ".git")))) {
      await this.deps.gitInit(appPath);
      await this.deps.gitAdd(appPath, ".");
      await this.deps.gitCommit(appPath, "Init Dyad app");
    }

    const app = await this.deps.insertApp({
      name: appName,
      path: params.skipCopy ? sourcePath : appName,
      installCommand: params.installCommand?.trim() || null,
      startCommand: params.startCommand?.trim() || null,
    });
    const chat = await this.deps.insertChat({
      appId: app.id,
      chatMode: resolveInitialChatMode(undefined, this.deps.readSettings()),
      initialCommitHash: await this.deps.getCurrentCommitHash(appPath),
    });
    return { appId: app.id, chatId: chat.id };
  }

  async checkAiRules(appPath: string): Promise<{ exists: boolean }> {
    return {
      exists: await this.deps.pathExists(path.join(appPath, "AI_RULES.md")),
    };
  }

  selectAppFolder() {
    return { path: null, name: null };
  }

  selectAppLocation() {
    return { path: null, canceled: true };
  }

  async createChat(
    input: number | { appId: number; initialChatMode?: ChatMode },
  ): Promise<number> {
    const { appId, initialChatMode } =
      typeof input === "number"
        ? { appId: input, initialChatMode: undefined }
        : input;
    const app = await this.getAppOrThrow(appId);
    const chat = await this.deps.insertChat({
      appId,
      chatMode: resolveInitialChatMode(
        initialChatMode,
        this.deps.readSettings(),
      ),
      initialCommitHash: await this.deps.getCurrentCommitHash(
        this.deps.resolveAppPath(app.path),
      ),
    });
    return chat.id;
  }

  async updateChat(params: {
    chatId: number;
    title?: string;
    chatMode?: ChatMode | null;
  }): Promise<void> {
    const updates: ChatUpdate = {};
    if (params.title !== undefined) {
      updates.title = params.title;
    }
    if (params.chatMode !== undefined) {
      updates.chatMode = params.chatMode;
    }
    if (Object.keys(updates).length === 0) return;
    await this.deps.updateChat(params.chatId, updates);
  }

  async deleteChat(chatId: number): Promise<void> {
    await this.deps.deleteChat(chatId);
  }

  async deleteMessages(chatId: number): Promise<void> {
    await this.deps.deleteMessages(chatId);
  }

  searchChats(params: { appId: number; query: string }) {
    return this.deps.searchChats(params);
  }

  async readAppFile(params: {
    appId: number;
    filePath: string;
  }): Promise<string> {
    const app = await this.getAppOrThrow(params.appId);
    const fullPath = this.safeAppPath(app, params.filePath);
    if (!(await this.deps.pathExists(fullPath))) {
      throw new DyadError("File not found", DyadErrorKind.NotFound);
    }
    return this.deps.readTextFile(fullPath);
  }

  async editAppFile(params: {
    appId: number;
    filePath: string;
    content: string;
  }): Promise<{ warning?: string }> {
    const app = await this.getAppOrThrow(params.appId);
    const filePath = normalizePath(params.filePath);
    const fullPath = this.safeAppPath(app, filePath);
    await this.deps.ensureDirectory(path.dirname(fullPath));
    await this.deps.writeTextFile(fullPath, params.content);

    const appPath = this.deps.resolveAppPath(app.path);
    if (await this.deps.pathExists(path.join(appPath, ".git"))) {
      await this.deps.gitAdd(appPath, filePath);
      await this.deps.gitCommit(appPath, `Updated ${filePath}`);
    }
    return {};
  }

  async searchAppFiles(params: {
    appId: number;
    query: string;
  }): Promise<AppFileSearchResult[]> {
    const query = params.query.trim();
    if (!query) return [];
    const app = await this.getAppOrThrow(params.appId);
    return this.deps.searchFiles(this.deps.resolveAppPath(app.path), query);
  }

  getAppEnvVars(appId: number): Promise<EnvVar[]> {
    return this.readEnvVars(appId);
  }

  async setAppEnvVars(appId: number, envVars: EnvVar[]): Promise<void> {
    const app = await this.getAppOrThrow(appId);
    const envFilePath = path.join(
      this.deps.resolveAppPath(app.path),
      ENV_FILE_NAME,
    );
    await this.deps.writeTextFile(envFilePath, serializeEnvFile(envVars));
  }

  async getContextPaths(appId: number) {
    const app = await this.getAppOrThrow(appId);
    const context = normalizeChatContext(app.chatContext);
    const emptyStats = (items: { globPath: string }[]) =>
      items.map((item) => ({ ...item, files: 0, tokens: 0 }));
    return {
      contextPaths: emptyStats(context.contextPaths),
      smartContextAutoIncludes: emptyStats(context.smartContextAutoIncludes),
      excludePaths: emptyStats(context.excludePaths ?? []),
    };
  }

  async setContextPaths(params: {
    appId: number;
    chatContext: AppChatContext;
  }): Promise<void> {
    await this.getAppOrThrow(params.appId);
    await this.deps.updateApp(params.appId, {
      chatContext: params.chatContext,
    });
  }

  listPrompts(): Promise<PromptDto[]> {
    return this.deps.listPrompts();
  }

  async createPrompt(params: CreatePromptParamsDto): Promise<PromptDto> {
    const title = params.title.trim();
    const content = params.content.trim();
    if (!title || !content) {
      throw new DyadError(
        "Title and content are required",
        DyadErrorKind.Validation,
      );
    }
    return this.deps.insertPrompt({
      title,
      description: params.description?.trim() || null,
      content,
      slug: params.slug ?? null,
    });
  }

  async updatePrompt(params: UpdatePromptParamsDto): Promise<void> {
    await this.deps.updatePrompt(params.id, {
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.description !== undefined
        ? { description: params.description }
        : {}),
      ...(params.content !== undefined ? { content: params.content } : {}),
      ...(params.slug !== undefined ? { slug: params.slug ?? null } : {}),
      updatedAt: new Date(),
    });
  }

  deletePrompt(id: number): Promise<void> {
    return this.deps.deletePrompt(id);
  }

  listAppCollections(): Promise<AppCollectionDto[]> {
    return this.deps.listAppCollections();
  }

  async createAppCollection(params: {
    name: string;
    appIds?: number[];
  }): Promise<AppCollectionDto> {
    const name = assertRequiredName(params.name, "Collection name is required");
    return this.deps.createAppCollection({ name, appIds: params.appIds });
  }

  async updateAppCollection(params: {
    id: number;
    name: string;
    appIds?: number[];
  }): Promise<void> {
    const name = assertRequiredName(params.name, "Collection name is required");
    await this.deps.updateAppCollection({
      id: params.id,
      name,
      appIds: params.appIds,
    });
  }

  deleteAppCollection(id: number): Promise<void> {
    return this.deps.deleteAppCollection(id);
  }

  assignApps(params: AssignAppsParams): Promise<void> {
    return this.deps.assignApps(params);
  }

  async setAppTheme(params: {
    appId: number;
    themeId: string | null;
  }): Promise<void> {
    await this.getAppOrThrow(params.appId);
    await this.deps.updateApp(params.appId, { themeId: params.themeId });
  }

  listCustomThemes(): Promise<CustomTheme[]> {
    return this.deps.listCustomThemes();
  }

  async createCustomTheme(
    params: CreateCustomThemeParams,
  ): Promise<CustomTheme> {
    const values = await this.validateCustomThemeCreate(params);
    return this.deps.insertCustomTheme(values);
  }

  async updateCustomTheme(
    params: UpdateCustomThemeParams,
  ): Promise<CustomTheme> {
    const existing = await this.deps.findCustomThemeById(params.id);
    if (!existing) {
      throw new DyadError("Theme not found", DyadErrorKind.NotFound);
    }

    const values: Partial<
      Pick<CustomTheme, "name" | "description" | "prompt">
    > = {};
    if (params.name !== undefined) {
      values.name = await this.validateCustomThemeName(params.name, params.id);
    }
    if (params.description !== undefined) {
      values.description = validateCustomThemeDescription(params.description);
    }
    if (params.prompt !== undefined) {
      values.prompt = validateCustomThemePrompt(params.prompt);
    }

    const updated = await this.deps.updateCustomTheme(params.id, values);
    if (!updated) {
      throw new DyadError("Theme not found", DyadErrorKind.NotFound);
    }
    return updated;
  }

  deleteCustomTheme(id: number): Promise<void> {
    return this.deps.deleteCustomTheme(id);
  }

  async renameMediaFile(params: RenameMediaFileParams): Promise<void> {
    const app = await this.getAppOrThrow(params.appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const sourcePath = getMediaFilePath(appPath, params.fileName);
    const extension = assertSupportedMediaExtension(params.fileName);
    const newBaseName = assertSafeBaseName(params.newBaseName);
    const destinationFileName = `${newBaseName}${extension}`;
    assertSafeFileName(destinationFileName);

    if (destinationFileName === params.fileName) {
      throw new DyadError(
        "New image name must be different from current name",
        DyadErrorKind.Validation,
      );
    }

    const destinationPath = safeJoin(
      appPath,
      DYAD_MEDIA_DIR_NAME,
      destinationFileName,
    );
    const isCaseOnlyRename =
      destinationFileName.toLowerCase() === params.fileName.toLowerCase();
    if (!isCaseOnlyRename && (await this.deps.pathExists(destinationPath))) {
      throw new DyadError(
        "A media file with that name already exists",
        DyadErrorKind.Conflict,
      );
    }

    try {
      await this.deps.renamePath(sourcePath, destinationPath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new DyadError("Media file not found", DyadErrorKind.NotFound);
      }
      throw error;
    }
  }

  async deleteMediaFile(params: DeleteMediaFileParams): Promise<void> {
    const app = await this.getAppOrThrow(params.appId);
    const filePath = getMediaFilePath(
      this.deps.resolveAppPath(app.path),
      params.fileName,
    );
    try {
      await this.deps.unlink(filePath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
  }

  async moveMediaFile(params: MoveMediaFileParams): Promise<void> {
    if (params.sourceAppId === params.targetAppId) {
      throw new DyadError(
        "Source and target apps must be different",
        DyadErrorKind.Validation,
      );
    }

    const sourceApp = await this.getAppOrThrow(params.sourceAppId);
    const targetApp = await this.getAppOrThrow(params.targetAppId);
    const sourcePath = getMediaFilePath(
      this.deps.resolveAppPath(sourceApp.path),
      params.fileName,
    );
    if (!(await this.deps.pathExists(sourcePath))) {
      throw new DyadError("Media file not found", DyadErrorKind.NotFound);
    }

    const targetAppPath = this.deps.resolveAppPath(targetApp.path);
    const targetMediaDirectory = path.join(targetAppPath, DYAD_MEDIA_DIR_NAME);
    await ensureDyadGitignored(targetAppPath, this.deps);
    await this.deps.ensureDirectory(targetMediaDirectory);

    const destinationPath = safeJoin(
      targetAppPath,
      DYAD_MEDIA_DIR_NAME,
      params.fileName,
    );
    if (await this.deps.pathExists(destinationPath)) {
      throw new DyadError(
        `Target app already has a media file named "${params.fileName}"`,
        DyadErrorKind.Conflict,
      );
    }

    try {
      await this.deps.renamePath(sourcePath, destinationPath);
    } catch (error) {
      if (isErrno(error, "EXDEV")) {
        await this.deps.copyPath(sourcePath, destinationPath);
        await this.deps.unlink(sourcePath);
        return;
      }
      if (isErrno(error, "ENOENT")) {
        throw new DyadError("Media file not found", DyadErrorKind.NotFound);
      }
      throw error;
    }
  }

  async listAllMedia() {
    const allApps = await this.deps.listApps();
    const appResults = await Promise.all(
      allApps.map(async (app) => {
        const appPath = this.deps.resolveAppPath(app.path);
        const files = await getMediaFilesForApp(
          app.id,
          app.name,
          appPath,
          this.deps,
        );
        if (files.length === 0) return null;
        return {
          appId: app.id,
          appName: app.name,
          appPath,
          files,
        };
      }),
    );
    return { apps: appResults.filter((result) => result !== null) };
  }

  private async getAppOrThrow(
    appId: number,
    label = "App",
  ): Promise<AppRecord> {
    const app = await this.deps.findAppById(appId);
    if (!app) {
      throw new DyadError(`${label} not found`, DyadErrorKind.NotFound);
    }
    return app;
  }

  private safeAppPath(app: AppRecord, filePath: string): string {
    return safeJoin(
      this.deps.resolveAppPath(app.path),
      normalizePath(filePath),
    );
  }

  private async assertDestinationAvailable(destinationPath: string) {
    if (!this.deps.isDirectoryAccessible(path.dirname(destinationPath))) {
      throw new DyadError(
        `The path ${destinationPath} is inaccessible. Please check your custom apps folder setting.`,
        DyadErrorKind.Precondition,
      );
    }
    if (await this.deps.pathExists(destinationPath)) {
      throw new DyadError(
        `App already exists at: ${destinationPath}`,
        DyadErrorKind.Conflict,
      );
    }
  }

  private async assertNoAppPathConflict(appId: number, resolvedPath: string) {
    const allApps = await this.deps.listApps();
    const conflict = allApps.some(
      (app) =>
        app.id !== appId && this.deps.resolveAppPath(app.path) === resolvedPath,
    );
    if (conflict) {
      throw new DyadError(
        `An app with the path '${resolvedPath}' already exists`,
        DyadErrorKind.Conflict,
      );
    }
  }

  private async bestEffortCleanupCreatedApp(appId: number, appPath: string) {
    await bestEffort(() => this.deps.deleteApp(appId));
    await bestEffort(() => this.deps.removePath(appPath));
  }

  private async readEnvVars(appId: number): Promise<EnvVar[]> {
    const app = await this.getAppOrThrow(appId);
    const envFilePath = path.join(
      this.deps.resolveAppPath(app.path),
      ENV_FILE_NAME,
    );
    if (!(await this.deps.pathExists(envFilePath))) {
      return [];
    }
    return parseEnvFile(await this.deps.readTextFile(envFilePath));
  }

  private async validateCustomThemeCreate(params: CreateCustomThemeParams) {
    return {
      name: await this.validateCustomThemeName(params.name),
      description: validateCustomThemeDescription(params.description),
      prompt: validateCustomThemePrompt(params.prompt),
    };
  }

  private async validateCustomThemeName(name: string, excludeId?: number) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new DyadError("Theme name is required", DyadErrorKind.Validation);
    }
    if (trimmedName.length > 100) {
      throw new DyadError(
        "Theme name must be less than 100 characters",
        DyadErrorKind.Validation,
      );
    }
    if (await this.deps.findCustomThemeByName(trimmedName, excludeId)) {
      throw new DyadError(
        `A theme named "${trimmedName}" already exists. Please choose a different name.`,
        DyadErrorKind.Conflict,
      );
    }
    return trimmedName;
  }
}

export function createLocalWebMutationService(
  deps: LocalWebMutationServiceDependencies,
): LocalWebMutationService {
  return new LocalWebMutationService(deps);
}

function assertAppName(name: string): string {
  return assertRequiredName(name, "App name is required");
}

function assertAppPathName(appPath: string): string {
  const trimmed = assertRequiredName(appPath, "App path is required");
  assertRelativeAppPath(trimmed);
  return trimmed;
}

function assertRelativeAppPath(appPath: string): void {
  if (path.isAbsolute(appPath)) {
    throw new DyadError(
      "App path must be relative for this operation",
      DyadErrorKind.Validation,
    );
  }
  const invalidChars = /[<>:"|?*/\\]/;
  if (invalidChars.test(appPath) || /[\x00-\x1f]/.test(appPath)) {
    throw new DyadError(
      `App path "${appPath}" contains characters that are not allowed in folder names.`,
      DyadErrorKind.Validation,
    );
  }
}

function assertRequiredName(name: string, message: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DyadError(message, DyadErrorKind.Validation);
  }
  return trimmed;
}

function resolveInitialChatMode(
  initialChatMode: ChatMode | undefined,
  settings: UserSettings,
): ChatMode {
  return initialChatMode ?? settings.selectedChatMode ?? "build";
}

function normalizeChatContext(value: unknown): AppChatContext {
  if (value && typeof value === "object") {
    const context = value as Partial<AppChatContext>;
    return {
      contextPaths: Array.isArray(context.contextPaths)
        ? context.contextPaths
        : [],
      smartContextAutoIncludes: Array.isArray(context.smartContextAutoIncludes)
        ? context.smartContextAutoIncludes
        : [],
      excludePaths: Array.isArray(context.excludePaths)
        ? context.excludePaths
        : [],
    };
  }
  return {
    contextPaths: [],
    smartContextAutoIncludes: [],
    excludePaths: [],
  };
}

function validateCustomThemeDescription(description: string | undefined) {
  const trimmed = description?.trim();
  if (trimmed && trimmed.length > 500) {
    throw new DyadError(
      "Theme description must be less than 500 characters",
      DyadErrorKind.Validation,
    );
  }
  return trimmed || null;
}

function validateCustomThemePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new DyadError("Theme prompt is required", DyadErrorKind.Validation);
  }
  if (trimmed.length > 50_000) {
    throw new DyadError(
      "Theme prompt must be less than 50,000 characters",
      DyadErrorKind.Validation,
    );
  }
  return trimmed;
}

function assertSafeFileName(fileName: string): void {
  if (!fileName || fileName.trim().length === 0) {
    throw new DyadError("File name is required", DyadErrorKind.Validation);
  }
  if (
    fileName !== path.basename(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".." ||
    INVALID_FILE_NAME_CHARS.test(fileName)
  ) {
    throw new DyadError("Invalid file name", DyadErrorKind.Validation);
  }
}

function assertSafeBaseName(baseName: string): string {
  const trimmed = baseName.trim();
  if (!trimmed) {
    throw new DyadError("New image name is required", DyadErrorKind.Validation);
  }
  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    INVALID_FILE_NAME_CHARS.test(trimmed)
  ) {
    throw new DyadError("Invalid image name", DyadErrorKind.Validation);
  }
  return trimmed;
}

function assertSupportedMediaExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (!Object.keys(MIME_TYPE_MAP).includes(extension)) {
    throw new DyadError(
      "Unsupported media file extension",
      DyadErrorKind.Validation,
    );
  }
  return extension;
}

function getMediaFilePath(appPath: string, fileName: string): string {
  assertSafeFileName(fileName);
  assertSupportedMediaExtension(fileName);
  return safeJoin(appPath, DYAD_MEDIA_DIR_NAME, fileName);
}

async function getMediaFilesForApp(
  appId: number,
  appName: string,
  appPath: string,
  deps: Pick<
    LocalWebMutationServiceDependencies,
    "listDirectory" | "stat" | "pathExists"
  >,
) {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  if (!(await deps.pathExists(mediaDir))) {
    return [];
  }

  const entries = await deps.listDirectory(mediaDir);
  const results = await Promise.all(
    entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const ext = path.extname(entry.name).toLowerCase();
        return Object.keys(MIME_TYPE_MAP).includes(ext);
      })
      .map(async (entry) => {
        const fullPath = path.join(mediaDir, entry.name);
        try {
          const stat = await deps.stat(fullPath);
          return {
            fileName: entry.name,
            filePath: fullPath,
            appId,
            appName,
            sizeBytes: stat.size,
            mimeType: getMimeType(path.extname(entry.name).toLowerCase()),
          };
        } catch {
          return null;
        }
      }),
  );
  return results.filter((file) => file !== null);
}

function parseEnvFile(content: string): EnvVar[] {
  const envVars: EnvVar[] = [];
  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const equalIndex = trimmedLine.indexOf("=");
    if (equalIndex <= 0) continue;
    const key = trimmedLine.slice(0, equalIndex).trim();
    const value = trimmedLine.slice(equalIndex + 1).trim();
    envVars.push({ key, value: unquoteEnvValue(value) });
  }
  return envVars;
}

function serializeEnvFile(envVars: EnvVar[]): string {
  return `${envVars
    .filter((envVar) => envVar.key.trim())
    .map((envVar) => `${envVar.key}=${quoteEnvValue(envVar.value)}`)
    .join("\n")}\n`;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteEnvValue(value: string): string {
  if (/[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

async function ensureDyadGitignored(
  appPath: string,
  deps: Pick<
    LocalWebMutationServiceDependencies,
    "pathExists" | "readTextFile" | "writeTextFile"
  >,
): Promise<void> {
  const gitignorePath = path.join(appPath, ".gitignore");
  const entry = ".dyad/";
  const existing = (await deps.pathExists(gitignorePath))
    ? await deps.readTextFile(gitignorePath)
    : "";
  if (existing.split(/\r?\n/).some((line) => line.trim() === entry)) {
    return;
  }
  const next =
    existing.endsWith("\n") || existing.length === 0
      ? `${existing}${entry}\n`
      : `${existing}\n${entry}\n`;
  await deps.writeTextFile(gitignorePath, next);
}

function classifyExternal(message: string, error: unknown): DyadError {
  if (error instanceof DyadError) {
    return error;
  }
  const suffix = error instanceof Error ? `: ${error.message}` : "";
  return new DyadError(`${message}${suffix}`, DyadErrorKind.External, {
    cause: error,
  });
}

async function bestEffort(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Best-effort cleanup only.
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export function searchAppFilesWithRipgrep({
  appPath,
  query,
  rgPath,
}: {
  appPath: string;
  query: string;
  rgPath: string;
}): Promise<AppFileSearchResult[]> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, AppFileSearchResult>();
    const args = [
      "--json",
      "--no-config",
      "--ignore-case",
      "--fixed-strings",
      "--max-filesize",
      "1M",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**",
      query,
      ".",
    ];

    const rg = spawn(rgPath, args, { cwd: appPath });
    let buffer = "";

    rg.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const result = parseRipgrepLine(line, appPath);
        if (!result) continue;
        const existing = results.get(result.path);
        if (!existing) {
          results.set(result.path, result);
        } else if (result.snippets?.[0]) {
          existing.snippets ??= [];
          if (
            !existing.snippets.some((s) => s.line === result.snippets![0].line)
          ) {
            existing.snippets.push(result.snippets[0]);
          }
        }
      }
    });

    rg.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(
          new DyadError(
            `ripgrep exited with code ${code}`,
            DyadErrorKind.External,
          ),
        );
        return;
      }
      resolve([...results.values()]);
    });
    rg.on("error", reject);
  });
}

function parseRipgrepLine(
  line: string,
  appPath: string,
): AppFileSearchResult | undefined {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      data?: {
        path?: { text?: string };
        lines?: { text?: string };
        line_number?: number;
        submatches?: { start: number; end: number }[];
      };
    };
    if (event.type !== "match" || !event.data) return undefined;
    const matchPath = event.data.path?.text;
    const lineText = event.data.lines?.text;
    const lineNumber = event.data.line_number;
    const submatch = event.data.submatches?.[0];
    if (!matchPath || !lineText || !lineNumber || !submatch) return undefined;
    const absolutePath = path.isAbsolute(matchPath)
      ? matchPath
      : path.join(appPath, matchPath);
    const relativePath = normalizePath(path.relative(appPath, absolutePath));
    if (relativePath.startsWith("..")) return undefined;
    return {
      path: relativePath,
      matchesContent: true,
      snippets: [
        {
          before: sanitizeSnippetText(lineText.slice(0, submatch.start)),
          match: sanitizeSnippetText(
            lineText.slice(submatch.start, submatch.end),
          ),
          after: sanitizeSnippetText(lineText.slice(submatch.end)),
          line: lineNumber,
        },
      ],
    };
  } catch {
    return undefined;
  }
}

function sanitizeSnippetText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
