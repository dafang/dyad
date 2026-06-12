/**
 * Type-Safe IPC Layer
 *
 * This module provides a unified, type-safe interface for all IPC operations.
 * Contracts define the single source of truth for channel names, input schemas,
 * and output schemas. Clients are auto-generated from contracts.
 *
 * @example
 * // Invoke-response pattern
 * const settings = await ipc.settings.getUserSettings();
 * const { app, chatId } = await ipc.app.createApp({ name: "my-app" });
 *
 * // Streaming pattern
 * ipc.chatStream.start(
 *   { chatId: 123, prompt: "Hello" },
 *   { onChunk, onEnd, onError }
 * );
 *
 * // Event subscription pattern
 * const unsubscribe = ipc.events.agent.onTodosUpdate((payload) => {
 *   updateTodoList(payload.todos);
 * });
 */

// =============================================================================
// Contract Exports
// =============================================================================

export { settingsContracts } from "./settings";
export { appContracts } from "./app";
export { chatContracts, chatStreamContract } from "./chat";
export { agentContracts, agentEvents } from "./agent";
export { githubContracts, gitContracts, githubEvents } from "./github";
export { mcpContracts, mcpEvents } from "./mcp";
export { vercelContracts } from "./vercel";
export { supabaseContracts } from "./supabase";
export { neonContracts } from "./neon";
export { migrationContracts } from "./migration";
export { systemContracts, systemEvents } from "./system";
export { versionContracts } from "./version";
export { languageModelContracts } from "./language-model";
export { promptContracts } from "./prompts";
export { templateContracts } from "./templates";
export { proposalContracts } from "./proposals";
export { importContracts } from "./import";
export { helpContracts, helpStreamContract } from "./help";
export { capacitorContracts } from "./capacitor";
export { contextContracts } from "./context";
export { upgradeContracts } from "./upgrade";
export { visualEditingContracts } from "./visual-editing";
export { securityContracts } from "./security";
export { miscContracts, miscEvents } from "./misc";
export { freeAgentQuotaContracts } from "./free_agent_quota";
export { audioContracts } from "./audio";
export { mediaContracts } from "./media";
export { imageGenerationContracts } from "./image_generation";
export { appBlueprintContracts, appBlueprintEvents } from "./app_blueprint";
export { appCollectionContracts } from "./app_collections";
export { terminalContracts } from "./terminal";

// =============================================================================
// Client Exports
// =============================================================================

export { settingsClient } from "./settings";
export { appClient } from "./app";
export { chatClient, chatStreamClient } from "./chat";
export { agentClient, agentEventClient } from "./agent";
export { githubClient, gitClient, githubEventClient } from "./github";
export { mcpClient, mcpEventClient } from "./mcp";
export { vercelClient } from "./vercel";
export { supabaseClient } from "./supabase";
export { neonClient } from "./neon";
export { migrationClient } from "./migration";
export { systemClient, systemEventClient } from "./system";
export { versionClient } from "./version";
export { languageModelClient } from "./language-model";
export { promptClient } from "./prompts";
export { templateClient } from "./templates";
export { proposalClient } from "./proposals";
export { importClient } from "./import";
export { helpClient, helpStreamClient } from "./help";
export { capacitorClient } from "./capacitor";
export { contextClient } from "./context";
export { upgradeClient } from "./upgrade";
export { visualEditingClient } from "./visual-editing";
export { securityClient } from "./security";
export { miscClient, miscEventClient } from "./misc";
export { freeAgentQuotaClient } from "./free_agent_quota";
export { audioClient } from "./audio";
export { mediaClient } from "./media";
export { imageGenerationClient } from "./image_generation";
export { appBlueprintClient, appBlueprintEventClient } from "./app_blueprint";
export { appCollectionClient } from "./app_collections";
export { terminalClient } from "./terminal";

// =============================================================================
// Type Exports
// =============================================================================

// Settings types
export type {
  GetUserSettingsInput,
  GetUserSettingsOutput,
  SetUserSettingsInput,
  SetUserSettingsOutput,
} from "./settings";

// App types
export type {
  App,
  CreateAppParams,
  CreateAppResult,
  CopyAppParams,
  EditAppFileReturnType,
  RespondToAppInputParams,
  AppFileSearchResult,
  ChangeAppLocationParams,
  ChangeAppLocationResult,
  ListAppsResponse,
  RenameBranchParams,
  AppSearchResult,
  UpdateAppCommandsParams,
  RunningAppPreview,
} from "./app";

// Chat types
export type {
  Message,
  Chat,
  ComponentSelection,
  FileAttachment,
  ChatAttachment,
  ChatStreamParams,
  ChatResponseChunk,
  ChatResponseEnd,
  UpdateChatParams,
  TokenCountParams,
  TokenCountResult,
  StreamingPatch,
} from "./chat";

export type {
  TerminalOpenParams,
  TerminalOpenResult,
  TerminalDataPayload,
  TerminalExitPayload,
} from "./terminal";

// Agent types
export type {
  AgentTool,
  AgentTodo,
  AgentToolConsentRequestPayload,
  AgentToolConsentDecision,
  AgentToolConsentResponseParams,
  AgentTodosUpdatePayload,
  AgentProblemsUpdatePayload,
  SetAgentToolConsentParams,
  Problem,
  ProblemReport,
} from "./agent";

// GitHub types
export type {
  GitBranchAppIdParams,
  GitBranchParams,
  CreateGitBranchParams,
  RenameGitBranchParams,
  ListRemoteGitBranchesParams,
  CommitChangesParams,
  UncommittedFile,
  UncommittedFileStatus,
  GithubSyncOptions,
  CloneRepoParams,
  GithubRepository,
} from "./github";

// MCP types
export type {
  McpServer,
  McpTransport,
  CreateMcpServer,
  McpServerUpdate,
  McpTool,
  McpListToolsResult,
  McpToolConsent,
  McpConsentValue,
  McpConsentDecision,
  SetMcpToolConsentParams,
  McpConsentRequestPayload,
  McpConsentResponseParams,
} from "./mcp";

// Vercel types
export type {
  VercelProject,
  VercelDeployment,
  SaveVercelAccessTokenParams,
  ConnectToExistingVercelProjectParams,
  IsVercelProjectAvailableParams,
  IsVercelProjectAvailableResponse,
  CreateVercelProjectParams,
  GetVercelDeploymentsParams,
  DisconnectVercelProjectParams,
} from "./vercel";

// Supabase types
export type {
  SupabaseOrganizationInfo,
  SupabaseProject,
  SupabaseBranch,
  DeleteSupabaseOrganizationParams,
  SetSupabaseAppProjectParams,
  ConsoleEntry,
} from "./supabase";

// Neon types
export type {
  NeonProject,
  NeonProjectListItem,
  NeonBranch,
  CreateNeonProjectParams,
  GetNeonProjectParams,
  GetNeonProjectResponse,
  ListNeonProjectsResponse,
  NeonAuthEmailAndPasswordConfig,
} from "./neon";

// Migration types
export type {
  MigrationMigrateParams,
  MigrationMigrateResponse,
} from "./migration";

// System types
export type {
  InstallPnpmResult,
  NodeSystemInfo,
  SystemDebugInfo,
  SelectNodeFolderResult,
  DoesReleaseNoteExistParams,
  UserBudgetInfo,
  TelemetryEventPayload,
} from "./system";

// Version types
export type {
  Version,
  BranchResult,
  RevertVersionParams,
  RevertVersionResponse,
} from "./version";

// Language model types
export type {
  LanguageModelProvider,
  LanguageModel,
  LocalModel,
  CreateCustomLanguageModelProviderParams,
  CreateCustomLanguageModelParams,
} from "./language-model";

// Prompt types
export type {
  PromptDto,
  CreatePromptParamsDto,
  UpdatePromptParamsDto,
} from "./prompts";

// App collection types
export type {
  AppCollectionDto,
  CreateAppCollectionParams,
  UpdateAppCollectionParams,
  AssignAppsParams,
} from "./app_collections";

// Template types
export type {
  Template,
  Theme,
  SetAppThemeParams,
  GetAppThemeParams,
  CustomTheme,
  CreateCustomThemeParams,
  UpdateCustomThemeParams,
  DeleteCustomThemeParams,
  ThemeGenerationMode,
  ThemeGenerationModel,
  ThemeGenerationModelOption,
  ThemeInputSource,
  CrawlStatus,
  GenerateThemePromptParams,
  GenerateThemePromptResult,
  GenerateThemeFromUrlParams,
  SaveThemeImageParams,
  SaveThemeImageResult,
  CleanupThemeImagesParams,
} from "./templates";

// Proposal types
export type { ProposalResult, ApproveProposalResult } from "./proposals";

// Import types
export type { ImportAppParams, ImportAppResult } from "./import";

// Help types
export type { HelpChatStartParams } from "./help";

// Context types
export type { ContextPathResults, AppChatContext } from "./context";

// Upgrade types
export type { AppUpgrade } from "./upgrade";

// Visual editing types
export type {
  VisualEditingChange,
  ApplyVisualEditingChangesParams,
  AnalyseComponentParams,
} from "./visual-editing";

// Security types
export type { SecurityReviewResult } from "./security";

// Misc types
export type {
  SessionDebugBundle,
  DeepLinkData,
  AppOutput,
  EnvVar,
} from "./misc";

// Free agent quota types
export type { FreeAgentQuotaStatus } from "./free_agent_quota";

// Pro types
export type { TranscribeAudioParams, TranscribeAudioResult } from "./audio";

// Media types
export type {
  MediaFile,
  RenameMediaFileParams,
  DeleteMediaFileParams,
  MoveMediaFileParams,
} from "./media";

// Image generation types
export type {
  ImageThemeMode,
  GenerateImageParams,
  GenerateImageResponse,
} from "./image_generation";

// App blueprint types
export type {
  AppBlueprintVisual,
  AppBlueprintData,
  AppBlueprintUpdatePayload,
  AppBlueprintVisualsUpdatePayload,
  AppBlueprintApprovePayload,
  AppBlueprintFieldEditPayload,
  AppBlueprintApprovedPayload,
} from "./app_blueprint";

// =============================================================================
// Schema Exports (for validation in handlers/components)
// =============================================================================

export {
  AppSchema,
  CreateAppParamsSchema,
  CreateAppResultSchema,
  AppFileSearchResultSchema,
} from "./app";

export {
  MessageSchema,
  ChatSchema,
  ChatAttachmentSchema,
  ChatStreamParamsSchema,
  ChatResponseEndSchema,
} from "./chat";

export {
  AgentTodoSchema,
  AgentTodosUpdateSchema,
  AgentToolSchema,
  AgentToolConsentRequestSchema,
} from "./agent";

export { UserBudgetInfoSchema } from "./system";

// =============================================================================
// Aggregated Runtime Client
// =============================================================================

import { getRuntimeIpc } from "@/lib/runtime_client";

/**
 * Unified IPC client with all domains organized by namespace.
 *
 * @example
 * // Settings
 * const settings = await ipc.settings.getUserSettings();
 *
 * // App management
 * const app = await ipc.app.getApp(appId);
 *
 * // Chat operations
 * const chat = await ipc.chat.getChat(chatId);
 *
 * // Streaming
 * ipc.chatStream.start(params, callbacks);
 *
 * // Event subscriptions
 * ipc.events.agent.onTodosUpdate(handler);
 */
export const ipc = getRuntimeIpc();
