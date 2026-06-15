import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { db } from "@/db";
import {
  language_model_providers as languageModelProviders,
  language_models as languageModels,
} from "@/db/schema";
import type {
  CreateCustomLanguageModelParams,
  CreateCustomLanguageModelProviderParams,
  LanguageModelProvider,
} from "@/ipc/types";
import { CUSTOM_PROVIDER_PREFIX } from "@/ipc/shared/language_model_helpers";
import type { LocalWebHostCapabilities } from "@/server/local_web_host_capabilities";
import { createLocalWebHostCapabilities } from "@/server/local_web_host_capabilities";
import type { LocalWebSettingsStore } from "@/server/local_web_settings";
import { createLocalWebSettingsStore } from "@/server/local_web_settings";
import {
  createLocalWebPathResolver,
  getDefaultLocalWebUserDataPath,
  type LocalWebPathResolver,
} from "@/server/local_web_paths";
import type { LocalWebRpcService } from "@/server/local_web_rpc_registry";
import {
  analyzeVisualEditingComponent,
  applyVisualEditingChanges,
} from "@/pro/main/ipc/services/visual_editing_service";
import { and, eq } from "drizzle-orm";
import { apps } from "@/db/schema";

export interface DefaultLocalWebIntegrationServiceOptions {
  settingsStore?: LocalWebSettingsStore;
  hostCapabilities?: LocalWebHostCapabilities;
  pathResolver?: LocalWebPathResolver;
}

export function createDefaultLocalWebIntegrationService(
  options: DefaultLocalWebIntegrationServiceOptions = {},
): Partial<LocalWebRpcService> {
  const settingsStore =
    options.settingsStore ??
    createLocalWebSettingsStore({
      userDataPath: getDefaultLocalWebUserDataPath(),
    });
  const hostCapabilities =
    options.hostCapabilities ?? createLocalWebHostCapabilities();
  const pathResolver =
    options.pathResolver ??
    createLocalWebPathResolver({
      userDataPath: settingsStore.userDataPath,
      settingsStore,
    });
  const unsupported = (feature: string): never => {
    throw new DyadError(
      `${feature} is not available in Local Web mode yet.`,
      DyadErrorKind.Precondition,
    );
  };
  const authRequired = (provider: string): never => {
    throw new DyadError(
      `Not authenticated with ${provider}.`,
      DyadErrorKind.Auth,
    );
  };

  return {
    startGithubFlow: () => unsupported("GitHub device flow"),
    listGithubRepos: async () => {
      if (!settingsStore.readSettings().githubAccessToken?.value) {
        authRequired("GitHub");
      }
      return [];
    },
    getGithubRepoBranches: async () => {
      if (!settingsStore.readSettings().githubAccessToken?.value) {
        authRequired("GitHub");
      }
      return [];
    },
    isGithubRepoAvailable: async () => ({ available: true }),
    createGithubRepo: () => unsupported("GitHub repository creation"),
    connectExistingGithubRepo: () => unsupported("GitHub repository linking"),
    pushGithub: () => unsupported("GitHub push"),
    fetchGithub: () => unsupported("GitHub fetch"),
    pullGithub: () => unsupported("GitHub pull"),
    rebaseGithub: () => unsupported("GitHub rebase"),
    abortGithubRebase: () => unsupported("GitHub rebase abort"),
    abortGithubMerge: () => unsupported("GitHub merge abort"),
    continueGithubRebase: () => unsupported("GitHub rebase continue"),
    listLocalGitBranches: async () => ({ branches: [], current: null }),
    listRemoteGitBranches: async () => [],
    createGitBranch: () => unsupported("Git branch creation"),
    switchGitBranch: () => unsupported("Git branch switching"),
    deleteGitBranch: () => unsupported("Git branch deletion"),
    renameGitBranch: () => unsupported("Git branch rename"),
    mergeGitBranch: () => unsupported("Git branch merge"),
    getGitConflicts: async () => [],
    getGitState: async () => ({
      mergeInProgress: false,
      rebaseInProgress: false,
    }),
    disconnectGithubRepo: () => unsupported("GitHub disconnect"),
    listGithubCollaborators: async () => {
      if (!settingsStore.readSettings().githubAccessToken?.value) {
        authRequired("GitHub");
      }
      return [];
    },
    inviteGithubCollaborator: () => unsupported("GitHub collaborator invite"),
    removeGithubCollaborator: () => unsupported("GitHub collaborator removal"),
    cloneGithubRepoFromUrl: async () => ({
      error: "Clone from GitHub URL is not available in Local Web mode yet.",
    }),
    getGitUncommittedFiles: async () => [],
    commitGitChanges: () => unsupported("Git commit"),
    discardGitChanges: () => unsupported("Git discard changes"),

    saveVercelToken: async ({ token }: { token: string }) => {
      settingsStore.writeSettings({
        vercelAccessToken: { value: token.trim() },
      });
    },
    listVercelProjects: async () => {
      if (!settingsStore.readSettings().vercelAccessToken?.value) {
        authRequired("Vercel");
      }
      return [];
    },
    isVercelProjectAvailable: async () => ({ available: false }),
    createVercelProject: () => unsupported("Vercel project creation"),
    connectExistingVercelProject: () => unsupported("Vercel project linking"),
    getVercelDeployments: async () => [],
    disconnectVercelProject: () => unsupported("Vercel disconnect"),
    getVercelSyncPreview: async () => ({
      vercelProjectName: null,
      branchType: "production" as const,
      envKeys: [],
      cookieSecretIncluded: false,
      target: ["production" as const],
      trustedDomainOrigins: [],
      authActive: false,
    }),
    syncNeonConfigToVercel: async () => ({
      envPushed: false,
      domainsAdded: [],
      skipped: ["Vercel sync is not available in Local Web mode yet."],
    }),
    removeNeonEnvVarsFromVercel: async () => ({ removedKeys: [] }),

    listSupabaseOrganizations: async () => [],
    deleteSupabaseOrganization: () =>
      unsupported("Supabase organization delete"),
    listSupabaseProjects: async () => [],
    listSupabaseBranches: async () => [],
    getSupabaseEdgeLogs: async () => [],
    setSupabaseAppProject: () => unsupported("Supabase project linking"),
    unsetSupabaseAppProject: () => unsupported("Supabase project unlinking"),
    fakeConnectSupabaseProject: () => unsupported("Supabase fake connect"),

    createNeonProject: () => unsupported("Neon project creation"),
    getNeonProject: () => unsupported("Neon project lookup"),
    listNeonProjects: async () => ({ projects: [] }),
    setNeonAppProject: () => unsupported("Neon project linking"),
    unsetNeonAppProject: async () => ({ success: true }),
    setNeonActiveBranch: () => unsupported("Neon active branch selection"),
    getNeonEmailPasswordConfig: () => unsupported("Neon auth config"),
    updateNeonEmailVerification: () => unsupported("Neon auth config update"),
    fakeConnectNeon: () => unsupported("Neon fake connect"),
    getNeonBranchEnvVars: () => unsupported("Neon branch env vars"),
    setSelectedDatabaseBranchType: async () => ({ success: true }),

    createMcpServer: async (params: any) => {
      parseJsonField(params.args, "args");
      parseJsonField(params.envJson, "envJson");
      parseJsonField(params.headersJson, "headersJson");
      return {
        id: 0,
        name: params.name,
        transport: params.transport ?? "stdio",
        command: params.command ?? null,
        args: Array.isArray(params.args) ? params.args : null,
        envJson: typeof params.envJson === "object" ? params.envJson : null,
        headersJson:
          typeof params.headersJson === "object" ? params.headersJson : null,
        url: params.url ?? null,
        enabled: params.enabled ?? false,
        oauthEnabled: params.transport === "http" && !!params.oauthEnabled,
        oauthConnected: false,
        oauthCallbackPort: params.oauthCallbackPort ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    updateMcpServer: () => unsupported("MCP server update"),
    deleteMcpServer: async () => ({ success: true }),
    setMcpToolConsent: async (params: any) => ({
      id: 0,
      serverId: params.serverId,
      toolName: params.toolName,
      consent: params.consent,
      updatedAt: new Date(),
    }),
    respondToMcpConsent: async () => undefined,
    startMcpOAuth: async () => ({
      success: false,
      error: "MCP OAuth is not connected in Local Web mode.",
      errorKind: "other" as const,
    }),
    disconnectMcpOAuth: async () => ({ success: true }),
    probeMcpConnection: async () => ({
      status: "error" as const,
      error: "MCP connection probing is not available in Local Web mode yet.",
    }),

    createCustomLanguageModelProvider,
    editCustomLanguageModelProvider,
    deleteCustomLanguageModelProvider,
    createCustomLanguageModel,
    deleteCustomLanguageModel,
    deleteCustomModel,
    listOllamaModels: async () => ({ models: [] }),
    listLmStudioModels: async () => ({ models: [] }),

    getLatestSecurityReview: async () => ({
      findings: [],
      timestamp: new Date().toISOString(),
      chatId: 0,
    }),
    applyVisualEditingChanges: async (params) => {
      await applyVisualEditingChanges(params, {
        findAppById,
        resolveAppPath: (appPath) => pathResolver.getDyadAppPath(appPath),
      });
    },
    analyzeComponent: (params) =>
      analyzeVisualEditingComponent(params, {
        findAppById,
        resolveAppPath: (appPath) => pathResolver.getDyadAppPath(appPath),
      }),
    getAppUpgrades: async () => [],
    executeAppUpgrade: () => unsupported("App upgrade execution"),
    isCapacitorApp: async () => false,
    syncCapacitor: () => unsupported("Capacitor sync"),
    openIos: () => unsupported("Opening iOS project"),
    openAndroid: () => unsupported("Opening Android project"),
    generateImage: () => unsupported("Image generation"),
    cancelImageGeneration: async () => ({ cancelled: false }),
    transcribeAudio: () => unsupported("Audio transcription"),
    openExternalUrl: async (url: string) => {
      await hostCapabilities.openExternalUrl(url);
    },
    showItemInFolder: async (path: string) => {
      await hostCapabilities.showItemInFolder(path);
    },
    openFilePath: async () => unsupported("Opening local files"),
  };
}

async function findAppById(appId: number) {
  return db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
}

function parseJsonField(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }
  try {
    JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DyadError(
      `Invalid JSON for "${field}": ${message}`,
      DyadErrorKind.Validation,
    );
  }
}

function createCustomLanguageModelProvider(
  params: CreateCustomLanguageModelProviderParams,
): LanguageModelProvider {
  const normalized = validateProviderParams(params);
  const existingProvider = db
    .select({ id: languageModelProviders.id })
    .from(languageModelProviders)
    .where(eq(languageModelProviders.id, normalized.id))
    .get();

  if (existingProvider) {
    throw new DyadError(
      `A provider with ID "${normalized.id}" already exists`,
      DyadErrorKind.Conflict,
    );
  }

  db.insert(languageModelProviders)
    .values({
      id: normalized.id,
      name: normalized.name,
      api_base_url: normalized.apiBaseUrl,
      env_var_name: normalized.envVarName ?? null,
    })
    .run();

  return toCustomProvider(normalized);
}

function editCustomLanguageModelProvider(
  params: CreateCustomLanguageModelProviderParams,
): LanguageModelProvider {
  const normalized = validateProviderParams(params);
  const result = db
    .update(languageModelProviders)
    .set({
      name: normalized.name,
      api_base_url: normalized.apiBaseUrl,
      env_var_name: normalized.envVarName ?? null,
      updatedAt: new Date(),
    })
    .where(eq(languageModelProviders.id, normalized.id))
    .run();

  if (result.changes === 0) {
    throw new DyadError(
      `Provider with ID "${normalized.id}" not found`,
      DyadErrorKind.NotFound,
    );
  }

  return toCustomProvider(normalized);
}

function deleteCustomLanguageModelProvider(params: {
  providerId: string;
}): void {
  const providerId = normalizeCustomProviderId(params.providerId);
  if (!providerId) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }

  db.transaction((tx) => {
    tx.delete(languageModels)
      .where(eq(languageModels.customProviderId, providerId))
      .run();
    tx.delete(languageModelProviders)
      .where(eq(languageModelProviders.id, providerId))
      .run();
  });
}

function createCustomLanguageModel(
  params: CreateCustomLanguageModelParams,
): void {
  const providerId = normalizeCustomProviderId(params.providerId);
  const apiName = params.apiName.trim();
  const displayName = params.displayName.trim();

  if (!apiName) {
    throw new DyadError("Model API name is required", DyadErrorKind.Validation);
  }
  if (!displayName) {
    throw new DyadError(
      "Model display name is required",
      DyadErrorKind.Validation,
    );
  }
  if (!providerId) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }
  ensureCustomProviderExists(providerId);

  db.insert(languageModels)
    .values({
      displayName,
      apiName,
      customProviderId: providerId,
      description: params.description?.trim() || null,
      max_output_tokens: params.maxOutputTokens ?? null,
      context_window: params.contextWindow ?? null,
    })
    .run();
}

function deleteCustomLanguageModel(
  modelId: string | { modelId: string },
): void {
  const apiName = typeof modelId === "string" ? modelId : modelId.modelId;
  if (!apiName?.trim()) {
    throw new DyadError("Model API name is required", DyadErrorKind.Validation);
  }

  db.delete(languageModels)
    .where(eq(languageModels.apiName, apiName.trim()))
    .run();
}

function deleteCustomModel(params: {
  providerId: string;
  modelApiName: string;
}): void {
  const providerId = normalizeCustomProviderId(params.providerId);
  const modelApiName = params.modelApiName.trim();
  if (!providerId || !modelApiName) {
    throw new DyadError(
      "Provider ID and model API name are required",
      DyadErrorKind.Validation,
    );
  }

  db.delete(languageModels)
    .where(
      and(
        eq(languageModels.customProviderId, providerId),
        eq(languageModels.apiName, modelApiName),
      ),
    )
    .run();
}

function validateProviderParams(
  params: CreateCustomLanguageModelProviderParams,
) {
  const id = normalizeCustomProviderId(params.id);
  const name = params.name.trim();
  const apiBaseUrl = params.apiBaseUrl.trim();
  const envVarName = params.envVarName?.trim() || undefined;

  if (!id) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }
  if (!name) {
    throw new DyadError("Provider name is required", DyadErrorKind.Validation);
  }
  if (!apiBaseUrl) {
    throw new DyadError("API base URL is required", DyadErrorKind.Validation);
  }

  return { id, name, apiBaseUrl, envVarName };
}

function normalizeCustomProviderId(providerId: string): string {
  const trimmed = providerId.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(CUSTOM_PROVIDER_PREFIX)
    ? trimmed
    : `${CUSTOM_PROVIDER_PREFIX}${trimmed}`;
}

function ensureCustomProviderExists(providerId: string): void {
  const provider = db
    .select({ id: languageModelProviders.id })
    .from(languageModelProviders)
    .where(eq(languageModelProviders.id, providerId))
    .get();
  if (!provider) {
    throw new DyadError(
      `Provider with ID "${providerId}" not found`,
      DyadErrorKind.NotFound,
    );
  }
}

function toCustomProvider(params: {
  id: string;
  name: string;
  apiBaseUrl: string;
  envVarName?: string;
}): LanguageModelProvider {
  return {
    ...params,
    type: "custom",
    isCustom: true,
  };
}
