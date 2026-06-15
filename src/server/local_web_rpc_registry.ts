import { z } from "zod";

import { defineContract, type IpcContract } from "@/ipc/contracts/core";
import {
  acknowledgeChatResponse,
  cancelChatStream,
  handleChatStream,
} from "@/ipc/handlers/chat_stream_handlers";
import { countTokensHandler } from "@/ipc/handlers/token_count_handlers";
import {
  approveProposalHandler,
  getProposalHandler,
  rejectProposalHandler,
} from "@/ipc/handlers/proposal_handlers";
import {
  getAgentToolsHandler,
  respondToAgentConsentHandler,
  setAgentConsentHandler,
} from "@/pro/main/ipc/handlers/local_agent/agent_tool_handlers";
import {
  cancelHelpChatHandler,
  startHelpChatHandler,
} from "@/ipc/handlers/help_bot_handlers";
import {
  createPlanHandler,
  deletePlanHandler,
  getPlanForChatHandler,
  getPlanHandler,
  respondToQuestionnaireHandler,
  updatePlanHandler,
} from "@/ipc/handlers/plan_handlers";
import { respondToIntegrationHandler } from "@/ipc/handlers/integration_handlers";
import {
  addAppBlueprintVisualHandler,
  approveAppBlueprintHandler,
  editAppBlueprintFieldHandler,
  editAppBlueprintVisualHandler,
  removeAppBlueprintVisualHandler,
} from "@/ipc/handlers/app_blueprint_handlers";
import { applyAppTemplateHandler } from "@/ipc/handlers/template_handlers";
import { appContracts, type App } from "@/ipc/types/app";
import {
  chatContracts,
  ChatStreamParamsSchema,
  type Chat,
  type ChatStreamParams,
  type TokenCountParams,
  type TokenCountResult,
} from "@/ipc/types/chat";
import { appCollectionContracts } from "@/ipc/types/app_collections";
import { agentContracts, type AgentTool } from "@/ipc/types/agent";
import {
  appBlueprintContracts,
  type AppBlueprintAddVisualPayload,
  type AppBlueprintApprovePayload,
  type AppBlueprintFieldEditPayload,
  type AppBlueprintRemoveVisualPayload,
  type AppBlueprintVisualEditPayload,
} from "@/ipc/types/app_blueprint";
import { contextContracts } from "@/ipc/types/context";
import { freeAgentQuotaContracts } from "@/ipc/types/free_agent_quota";
import { githubContracts, gitContracts } from "@/ipc/types/github";
import { helpContracts, type HelpChatStartParams } from "@/ipc/types/help";
import { importContracts } from "@/ipc/types/import";
import {
  integrationContracts,
  type IntegrationResponsePayload,
} from "@/ipc/types/integration";
import { languageModelContracts } from "@/ipc/types/language-model";
import { mcpContracts } from "@/ipc/types/mcp";
import { mediaContracts } from "@/ipc/types/media";
import { miscContracts } from "@/ipc/types/misc";
import { neonContracts } from "@/ipc/types/neon";
import { promptContracts } from "@/ipc/types/prompts";
import {
  proposalContracts,
  type ApproveProposalResult,
  type ProposalResult,
} from "@/ipc/types/proposals";
import { settingsContracts } from "@/ipc/types/settings";
import { securityContracts } from "@/ipc/types/security";
import { supabaseContracts } from "@/ipc/types/supabase";
import { systemContracts } from "@/ipc/types/system";
import { templateContracts } from "@/ipc/types/templates";
import { upgradeContracts } from "@/ipc/types/upgrade";
import { vercelContracts } from "@/ipc/types/vercel";
import { visualEditingContracts } from "@/ipc/types/visual-editing";
import { versionContracts } from "@/ipc/types/version";
import {
  planContracts,
  type CreatePlanParams,
  type Plan,
  type QuestionnaireResponsePayload,
  type UpdatePlanParams,
} from "@/ipc/types/plan";
import { createTypedBackendRegistry } from "./local_backend_host";
import { createLocalWebIpcEvent } from "./local_web_ipc_event";
import { registerLocalHttpBackendHandlers } from "./local_http_backend_adapter";
import type { LocalEventStream } from "./local_event_stream";
import type { LocalRpcServer } from "./local_rpc_server";
import type { LocalWebCoreService } from "@/ipc/services/local_web_core_service";
import type { LocalWebMutationService } from "@/ipc/services/local_web_mutation_service";
import type { LocalWebRuntimeService } from "@/ipc/services/local_web_runtime_service";
import { audioContracts } from "@/ipc/types/audio";
import { capacitorContracts } from "@/ipc/types/capacitor";
import { imageGenerationContracts } from "@/ipc/types/image_generation";
import { terminalContracts } from "@/ipc/types/terminal";

const chatStreamStartContract = defineContract({
  channel: "chat:stream",
  input: ChatStreamParamsSchema,
  output: z.union([z.number(), z.literal("error")]),
});

type AnyRpcContract = IpcContract<string, z.ZodType, z.ZodType>;
type RpcInput<TContract extends AnyRpcContract> = z.infer<TContract["input"]>;
type RpcOutput<TContract extends AnyRpcContract> = z.infer<TContract["output"]>;
type MaybePromise<T> = T | Promise<T>;

interface LocalWebIntegrationService {
  openExternalUrl(
    url: RpcInput<typeof systemContracts.openExternalUrl>,
  ): MaybePromise<RpcOutput<typeof systemContracts.openExternalUrl>>;
  showItemInFolder(
    path: RpcInput<typeof systemContracts.showItemInFolder>,
  ): MaybePromise<RpcOutput<typeof systemContracts.showItemInFolder>>;
  openFilePath(
    path: RpcInput<typeof systemContracts.openFilePath>,
  ): MaybePromise<RpcOutput<typeof systemContracts.openFilePath>>;
  startGithubFlow(
    event: ReturnType<typeof createLocalWebIpcEvent>,
    params: RpcInput<typeof githubContracts.startFlow>,
  ): MaybePromise<RpcOutput<typeof githubContracts.startFlow>>;
  listGithubRepos(): MaybePromise<RpcOutput<typeof githubContracts.listRepos>>;
  getGithubRepoBranches(
    params: RpcInput<typeof githubContracts.getRepoBranches>,
  ): MaybePromise<RpcOutput<typeof githubContracts.getRepoBranches>>;
  isGithubRepoAvailable(
    params: RpcInput<typeof githubContracts.isRepoAvailable>,
  ): MaybePromise<RpcOutput<typeof githubContracts.isRepoAvailable>>;
  createGithubRepo(
    params: RpcInput<typeof githubContracts.createRepo>,
  ): MaybePromise<RpcOutput<typeof githubContracts.createRepo>>;
  connectExistingGithubRepo(
    params: RpcInput<typeof githubContracts.connectExistingRepo>,
  ): MaybePromise<RpcOutput<typeof githubContracts.connectExistingRepo>>;
  pushGithub(
    params: RpcInput<typeof githubContracts.push>,
  ): MaybePromise<RpcOutput<typeof githubContracts.push>>;
  fetchGithub(
    params: RpcInput<typeof githubContracts.fetch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.fetch>>;
  pullGithub(
    params: RpcInput<typeof githubContracts.pull>,
  ): MaybePromise<RpcOutput<typeof githubContracts.pull>>;
  rebaseGithub(
    params: RpcInput<typeof githubContracts.rebase>,
  ): MaybePromise<RpcOutput<typeof githubContracts.rebase>>;
  abortGithubRebase(
    params: RpcInput<typeof githubContracts.rebaseAbort>,
  ): MaybePromise<RpcOutput<typeof githubContracts.rebaseAbort>>;
  abortGithubMerge(
    params: RpcInput<typeof githubContracts.mergeAbort>,
  ): MaybePromise<RpcOutput<typeof githubContracts.mergeAbort>>;
  continueGithubRebase(
    params: RpcInput<typeof githubContracts.rebaseContinue>,
  ): MaybePromise<RpcOutput<typeof githubContracts.rebaseContinue>>;
  listLocalGitBranches(
    params: RpcInput<typeof githubContracts.listLocalBranches>,
  ): MaybePromise<RpcOutput<typeof githubContracts.listLocalBranches>>;
  listRemoteGitBranches(
    params: RpcInput<typeof githubContracts.listRemoteBranches>,
  ): MaybePromise<RpcOutput<typeof githubContracts.listRemoteBranches>>;
  createGitBranch(
    params: RpcInput<typeof githubContracts.createBranch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.createBranch>>;
  switchGitBranch(
    params: RpcInput<typeof githubContracts.switchBranch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.switchBranch>>;
  deleteGitBranch(
    params: RpcInput<typeof githubContracts.deleteBranch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.deleteBranch>>;
  renameGitBranch(
    params: RpcInput<typeof githubContracts.renameBranch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.renameBranch>>;
  mergeGitBranch(
    params: RpcInput<typeof githubContracts.mergeBranch>,
  ): MaybePromise<RpcOutput<typeof githubContracts.mergeBranch>>;
  getGitConflicts(
    params: RpcInput<typeof githubContracts.getConflicts>,
  ): MaybePromise<RpcOutput<typeof githubContracts.getConflicts>>;
  getGitState(
    params: RpcInput<typeof githubContracts.getGitState>,
  ): MaybePromise<RpcOutput<typeof githubContracts.getGitState>>;
  disconnectGithubRepo(
    params: RpcInput<typeof githubContracts.disconnect>,
  ): MaybePromise<RpcOutput<typeof githubContracts.disconnect>>;
  listGithubCollaborators(
    params: RpcInput<typeof githubContracts.listCollaborators>,
  ): MaybePromise<RpcOutput<typeof githubContracts.listCollaborators>>;
  inviteGithubCollaborator(
    params: RpcInput<typeof githubContracts.inviteCollaborator>,
  ): MaybePromise<RpcOutput<typeof githubContracts.inviteCollaborator>>;
  removeGithubCollaborator(
    params: RpcInput<typeof githubContracts.removeCollaborator>,
  ): MaybePromise<RpcOutput<typeof githubContracts.removeCollaborator>>;
  cloneGithubRepoFromUrl(
    params: RpcInput<typeof githubContracts.cloneRepoFromUrl>,
  ): MaybePromise<RpcOutput<typeof githubContracts.cloneRepoFromUrl>>;
  getGitUncommittedFiles(
    params: RpcInput<typeof gitContracts.getUncommittedFiles>,
  ): MaybePromise<RpcOutput<typeof gitContracts.getUncommittedFiles>>;
  commitGitChanges(
    params: RpcInput<typeof gitContracts.commitChanges>,
  ): MaybePromise<RpcOutput<typeof gitContracts.commitChanges>>;
  discardGitChanges(
    params: RpcInput<typeof gitContracts.discardChanges>,
  ): MaybePromise<RpcOutput<typeof gitContracts.discardChanges>>;
  saveVercelToken(
    params: RpcInput<typeof vercelContracts.saveToken>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.saveToken>>;
  listVercelProjects(): MaybePromise<
    RpcOutput<typeof vercelContracts.listProjects>
  >;
  isVercelProjectAvailable(
    params: RpcInput<typeof vercelContracts.isProjectAvailable>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.isProjectAvailable>>;
  createVercelProject(
    params: RpcInput<typeof vercelContracts.createProject>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.createProject>>;
  connectExistingVercelProject(
    params: RpcInput<typeof vercelContracts.connectExistingProject>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.connectExistingProject>>;
  getVercelDeployments(
    params: RpcInput<typeof vercelContracts.getDeployments>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.getDeployments>>;
  disconnectVercelProject(
    params: RpcInput<typeof vercelContracts.disconnect>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.disconnect>>;
  getVercelSyncPreview(
    params: RpcInput<typeof vercelContracts.getSyncPreview>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.getSyncPreview>>;
  syncNeonConfigToVercel(
    params: RpcInput<typeof vercelContracts.syncNeonConfig>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.syncNeonConfig>>;
  removeNeonEnvVarsFromVercel(
    params: RpcInput<typeof vercelContracts.removeNeonEnvVars>,
  ): MaybePromise<RpcOutput<typeof vercelContracts.removeNeonEnvVars>>;
  listSupabaseOrganizations(): MaybePromise<
    RpcOutput<typeof supabaseContracts.listOrganizations>
  >;
  saveSupabaseOrganizationToken(
    params: RpcInput<typeof supabaseContracts.saveOrganizationToken>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.saveOrganizationToken>>;
  deleteSupabaseOrganization(
    params: RpcInput<typeof supabaseContracts.deleteOrganization>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.deleteOrganization>>;
  listSupabaseProjects(): MaybePromise<
    RpcOutput<typeof supabaseContracts.listAllProjects>
  >;
  listSupabaseBranches(
    params: RpcInput<typeof supabaseContracts.listBranches>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.listBranches>>;
  getSupabaseEdgeLogs(
    params: RpcInput<typeof supabaseContracts.getEdgeLogs>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.getEdgeLogs>>;
  setSupabaseAppProject(
    params: RpcInput<typeof supabaseContracts.setAppProject>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.setAppProject>>;
  unsetSupabaseAppProject(
    params: RpcInput<typeof supabaseContracts.unsetAppProject>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.unsetAppProject>>;
  fakeConnectSupabaseProject(
    params: RpcInput<typeof supabaseContracts.fakeConnectAndSetProject>,
  ): MaybePromise<RpcOutput<typeof supabaseContracts.fakeConnectAndSetProject>>;
  createNeonProject(
    params: RpcInput<typeof neonContracts.createProject>,
  ): MaybePromise<RpcOutput<typeof neonContracts.createProject>>;
  saveNeonApiKey(
    params: RpcInput<typeof neonContracts.saveApiKey>,
  ): MaybePromise<RpcOutput<typeof neonContracts.saveApiKey>>;
  getNeonProject(
    params: RpcInput<typeof neonContracts.getProject>,
  ): MaybePromise<RpcOutput<typeof neonContracts.getProject>>;
  listNeonProjects(): MaybePromise<
    RpcOutput<typeof neonContracts.listProjects>
  >;
  setNeonAppProject(
    params: RpcInput<typeof neonContracts.setAppProject>,
  ): MaybePromise<RpcOutput<typeof neonContracts.setAppProject>>;
  unsetNeonAppProject(
    params: RpcInput<typeof neonContracts.unsetAppProject>,
  ): MaybePromise<RpcOutput<typeof neonContracts.unsetAppProject>>;
  setNeonActiveBranch(
    params: RpcInput<typeof neonContracts.setActiveBranch>,
  ): MaybePromise<RpcOutput<typeof neonContracts.setActiveBranch>>;
  getNeonEmailPasswordConfig(
    params: RpcInput<typeof neonContracts.getEmailPasswordConfig>,
  ): MaybePromise<RpcOutput<typeof neonContracts.getEmailPasswordConfig>>;
  updateNeonEmailVerification(
    params: RpcInput<typeof neonContracts.updateEmailVerification>,
  ): MaybePromise<RpcOutput<typeof neonContracts.updateEmailVerification>>;
  fakeConnectNeon(): MaybePromise<RpcOutput<typeof neonContracts.fakeConnect>>;
  getNeonBranchEnvVars(
    params: RpcInput<typeof neonContracts.getBranchEnvVars>,
  ): MaybePromise<RpcOutput<typeof neonContracts.getBranchEnvVars>>;
  setSelectedDatabaseBranchType(
    params: RpcInput<typeof neonContracts.setSelectedDatabaseBranchType>,
  ): MaybePromise<
    RpcOutput<typeof neonContracts.setSelectedDatabaseBranchType>
  >;
  createMcpServer(
    params: RpcInput<typeof mcpContracts.createServer>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.createServer>>;
  updateMcpServer(
    params: RpcInput<typeof mcpContracts.updateServer>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.updateServer>>;
  deleteMcpServer(
    serverId: RpcInput<typeof mcpContracts.deleteServer>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.deleteServer>>;
  setMcpToolConsent(
    params: RpcInput<typeof mcpContracts.setToolConsent>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.setToolConsent>>;
  respondToMcpConsent(
    params: RpcInput<typeof mcpContracts.respondToConsent>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.respondToConsent>>;
  startMcpOAuth(
    params: RpcInput<typeof mcpContracts.startOAuth>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.startOAuth>>;
  disconnectMcpOAuth(
    serverId: RpcInput<typeof mcpContracts.disconnectOAuth>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.disconnectOAuth>>;
  probeMcpConnection(
    serverId: RpcInput<typeof mcpContracts.probeConnection>,
  ): MaybePromise<RpcOutput<typeof mcpContracts.probeConnection>>;
  createCustomLanguageModelProvider(
    params: RpcInput<typeof languageModelContracts.createCustomProvider>,
  ): MaybePromise<
    RpcOutput<typeof languageModelContracts.createCustomProvider>
  >;
  editCustomLanguageModelProvider(
    params: RpcInput<typeof languageModelContracts.editCustomProvider>,
  ): MaybePromise<RpcOutput<typeof languageModelContracts.editCustomProvider>>;
  deleteCustomLanguageModelProvider(
    params: RpcInput<typeof languageModelContracts.deleteCustomProvider>,
  ): MaybePromise<
    RpcOutput<typeof languageModelContracts.deleteCustomProvider>
  >;
  createCustomLanguageModel(
    params: RpcInput<typeof languageModelContracts.createCustomModel>,
  ): MaybePromise<RpcOutput<typeof languageModelContracts.createCustomModel>>;
  deleteCustomLanguageModel(
    modelId: RpcInput<typeof languageModelContracts.deleteCustomModel>,
  ): MaybePromise<RpcOutput<typeof languageModelContracts.deleteCustomModel>>;
  deleteCustomModel(
    params: RpcInput<typeof languageModelContracts.deleteModel>,
  ): MaybePromise<RpcOutput<typeof languageModelContracts.deleteModel>>;
  listOllamaModels(): MaybePromise<
    RpcOutput<typeof languageModelContracts.listOllamaModels>
  >;
  listLmStudioModels(): MaybePromise<
    RpcOutput<typeof languageModelContracts.listLMStudioModels>
  >;
  getLatestSecurityReview(
    appId: RpcInput<typeof securityContracts.getLatestSecurityReview>,
  ): MaybePromise<RpcOutput<typeof securityContracts.getLatestSecurityReview>>;
  applyVisualEditingChanges(
    params: RpcInput<typeof visualEditingContracts.applyChanges>,
  ): MaybePromise<RpcOutput<typeof visualEditingContracts.applyChanges>>;
  analyzeComponent(
    params: RpcInput<typeof visualEditingContracts.analyzeComponent>,
  ): MaybePromise<RpcOutput<typeof visualEditingContracts.analyzeComponent>>;
  getAppUpgrades(
    params: RpcInput<typeof upgradeContracts.getAppUpgrades>,
  ): MaybePromise<RpcOutput<typeof upgradeContracts.getAppUpgrades>>;
  executeAppUpgrade(
    params: RpcInput<typeof upgradeContracts.executeAppUpgrade>,
  ): MaybePromise<RpcOutput<typeof upgradeContracts.executeAppUpgrade>>;
  isCapacitorApp(
    params: RpcInput<typeof capacitorContracts.isCapacitor>,
  ): MaybePromise<RpcOutput<typeof capacitorContracts.isCapacitor>>;
  syncCapacitor(
    params: RpcInput<typeof capacitorContracts.syncCapacitor>,
  ): MaybePromise<RpcOutput<typeof capacitorContracts.syncCapacitor>>;
  openIos(
    params: RpcInput<typeof capacitorContracts.openIos>,
  ): MaybePromise<RpcOutput<typeof capacitorContracts.openIos>>;
  openAndroid(
    params: RpcInput<typeof capacitorContracts.openAndroid>,
  ): MaybePromise<RpcOutput<typeof capacitorContracts.openAndroid>>;
  generateImage(
    params: RpcInput<typeof imageGenerationContracts.generateImage>,
  ): MaybePromise<RpcOutput<typeof imageGenerationContracts.generateImage>>;
  cancelImageGeneration(
    params: RpcInput<typeof imageGenerationContracts.cancelImageGeneration>,
  ): MaybePromise<
    RpcOutput<typeof imageGenerationContracts.cancelImageGeneration>
  >;
  transcribeAudio(
    params: RpcInput<typeof audioContracts.transcribeAudio>,
  ): MaybePromise<RpcOutput<typeof audioContracts.transcribeAudio>>;
}

export interface LocalWebRpcService
  extends
    Pick<
      LocalWebCoreService,
      | "getSettings"
      | "setSettings"
      | "getEnvVars"
      | "getSystemPlatform"
      | "getInitialLoadTelemetryContext"
      | "getSystemDebugInfo"
      | "getAppVersion"
      | "getNodejsStatus"
      | "installPnpm"
      | "getCustomAppsFolder"
      | "getUserBudget"
      | "getApp"
      | "listApps"
      | "searchApps"
      | "listAppScreenshots"
      | "listAppThumbnails"
      | "getCurrentCommitHash"
      | "saveAppScreenshot"
      | "getChat"
      | "getChats"
      | "getChatMetadata"
      | "getTemplates"
      | "getThemes"
      | "getCustomThemes"
      | "getThemeGenerationModelOptions"
      | "saveThemeImage"
      | "cleanupThemeImages"
      | "generateThemePrompt"
      | "generateThemeFromUrl"
      | "getAppTheme"
      | "listPrompts"
      | "listAppCollections"
      | "getLanguageModelProviders"
      | "getLanguageModels"
      | "getLanguageModelsByProviders"
      | "getFreeAgentQuotaStatus"
      | "listAllMedia"
      | "listVersions"
      | "getCurrentBranch"
      | "revertVersion"
      | "checkoutVersion"
      | "checkProblems"
      | "addLog"
      | "clearLogs"
      | "listMcpServers"
      | "listMcpToolConsents"
      | "listMcpTools"
      | "isMcpOauthStorageEncrypted"
      | "probeMcpCallbackPort"
      | "rendererErrorToastReady"
    >,
    Pick<
      LocalWebMutationService,
      | "createApp"
      | "copyApp"
      | "deleteApp"
      | "deleteApps"
      | "renameApp"
      | "toggleFavorite"
      | "changeAppLocation"
      | "updateAppCommands"
      | "checkAppName"
      | "importApp"
      | "checkAiRules"
      | "selectAppFolder"
      | "selectAppLocation"
      | "createChat"
      | "updateChat"
      | "deleteChat"
      | "deleteMessages"
      | "searchChats"
      | "readAppFile"
      | "editAppFile"
      | "searchAppFiles"
      | "getAppEnvVars"
      | "setAppEnvVars"
      | "getContextPaths"
      | "setContextPaths"
      | "createPrompt"
      | "updatePrompt"
      | "deletePrompt"
      | "createAppCollection"
      | "updateAppCollection"
      | "deleteAppCollection"
      | "assignApps"
      | "setAppTheme"
      | "createCustomTheme"
      | "updateCustomTheme"
      | "deleteCustomTheme"
      | "renameMediaFile"
      | "deleteMediaFile"
      | "moveMediaFile"
    >,
    Pick<
      LocalWebRuntimeService,
      | "runApp"
      | "stopApp"
      | "restartApp"
      | "getRunningAppPreview"
      | "respondToAppInput"
      | "selectAppForPreview"
      | "openTerminal"
      | "closeTerminal"
      | "killTerminal"
      | "writeTerminal"
      | "resizeTerminal"
      | "serializeTerminal"
    >,
    LocalWebIntegrationService {
  getApp(appId: number): Promise<App>;
  getChat(chatId: number): Promise<Chat>;
  startChatStream(
    event: ReturnType<typeof createLocalWebIpcEvent>,
    params: ChatStreamParams,
  ): Promise<number | "error">;
  cancelChatStream(
    event: ReturnType<typeof createLocalWebIpcEvent>,
    chatId: number,
  ): Promise<boolean> | boolean;
  acknowledgeChatResponse(params: { chatId: number; lastSeq: number }): void;
  countTokens(params: TokenCountParams): Promise<TokenCountResult>;
  getProposal(params: { chatId: number }): Promise<ProposalResult | null>;
  approveProposal(params: {
    chatId: number;
    messageId: number;
  }): Promise<ApproveProposalResult>;
  rejectProposal(params: { chatId: number; messageId: number }): Promise<void>;
  getAgentTools(): Promise<AgentTool[]>;
  setAgentConsent(params: {
    toolName: string;
    consent: AgentTool["consent"];
  }): Promise<void> | void;
  respondToAgentConsent(params: {
    requestId: string;
    decision: "accept-once" | "accept-always" | "decline";
  }): Promise<void> | void;
  startHelpChat(
    event: ReturnType<typeof createLocalWebIpcEvent>,
    params: HelpChatStartParams,
  ): Promise<{ ok: true }>;
  cancelHelpChat(sessionId: string): Promise<{ ok: true }> | { ok: true };
  createPlan(params: CreatePlanParams): Promise<string>;
  getPlan(params: { appId: number; planId: string }): Promise<Plan>;
  getPlanForChat(params: {
    appId: number;
    chatId: number;
  }): Promise<Plan | null>;
  updatePlan(params: UpdatePlanParams): Promise<void>;
  deletePlan(params: { appId: number; planId: string }): Promise<void>;
  respondToQuestionnaire(params: QuestionnaireResponsePayload): void;
  respondToIntegration(params: IntegrationResponsePayload): void;
  approveAppBlueprint(
    event: ReturnType<typeof createLocalWebIpcEvent>,
    params: AppBlueprintApprovePayload,
  ): Promise<void>;
  editAppBlueprintField(
    params: AppBlueprintFieldEditPayload,
  ): Promise<void> | void;
  editAppBlueprintVisual(
    params: AppBlueprintVisualEditPayload,
  ): Promise<void> | void;
  addAppBlueprintVisual(
    params: AppBlueprintAddVisualPayload,
  ): { visualId: string } | Promise<{ visualId: string }>;
  removeAppBlueprintVisual(
    params: AppBlueprintRemoveVisualPayload,
  ): Promise<void> | void;
  applyAppTemplate(
    params: RpcInput<typeof templateContracts.applyAppTemplate>,
  ): MaybePromise<RpcOutput<typeof templateContracts.applyAppTemplate>>;
}

export const LOCAL_WEB_RPC_ALLOWLIST = [
  settingsContracts.getUserSettings.channel,
  settingsContracts.setUserSettings.channel,
  miscContracts.getEnvVars.channel,
  miscContracts.getAppEnvVars.channel,
  miscContracts.setAppEnvVars.channel,
  miscContracts.addLog.channel,
  miscContracts.clearLogs.channel,
  miscContracts.checkProblems.channel,
  miscContracts.rendererErrorToastReady.channel,
  systemContracts.getSystemPlatform.channel,
  systemContracts.getInitialLoadTelemetryContext.channel,
  systemContracts.getSystemDebugInfo.channel,
  systemContracts.getAppVersion.channel,
  systemContracts.getNodejsStatus.channel,
  systemContracts.installPnpm.channel,
  systemContracts.selectAppFolder.channel,
  systemContracts.getCustomAppsFolder.channel,
  systemContracts.openExternalUrl.channel,
  systemContracts.showItemInFolder.channel,
  systemContracts.openFilePath.channel,
  systemContracts.getUserBudget.channel,
  appContracts.getApp.channel,
  appContracts.listApps.channel,
  appContracts.createApp.channel,
  appContracts.deleteApp.channel,
  appContracts.deleteApps.channel,
  appContracts.copyApp.channel,
  appContracts.renameApp.channel,
  appContracts.runApp.channel,
  appContracts.stopApp.channel,
  appContracts.restartApp.channel,
  appContracts.getRunningAppPreview.channel,
  appContracts.respondToAppInput.channel,
  appContracts.editAppFile.channel,
  appContracts.readAppFile.channel,
  appContracts.searchAppFiles.channel,
  appContracts.changeAppLocation.channel,
  appContracts.addToFavorite.channel,
  appContracts.selectAppLocation.channel,
  appContracts.checkAppName.channel,
  appContracts.searchApps.channel,
  appContracts.updateAppCommands.channel,
  appContracts.selectAppForPreview.channel,
  appContracts.getCurrentCommitHash.channel,
  appContracts.saveAppScreenshot.channel,
  appContracts.listAppScreenshots.channel,
  appContracts.listAppThumbnails.channel,
  chatContracts.getChat.channel,
  chatContracts.getChats.channel,
  chatContracts.getChatMetadata.channel,
  chatContracts.createChat.channel,
  chatContracts.updateChat.channel,
  chatContracts.deleteChat.channel,
  chatContracts.deleteMessages.channel,
  chatContracts.searchChats.channel,
  chatContracts.countTokens.channel,
  chatContracts.cancelStream.channel,
  chatContracts.responseAck.channel,
  chatStreamStartContract.channel,
  proposalContracts.getProposal.channel,
  proposalContracts.approveProposal.channel,
  proposalContracts.rejectProposal.channel,
  agentContracts.getTools.channel,
  agentContracts.setConsent.channel,
  agentContracts.respondToConsent.channel,
  helpContracts.start.channel,
  helpContracts.cancel.channel,
  planContracts.createPlan.channel,
  planContracts.getPlan.channel,
  planContracts.getPlanForChat.channel,
  planContracts.updatePlan.channel,
  planContracts.deletePlan.channel,
  planContracts.respondToQuestionnaire.channel,
  integrationContracts.respond.channel,
  appBlueprintContracts.approve.channel,
  appBlueprintContracts.editField.channel,
  appBlueprintContracts.editVisual.channel,
  appBlueprintContracts.addVisual.channel,
  appBlueprintContracts.removeVisual.channel,
  templateContracts.getTemplates.channel,
  templateContracts.applyAppTemplate.channel,
  templateContracts.getThemes.channel,
  templateContracts.setAppTheme.channel,
  templateContracts.getCustomThemes.channel,
  templateContracts.getThemeGenerationModelOptions.channel,
  templateContracts.saveThemeImage.channel,
  templateContracts.cleanupThemeImages.channel,
  templateContracts.generateThemePrompt.channel,
  templateContracts.generateThemeFromUrl.channel,
  templateContracts.getAppTheme.channel,
  templateContracts.createCustomTheme.channel,
  templateContracts.updateCustomTheme.channel,
  templateContracts.deleteCustomTheme.channel,
  promptContracts.list.channel,
  promptContracts.create.channel,
  promptContracts.update.channel,
  promptContracts.delete.channel,
  appCollectionContracts.list.channel,
  appCollectionContracts.create.channel,
  appCollectionContracts.update.channel,
  appCollectionContracts.delete.channel,
  appCollectionContracts.assignApps.channel,
  importContracts.importApp.channel,
  importContracts.checkAppName.channel,
  importContracts.checkAiRules.channel,
  contextContracts.getContextPaths.channel,
  contextContracts.setContextPaths.channel,
  languageModelContracts.getProviders.channel,
  languageModelContracts.getModels.channel,
  languageModelContracts.getModelsByProviders.channel,
  freeAgentQuotaContracts.getFreeAgentQuotaStatus.channel,
  mediaContracts.listAllMedia.channel,
  mediaContracts.renameMediaFile.channel,
  mediaContracts.deleteMediaFile.channel,
  mediaContracts.moveMediaFile.channel,
  terminalContracts.open.channel,
  terminalContracts.close.channel,
  terminalContracts.kill.channel,
  terminalContracts.write.channel,
  terminalContracts.resize.channel,
  terminalContracts.serialize.channel,
  versionContracts.listVersions.channel,
  versionContracts.getCurrentBranch.channel,
  versionContracts.revertVersion.channel,
  versionContracts.checkoutVersion.channel,
  githubContracts.startFlow.channel,
  githubContracts.listRepos.channel,
  githubContracts.getRepoBranches.channel,
  githubContracts.isRepoAvailable.channel,
  githubContracts.createRepo.channel,
  githubContracts.connectExistingRepo.channel,
  githubContracts.push.channel,
  githubContracts.fetch.channel,
  githubContracts.pull.channel,
  githubContracts.rebase.channel,
  githubContracts.rebaseAbort.channel,
  githubContracts.mergeAbort.channel,
  githubContracts.rebaseContinue.channel,
  githubContracts.listLocalBranches.channel,
  githubContracts.listRemoteBranches.channel,
  githubContracts.createBranch.channel,
  githubContracts.switchBranch.channel,
  githubContracts.deleteBranch.channel,
  githubContracts.renameBranch.channel,
  githubContracts.mergeBranch.channel,
  githubContracts.getConflicts.channel,
  githubContracts.getGitState.channel,
  githubContracts.disconnect.channel,
  githubContracts.listCollaborators.channel,
  githubContracts.inviteCollaborator.channel,
  githubContracts.removeCollaborator.channel,
  githubContracts.cloneRepoFromUrl.channel,
  gitContracts.getUncommittedFiles.channel,
  gitContracts.commitChanges.channel,
  gitContracts.discardChanges.channel,
  vercelContracts.saveToken.channel,
  vercelContracts.listProjects.channel,
  vercelContracts.isProjectAvailable.channel,
  vercelContracts.createProject.channel,
  vercelContracts.connectExistingProject.channel,
  vercelContracts.getDeployments.channel,
  vercelContracts.disconnect.channel,
  vercelContracts.getSyncPreview.channel,
  vercelContracts.syncNeonConfig.channel,
  vercelContracts.removeNeonEnvVars.channel,
  supabaseContracts.saveOrganizationToken.channel,
  supabaseContracts.listOrganizations.channel,
  supabaseContracts.deleteOrganization.channel,
  supabaseContracts.listAllProjects.channel,
  supabaseContracts.listBranches.channel,
  supabaseContracts.getEdgeLogs.channel,
  supabaseContracts.setAppProject.channel,
  supabaseContracts.unsetAppProject.channel,
  supabaseContracts.fakeConnectAndSetProject.channel,
  neonContracts.saveApiKey.channel,
  neonContracts.createProject.channel,
  neonContracts.getProject.channel,
  neonContracts.listProjects.channel,
  neonContracts.setAppProject.channel,
  neonContracts.unsetAppProject.channel,
  neonContracts.setActiveBranch.channel,
  neonContracts.getEmailPasswordConfig.channel,
  neonContracts.updateEmailVerification.channel,
  neonContracts.fakeConnect.channel,
  neonContracts.getBranchEnvVars.channel,
  neonContracts.setSelectedDatabaseBranchType.channel,
  mcpContracts.listServers.channel,
  mcpContracts.createServer.channel,
  mcpContracts.updateServer.channel,
  mcpContracts.deleteServer.channel,
  mcpContracts.getToolConsents.channel,
  mcpContracts.setToolConsent.channel,
  mcpContracts.respondToConsent.channel,
  mcpContracts.listTools.channel,
  mcpContracts.startOAuth.channel,
  mcpContracts.disconnectOAuth.channel,
  mcpContracts.isOauthStorageEncrypted.channel,
  mcpContracts.probeCallbackPort.channel,
  mcpContracts.probeConnection.channel,
  languageModelContracts.createCustomProvider.channel,
  languageModelContracts.editCustomProvider.channel,
  languageModelContracts.deleteCustomProvider.channel,
  languageModelContracts.createCustomModel.channel,
  languageModelContracts.deleteCustomModel.channel,
  languageModelContracts.deleteModel.channel,
  languageModelContracts.listOllamaModels.channel,
  languageModelContracts.listLMStudioModels.channel,
  securityContracts.getLatestSecurityReview.channel,
  visualEditingContracts.applyChanges.channel,
  visualEditingContracts.analyzeComponent.channel,
  upgradeContracts.getAppUpgrades.channel,
  upgradeContracts.executeAppUpgrade.channel,
  capacitorContracts.isCapacitor.channel,
  capacitorContracts.syncCapacitor.channel,
  capacitorContracts.openIos.channel,
  capacitorContracts.openAndroid.channel,
  imageGenerationContracts.generateImage.channel,
  imageGenerationContracts.cancelImageGeneration.channel,
  audioContracts.transcribeAudio.channel,
] as const;

export type LocalWebRpcChannel = (typeof LOCAL_WEB_RPC_ALLOWLIST)[number];

export interface RegisterLocalWebRpcHandlersOptions {
  events?: Pick<LocalEventStream, "publish">;
}

export async function registerLocalWebRpcHandlers(
  server: LocalRpcServer,
  service?: LocalWebRpcService,
  options: RegisterLocalWebRpcHandlersOptions = {},
): Promise<void> {
  const resolvedService = service ?? (await createDefaultService());
  const eventBridge = createLocalWebIpcEvent(
    options.events ?? { publish: () => undefined },
  );
  const registry = createTypedBackendRegistry({ outputValidation: "throw" });
  registry.register(settingsContracts.getUserSettings, () =>
    resolvedService.getSettings(),
  );
  registry.register(settingsContracts.setUserSettings, (_context, settings) =>
    resolvedService.setSettings(settings),
  );
  registry.register(miscContracts.getEnvVars, () =>
    resolvedService.getEnvVars(),
  );
  registry.register(miscContracts.getAppEnvVars, (_context, params) =>
    resolvedService.getAppEnvVars(params.appId),
  );
  registry.register(miscContracts.setAppEnvVars, (_context, params) =>
    resolvedService.setAppEnvVars(params.appId, params.envVars),
  );
  registry.register(miscContracts.addLog, (_context, entry) =>
    resolvedService.addLog(entry),
  );
  registry.register(miscContracts.clearLogs, (_context, params) =>
    resolvedService.clearLogs(params.appId),
  );
  registry.register(miscContracts.checkProblems, (_context, params) =>
    resolvedService.checkProblems(params.appId),
  );
  registry.register(miscContracts.rendererErrorToastReady, () =>
    resolvedService.rendererErrorToastReady(),
  );
  registry.register(systemContracts.getSystemPlatform, () =>
    resolvedService.getSystemPlatform(),
  );
  registry.register(systemContracts.getInitialLoadTelemetryContext, () =>
    resolvedService.getInitialLoadTelemetryContext(),
  );
  registry.register(systemContracts.getSystemDebugInfo, () =>
    resolvedService.getSystemDebugInfo(),
  );
  registry.register(systemContracts.getAppVersion, () =>
    resolvedService.getAppVersion(),
  );
  registry.register(systemContracts.getNodejsStatus, () =>
    resolvedService.getNodejsStatus(),
  );
  registry.register(systemContracts.installPnpm, () =>
    resolvedService.installPnpm(),
  );
  registry.register(systemContracts.selectAppFolder, () =>
    resolvedService.selectAppFolder(),
  );
  registry.register(systemContracts.getCustomAppsFolder, () =>
    resolvedService.getCustomAppsFolder(),
  );
  registry.register(systemContracts.openExternalUrl, (_context, url) =>
    resolvedService.openExternalUrl(url),
  );
  registry.register(systemContracts.showItemInFolder, (_context, path) =>
    resolvedService.showItemInFolder(path),
  );
  registry.register(systemContracts.openFilePath, (_context, path) =>
    resolvedService.openFilePath(path),
  );
  registry.register(systemContracts.getUserBudget, () =>
    resolvedService.getUserBudget(),
  );
  registry.register(appContracts.getApp, (_context, appId) =>
    resolvedService.getApp(appId),
  );
  registry.register(appContracts.listApps, () => resolvedService.listApps());
  registry.register(appContracts.createApp, (_context, params) =>
    resolvedService.createApp(params),
  );
  registry.register(appContracts.deleteApp, (_context, params) =>
    resolvedService.deleteApp(params.appId),
  );
  registry.register(appContracts.deleteApps, (_context, params) =>
    resolvedService.deleteApps(params.appIds),
  );
  registry.register(appContracts.copyApp, (_context, params) =>
    resolvedService.copyApp(params),
  );
  registry.register(appContracts.renameApp, (_context, params) =>
    resolvedService.renameApp(params),
  );
  registry.register(appContracts.runApp, (_context, params) =>
    resolvedService.runApp(params),
  );
  registry.register(appContracts.stopApp, (_context, params) =>
    resolvedService.stopApp(params),
  );
  registry.register(appContracts.restartApp, (_context, params) =>
    resolvedService.restartApp(params),
  );
  registry.register(appContracts.getRunningAppPreview, (_context, params) =>
    resolvedService.getRunningAppPreview(params),
  );
  registry.register(appContracts.editAppFile, (_context, params) =>
    resolvedService.editAppFile(params),
  );
  registry.register(appContracts.readAppFile, (_context, params) =>
    resolvedService.readAppFile(params),
  );
  registry.register(appContracts.searchAppFiles, (_context, params) =>
    resolvedService.searchAppFiles(params),
  );
  registry.register(appContracts.changeAppLocation, (_context, params) =>
    resolvedService.changeAppLocation(params),
  );
  registry.register(appContracts.addToFavorite, (_context, params) =>
    resolvedService.toggleFavorite(params.appId),
  );
  registry.register(appContracts.selectAppLocation, () =>
    resolvedService.selectAppLocation(),
  );
  registry.register(appContracts.checkAppName, (_context, params) =>
    resolvedService.checkAppName(params.appName),
  );
  registry.register(appContracts.searchApps, (_context, query) =>
    resolvedService.searchApps(query),
  );
  registry.register(appContracts.updateAppCommands, (_context, params) =>
    resolvedService.updateAppCommands(params),
  );
  registry.register(appContracts.respondToAppInput, (_context, params) =>
    resolvedService.respondToAppInput(params),
  );
  registry.register(appContracts.selectAppForPreview, (_context, params) =>
    resolvedService.selectAppForPreview(params),
  );
  registry.register(appContracts.getCurrentCommitHash, (_context, params) =>
    resolvedService.getCurrentCommitHash(params.appId),
  );
  registry.register(appContracts.saveAppScreenshot, (_context, params) =>
    resolvedService.saveAppScreenshot(params),
  );
  registry.register(appContracts.listAppScreenshots, (_context, params) =>
    resolvedService.listAppScreenshots(params.appId),
  );
  registry.register(appContracts.listAppThumbnails, (_context, params) =>
    resolvedService.listAppThumbnails(params.appIds),
  );
  registry.register(chatContracts.getChat, (_context, chatId) =>
    resolvedService.getChat(chatId),
  );
  registry.register(chatContracts.getChats, (_context, appId) =>
    resolvedService.getChats(appId),
  );
  registry.register(chatContracts.getChatMetadata, (_context, chatId) =>
    resolvedService.getChatMetadata(chatId),
  );
  registry.register(chatContracts.createChat, (_context, input) =>
    resolvedService.createChat(input),
  );
  registry.register(chatContracts.updateChat, (_context, params) =>
    resolvedService.updateChat(params),
  );
  registry.register(chatContracts.deleteChat, (_context, chatId) =>
    resolvedService.deleteChat(chatId),
  );
  registry.register(chatContracts.deleteMessages, (_context, chatId) =>
    resolvedService.deleteMessages(chatId),
  );
  registry.register(chatContracts.searchChats, (_context, params) =>
    resolvedService.searchChats(params),
  );
  registry.register(chatStreamStartContract, (_context, params) =>
    resolvedService.startChatStream(eventBridge, params),
  );
  registry.register(chatContracts.cancelStream, (_context, chatId) =>
    resolvedService.cancelChatStream(eventBridge, chatId),
  );
  registry.register(chatContracts.responseAck, (_context, params) =>
    resolvedService.acknowledgeChatResponse(params),
  );
  registry.register(chatContracts.countTokens, (_context, params) =>
    resolvedService.countTokens(params),
  );
  registry.register(proposalContracts.getProposal, (_context, params) =>
    resolvedService.getProposal(params),
  );
  registry.register(proposalContracts.approveProposal, (_context, params) =>
    resolvedService.approveProposal(params),
  );
  registry.register(proposalContracts.rejectProposal, (_context, params) =>
    resolvedService.rejectProposal(params),
  );
  registry.register(agentContracts.getTools, () =>
    resolvedService.getAgentTools(),
  );
  registry.register(agentContracts.setConsent, (_context, params) =>
    resolvedService.setAgentConsent(params),
  );
  registry.register(agentContracts.respondToConsent, (_context, params) =>
    resolvedService.respondToAgentConsent(params),
  );
  registry.register(helpContracts.start, (_context, params) =>
    resolvedService.startHelpChat(eventBridge, params),
  );
  registry.register(helpContracts.cancel, (_context, sessionId) =>
    resolvedService.cancelHelpChat(sessionId),
  );
  registry.register(planContracts.createPlan, (_context, params) =>
    resolvedService.createPlan(params),
  );
  registry.register(planContracts.getPlan, (_context, params) =>
    resolvedService.getPlan(params),
  );
  registry.register(planContracts.getPlanForChat, (_context, params) =>
    resolvedService.getPlanForChat(params),
  );
  registry.register(planContracts.updatePlan, (_context, params) =>
    resolvedService.updatePlan(params),
  );
  registry.register(planContracts.deletePlan, (_context, params) =>
    resolvedService.deletePlan(params),
  );
  registry.register(planContracts.respondToQuestionnaire, (_context, params) =>
    resolvedService.respondToQuestionnaire(params),
  );
  registry.register(integrationContracts.respond, (_context, params) =>
    resolvedService.respondToIntegration(params),
  );
  registry.register(appBlueprintContracts.approve, (_context, params) =>
    resolvedService.approveAppBlueprint(eventBridge, params),
  );
  registry.register(appBlueprintContracts.editField, (_context, params) =>
    resolvedService.editAppBlueprintField(params),
  );
  registry.register(appBlueprintContracts.editVisual, (_context, params) =>
    resolvedService.editAppBlueprintVisual(params),
  );
  registry.register(appBlueprintContracts.addVisual, (_context, params) =>
    resolvedService.addAppBlueprintVisual(params),
  );
  registry.register(appBlueprintContracts.removeVisual, (_context, params) =>
    resolvedService.removeAppBlueprintVisual(params),
  );
  registry.register(templateContracts.getTemplates, () =>
    resolvedService.getTemplates(),
  );
  registry.register(templateContracts.applyAppTemplate, (_context, params) =>
    resolvedService.applyAppTemplate(params),
  );
  registry.register(templateContracts.getThemes, () =>
    resolvedService.getThemes(),
  );
  registry.register(templateContracts.setAppTheme, (_context, params) =>
    resolvedService.setAppTheme(params),
  );
  registry.register(templateContracts.getCustomThemes, () =>
    resolvedService.getCustomThemes(),
  );
  registry.register(templateContracts.getThemeGenerationModelOptions, () =>
    resolvedService.getThemeGenerationModelOptions(),
  );
  registry.register(templateContracts.saveThemeImage, (_context, params) =>
    resolvedService.saveThemeImage(params),
  );
  registry.register(templateContracts.cleanupThemeImages, (_context, params) =>
    resolvedService.cleanupThemeImages(params),
  );
  registry.register(templateContracts.generateThemePrompt, (_context, params) =>
    resolvedService.generateThemePrompt(params),
  );
  registry.register(
    templateContracts.generateThemeFromUrl,
    (_context, params) => resolvedService.generateThemeFromUrl(params),
  );
  registry.register(templateContracts.getAppTheme, (_context, params) =>
    resolvedService.getAppTheme(params.appId),
  );
  registry.register(templateContracts.createCustomTheme, (_context, params) =>
    resolvedService.createCustomTheme(params),
  );
  registry.register(templateContracts.updateCustomTheme, (_context, params) =>
    resolvedService.updateCustomTheme(params),
  );
  registry.register(templateContracts.deleteCustomTheme, (_context, params) =>
    resolvedService.deleteCustomTheme(params.id),
  );
  registry.register(promptContracts.list, () => resolvedService.listPrompts());
  registry.register(promptContracts.create, (_context, params) =>
    resolvedService.createPrompt(params),
  );
  registry.register(promptContracts.update, (_context, params) =>
    resolvedService.updatePrompt(params),
  );
  registry.register(promptContracts.delete, (_context, id) =>
    resolvedService.deletePrompt(id),
  );
  registry.register(appCollectionContracts.list, () =>
    resolvedService.listAppCollections(),
  );
  registry.register(appCollectionContracts.create, (_context, params) =>
    resolvedService.createAppCollection(params),
  );
  registry.register(appCollectionContracts.update, (_context, params) =>
    resolvedService.updateAppCollection(params),
  );
  registry.register(appCollectionContracts.delete, (_context, id) =>
    resolvedService.deleteAppCollection(id),
  );
  registry.register(appCollectionContracts.assignApps, (_context, params) =>
    resolvedService.assignApps(params),
  );
  registry.register(importContracts.importApp, (_context, params) =>
    resolvedService.importApp(params),
  );
  registry.register(importContracts.checkAiRules, (_context, params) =>
    resolvedService.checkAiRules(params.path),
  );
  registry.register(contextContracts.getContextPaths, (_context, params) =>
    resolvedService.getContextPaths(params.appId),
  );
  registry.register(contextContracts.setContextPaths, (_context, params) =>
    resolvedService.setContextPaths(params),
  );
  registry.register(languageModelContracts.getProviders, () =>
    resolvedService.getLanguageModelProviders(),
  );
  registry.register(languageModelContracts.getModels, (_context, params) =>
    resolvedService.getLanguageModels(params.providerId),
  );
  registry.register(languageModelContracts.getModelsByProviders, () =>
    resolvedService.getLanguageModelsByProviders(),
  );
  registry.register(freeAgentQuotaContracts.getFreeAgentQuotaStatus, () =>
    resolvedService.getFreeAgentQuotaStatus(),
  );
  registry.register(mediaContracts.listAllMedia, () =>
    resolvedService.listAllMedia(),
  );
  registry.register(mediaContracts.renameMediaFile, (_context, params) =>
    resolvedService.renameMediaFile(params),
  );
  registry.register(mediaContracts.deleteMediaFile, (_context, params) =>
    resolvedService.deleteMediaFile(params),
  );
  registry.register(mediaContracts.moveMediaFile, (_context, params) =>
    resolvedService.moveMediaFile(params),
  );
  registry.register(terminalContracts.open, (_context, params) =>
    resolvedService.openTerminal(params),
  );
  registry.register(terminalContracts.close, (_context, params) =>
    resolvedService.closeTerminal(params),
  );
  registry.register(terminalContracts.kill, (_context, params) =>
    resolvedService.killTerminal(params),
  );
  registry.register(terminalContracts.write, (_context, params) =>
    resolvedService.writeTerminal(params),
  );
  registry.register(terminalContracts.resize, (_context, params) =>
    resolvedService.resizeTerminal(params),
  );
  registry.register(terminalContracts.serialize, (_context, params) =>
    resolvedService.serializeTerminal(params),
  );
  registry.register(versionContracts.listVersions, (_context, params) =>
    resolvedService.listVersions(params.appId),
  );
  registry.register(versionContracts.getCurrentBranch, (_context, params) =>
    resolvedService.getCurrentBranch(params.appId),
  );
  registry.register(versionContracts.revertVersion, (_context, params) =>
    resolvedService.revertVersion(params),
  );
  registry.register(versionContracts.checkoutVersion, (_context, params) =>
    resolvedService.checkoutVersion(params),
  );
  registry.register(githubContracts.startFlow, (_context, params) =>
    resolvedService.startGithubFlow(eventBridge, params),
  );
  registry.register(githubContracts.listRepos, () =>
    resolvedService.listGithubRepos(),
  );
  registry.register(githubContracts.getRepoBranches, (_context, params) =>
    resolvedService.getGithubRepoBranches(params),
  );
  registry.register(githubContracts.isRepoAvailable, (_context, params) =>
    resolvedService.isGithubRepoAvailable(params),
  );
  registry.register(githubContracts.createRepo, (_context, params) =>
    resolvedService.createGithubRepo(params),
  );
  registry.register(githubContracts.connectExistingRepo, (_context, params) =>
    resolvedService.connectExistingGithubRepo(params),
  );
  registry.register(githubContracts.push, (_context, params) =>
    resolvedService.pushGithub(params),
  );
  registry.register(githubContracts.fetch, (_context, params) =>
    resolvedService.fetchGithub(params),
  );
  registry.register(githubContracts.pull, (_context, params) =>
    resolvedService.pullGithub(params),
  );
  registry.register(githubContracts.rebase, (_context, params) =>
    resolvedService.rebaseGithub(params),
  );
  registry.register(githubContracts.rebaseAbort, (_context, params) =>
    resolvedService.abortGithubRebase(params),
  );
  registry.register(githubContracts.mergeAbort, (_context, params) =>
    resolvedService.abortGithubMerge(params),
  );
  registry.register(githubContracts.rebaseContinue, (_context, params) =>
    resolvedService.continueGithubRebase(params),
  );
  registry.register(githubContracts.listLocalBranches, (_context, params) =>
    resolvedService.listLocalGitBranches(params),
  );
  registry.register(githubContracts.listRemoteBranches, (_context, params) =>
    resolvedService.listRemoteGitBranches(params),
  );
  registry.register(githubContracts.createBranch, (_context, params) =>
    resolvedService.createGitBranch(params),
  );
  registry.register(githubContracts.switchBranch, (_context, params) =>
    resolvedService.switchGitBranch(params),
  );
  registry.register(githubContracts.deleteBranch, (_context, params) =>
    resolvedService.deleteGitBranch(params),
  );
  registry.register(githubContracts.renameBranch, (_context, params) =>
    resolvedService.renameGitBranch(params),
  );
  registry.register(githubContracts.mergeBranch, (_context, params) =>
    resolvedService.mergeGitBranch(params),
  );
  registry.register(githubContracts.getConflicts, (_context, params) =>
    resolvedService.getGitConflicts(params),
  );
  registry.register(githubContracts.getGitState, (_context, params) =>
    resolvedService.getGitState(params),
  );
  registry.register(githubContracts.disconnect, (_context, params) =>
    resolvedService.disconnectGithubRepo(params),
  );
  registry.register(githubContracts.listCollaborators, (_context, params) =>
    resolvedService.listGithubCollaborators(params),
  );
  registry.register(githubContracts.inviteCollaborator, (_context, params) =>
    resolvedService.inviteGithubCollaborator(params),
  );
  registry.register(githubContracts.removeCollaborator, (_context, params) =>
    resolvedService.removeGithubCollaborator(params),
  );
  registry.register(githubContracts.cloneRepoFromUrl, (_context, params) =>
    resolvedService.cloneGithubRepoFromUrl(params),
  );
  registry.register(gitContracts.getUncommittedFiles, (_context, params) =>
    resolvedService.getGitUncommittedFiles(params),
  );
  registry.register(gitContracts.commitChanges, (_context, params) =>
    resolvedService.commitGitChanges(params),
  );
  registry.register(gitContracts.discardChanges, (_context, params) =>
    resolvedService.discardGitChanges(params),
  );
  registry.register(vercelContracts.saveToken, (_context, params) =>
    resolvedService.saveVercelToken(params),
  );
  registry.register(vercelContracts.listProjects, () =>
    resolvedService.listVercelProjects(),
  );
  registry.register(vercelContracts.isProjectAvailable, (_context, params) =>
    resolvedService.isVercelProjectAvailable(params),
  );
  registry.register(vercelContracts.createProject, (_context, params) =>
    resolvedService.createVercelProject(params),
  );
  registry.register(
    vercelContracts.connectExistingProject,
    (_context, params) => resolvedService.connectExistingVercelProject(params),
  );
  registry.register(vercelContracts.getDeployments, (_context, params) =>
    resolvedService.getVercelDeployments(params),
  );
  registry.register(vercelContracts.disconnect, (_context, params) =>
    resolvedService.disconnectVercelProject(params),
  );
  registry.register(vercelContracts.getSyncPreview, (_context, params) =>
    resolvedService.getVercelSyncPreview(params),
  );
  registry.register(vercelContracts.syncNeonConfig, (_context, params) =>
    resolvedService.syncNeonConfigToVercel(params),
  );
  registry.register(vercelContracts.removeNeonEnvVars, (_context, params) =>
    resolvedService.removeNeonEnvVarsFromVercel(params),
  );
  registry.register(
    supabaseContracts.saveOrganizationToken,
    (_context, params) => resolvedService.saveSupabaseOrganizationToken(params),
  );
  registry.register(supabaseContracts.listOrganizations, () =>
    resolvedService.listSupabaseOrganizations(),
  );
  registry.register(supabaseContracts.deleteOrganization, (_context, params) =>
    resolvedService.deleteSupabaseOrganization(params),
  );
  registry.register(supabaseContracts.listAllProjects, () =>
    resolvedService.listSupabaseProjects(),
  );
  registry.register(supabaseContracts.listBranches, (_context, params) =>
    resolvedService.listSupabaseBranches(params),
  );
  registry.register(supabaseContracts.getEdgeLogs, (_context, params) =>
    resolvedService.getSupabaseEdgeLogs(params),
  );
  registry.register(supabaseContracts.setAppProject, (_context, params) =>
    resolvedService.setSupabaseAppProject(params),
  );
  registry.register(supabaseContracts.unsetAppProject, (_context, params) =>
    resolvedService.unsetSupabaseAppProject(params),
  );
  registry.register(
    supabaseContracts.fakeConnectAndSetProject,
    (_context, params) => resolvedService.fakeConnectSupabaseProject(params),
  );
  registry.register(neonContracts.createProject, (_context, params) =>
    resolvedService.createNeonProject(params),
  );
  registry.register(neonContracts.saveApiKey, (_context, params) =>
    resolvedService.saveNeonApiKey(params),
  );
  registry.register(neonContracts.getProject, (_context, params) =>
    resolvedService.getNeonProject(params),
  );
  registry.register(neonContracts.listProjects, () =>
    resolvedService.listNeonProjects(),
  );
  registry.register(neonContracts.setAppProject, (_context, params) =>
    resolvedService.setNeonAppProject(params),
  );
  registry.register(neonContracts.unsetAppProject, (_context, params) =>
    resolvedService.unsetNeonAppProject(params),
  );
  registry.register(neonContracts.setActiveBranch, (_context, params) =>
    resolvedService.setNeonActiveBranch(params),
  );
  registry.register(neonContracts.getEmailPasswordConfig, (_context, params) =>
    resolvedService.getNeonEmailPasswordConfig(params),
  );
  registry.register(neonContracts.updateEmailVerification, (_context, params) =>
    resolvedService.updateNeonEmailVerification(params),
  );
  registry.register(neonContracts.fakeConnect, () =>
    resolvedService.fakeConnectNeon(),
  );
  registry.register(neonContracts.getBranchEnvVars, (_context, params) =>
    resolvedService.getNeonBranchEnvVars(params),
  );
  registry.register(
    neonContracts.setSelectedDatabaseBranchType,
    (_context, params) => resolvedService.setSelectedDatabaseBranchType(params),
  );
  registry.register(mcpContracts.listServers, () =>
    resolvedService.listMcpServers(),
  );
  registry.register(mcpContracts.createServer, (_context, params) =>
    resolvedService.createMcpServer(params),
  );
  registry.register(mcpContracts.updateServer, (_context, params) =>
    resolvedService.updateMcpServer(params),
  );
  registry.register(mcpContracts.deleteServer, (_context, serverId) =>
    resolvedService.deleteMcpServer(serverId),
  );
  registry.register(mcpContracts.getToolConsents, () =>
    resolvedService.listMcpToolConsents(),
  );
  registry.register(mcpContracts.setToolConsent, (_context, params) =>
    resolvedService.setMcpToolConsent(params),
  );
  registry.register(mcpContracts.respondToConsent, (_context, params) =>
    resolvedService.respondToMcpConsent(params),
  );
  registry.register(mcpContracts.listTools, (_context, serverId) =>
    resolvedService.listMcpTools(serverId),
  );
  registry.register(mcpContracts.startOAuth, (_context, params) =>
    resolvedService.startMcpOAuth(params),
  );
  registry.register(mcpContracts.disconnectOAuth, (_context, serverId) =>
    resolvedService.disconnectMcpOAuth(serverId),
  );
  registry.register(mcpContracts.isOauthStorageEncrypted, () =>
    resolvedService.isMcpOauthStorageEncrypted(),
  );
  registry.register(mcpContracts.probeCallbackPort, () =>
    resolvedService.probeMcpCallbackPort(),
  );
  registry.register(mcpContracts.probeConnection, (_context, serverId) =>
    resolvedService.probeMcpConnection(serverId),
  );
  registry.register(
    languageModelContracts.createCustomProvider,
    (_context, params) =>
      resolvedService.createCustomLanguageModelProvider(params),
  );
  registry.register(
    languageModelContracts.editCustomProvider,
    (_context, params) =>
      resolvedService.editCustomLanguageModelProvider(params),
  );
  registry.register(
    languageModelContracts.deleteCustomProvider,
    (_context, params) =>
      resolvedService.deleteCustomLanguageModelProvider(params),
  );
  registry.register(
    languageModelContracts.createCustomModel,
    (_context, params) => resolvedService.createCustomLanguageModel(params),
  );
  registry.register(
    languageModelContracts.deleteCustomModel,
    (_context, modelId) => resolvedService.deleteCustomLanguageModel(modelId),
  );
  registry.register(languageModelContracts.deleteModel, (_context, params) =>
    resolvedService.deleteCustomModel(params),
  );
  registry.register(languageModelContracts.listOllamaModels, () =>
    resolvedService.listOllamaModels(),
  );
  registry.register(languageModelContracts.listLMStudioModels, () =>
    resolvedService.listLmStudioModels(),
  );
  registry.register(
    securityContracts.getLatestSecurityReview,
    (_context, appId) => resolvedService.getLatestSecurityReview(appId),
  );
  registry.register(visualEditingContracts.applyChanges, (_context, params) =>
    resolvedService.applyVisualEditingChanges(params),
  );
  registry.register(
    visualEditingContracts.analyzeComponent,
    (_context, params) => resolvedService.analyzeComponent(params),
  );
  registry.register(upgradeContracts.getAppUpgrades, (_context, params) =>
    resolvedService.getAppUpgrades(params),
  );
  registry.register(upgradeContracts.executeAppUpgrade, (_context, params) =>
    resolvedService.executeAppUpgrade(params),
  );
  registry.register(capacitorContracts.isCapacitor, (_context, params) =>
    resolvedService.isCapacitorApp(params),
  );
  registry.register(capacitorContracts.syncCapacitor, (_context, params) =>
    resolvedService.syncCapacitor(params),
  );
  registry.register(capacitorContracts.openIos, (_context, params) =>
    resolvedService.openIos(params),
  );
  registry.register(capacitorContracts.openAndroid, (_context, params) =>
    resolvedService.openAndroid(params),
  );
  registry.register(
    imageGenerationContracts.generateImage,
    (_context, params) => resolvedService.generateImage(params),
  );
  registry.register(
    imageGenerationContracts.cancelImageGeneration,
    (_context, params) => resolvedService.cancelImageGeneration(params),
  );
  registry.register(audioContracts.transcribeAudio, (_context, params) =>
    resolvedService.transcribeAudio(params),
  );
  registerLocalHttpBackendHandlers(server, registry);
}

async function createDefaultService(): Promise<LocalWebRpcService> {
  const { createDefaultLocalWebCoreService } =
    await import("@/ipc/services/default_local_web_core_service");
  const { createDefaultLocalWebMutationService } =
    await import("@/ipc/services/default_local_web_mutation_service");
  const { createDefaultLocalWebIntegrationService } =
    await import("@/ipc/services/default_local_web_integration_service");
  const { createLocalWebRuntimeService } =
    await import("@/ipc/services/local_web_runtime_service");
  const { createLocalEventStream } = await import("./local_event_stream");
  const { createLocalWebSettingsStore } = await import("./local_web_settings");
  const { createLocalWebPathResolver, getDefaultLocalWebUserDataPath } =
    await import("./local_web_paths");
  const {
    configureCustomAppsFolderSettingReaderForPathResolution,
    configureUserDataPathProviderForPathResolution,
  } = await import("@/paths/paths");
  const { configureLocalWebSettingsStore } = await import("@/main/settings");
  const userDataPath = getDefaultLocalWebUserDataPath();
  const settingsStore = createLocalWebSettingsStore({ userDataPath });
  const pathResolver = createLocalWebPathResolver({
    userDataPath,
    settingsStore,
  });
  configureCustomAppsFolderSettingReaderForPathResolution(
    () => settingsStore.readSettings().customAppsFolder,
    () => pathResolver.defaultAppsDirectory,
    () => pathResolver.getTypeScriptCachePath(),
  );
  configureUserDataPathProviderForPathResolution(() => userDataPath);
  configureLocalWebSettingsStore(settingsStore);
  const events = createLocalEventStream();
  return composeLocalWebRpcService(
    createDefaultLocalWebCoreService({
      settingsStore,
      pathResolver,
      userDataPath,
    }),
    createDefaultLocalWebMutationService({
      settingsStore,
      pathResolver,
      userDataPath,
    }),
    createLocalWebRuntimeService({
      events,
      settingsStore,
      pathResolver,
    }),
    createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    }),
    await createDefaultWorkflowService(),
  );
}

export async function createDefaultWorkflowService(): Promise<
  Pick<
    LocalWebRpcService,
    | "startChatStream"
    | "cancelChatStream"
    | "acknowledgeChatResponse"
    | "countTokens"
    | "getProposal"
    | "approveProposal"
    | "rejectProposal"
    | "getAgentTools"
    | "setAgentConsent"
    | "respondToAgentConsent"
    | "startHelpChat"
    | "cancelHelpChat"
    | "createPlan"
    | "getPlan"
    | "getPlanForChat"
    | "updatePlan"
    | "deletePlan"
    | "respondToQuestionnaire"
    | "respondToIntegration"
    | "approveAppBlueprint"
    | "editAppBlueprintField"
    | "editAppBlueprintVisual"
    | "addAppBlueprintVisual"
    | "removeAppBlueprintVisual"
    | "applyAppTemplate"
  >
> {
  return {
    startChatStream: handleChatStream,
    cancelChatStream,
    acknowledgeChatResponse,
    countTokens: countTokensHandler,
    getProposal: (params) => getProposalHandler(undefined, params),
    approveProposal: (params) => approveProposalHandler(undefined, params),
    rejectProposal: (params) => rejectProposalHandler(undefined, params),
    getAgentTools: async () => getAgentToolsHandler(),
    setAgentConsent: setAgentConsentHandler,
    respondToAgentConsent: respondToAgentConsentHandler,
    startHelpChat: startHelpChatHandler,
    cancelHelpChat: cancelHelpChatHandler,
    createPlan: createPlanHandler,
    getPlan: getPlanHandler,
    getPlanForChat: getPlanForChatHandler,
    updatePlan: updatePlanHandler,
    deletePlan: deletePlanHandler,
    respondToQuestionnaire: respondToQuestionnaireHandler,
    respondToIntegration: respondToIntegrationHandler,
    approveAppBlueprint: approveAppBlueprintHandler,
    editAppBlueprintField: editAppBlueprintFieldHandler,
    editAppBlueprintVisual: editAppBlueprintVisualHandler,
    addAppBlueprintVisual: addAppBlueprintVisualHandler,
    removeAppBlueprintVisual: removeAppBlueprintVisualHandler,
    applyAppTemplate: applyAppTemplateHandler,
  };
}

export function composeLocalWebRpcService(
  coreService: LocalWebCoreService,
  mutationService: LocalWebMutationService,
  ...extraServices: Array<Partial<LocalWebRpcService> | undefined>
): LocalWebRpcService {
  const sources = [coreService, mutationService, ...extraServices] as const;
  return new Proxy({} as LocalWebRpcService, {
    get(_target, property) {
      for (const source of sources) {
        if (!source) {
          continue;
        }
        const value = Reflect.get(source, property, source);
        if (value !== undefined) {
          return typeof value === "function" ? value.bind(source) : value;
        }
      }
      return undefined;
    },
  });
}
