import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createHttpInvokeTransport } from "@/ipc/contracts/core";
import { githubContracts, gitContracts } from "@/ipc/types/github";
import { mcpContracts } from "@/ipc/types/mcp";
import { vercelContracts } from "@/ipc/types/vercel";
import { supabaseContracts } from "@/ipc/types/supabase";
import { neonContracts } from "@/ipc/types/neon";
import { languageModelContracts } from "@/ipc/types/language-model";
import { securityContracts } from "@/ipc/types/security";
import { visualEditingContracts } from "@/ipc/types/visual-editing";
import { upgradeContracts } from "@/ipc/types/upgrade";
import { capacitorContracts } from "@/ipc/types/capacitor";
import { imageGenerationContracts } from "@/ipc/types/image_generation";
import { audioContracts } from "@/ipc/types/audio";
import { systemContracts } from "@/ipc/types/system";
import {
  LOCAL_WEB_RPC_ALLOWLIST,
  registerLocalWebRpcHandlers,
  type LocalWebRpcService,
} from "./local_web_rpc_registry";
import { createLocalRpcServer, type LocalRpcServer } from "./local_rpc_server";

const origin = "http://localhost:5173";
const now = new Date("2026-06-11T00:00:00.000Z");

describe("local Web integration registry", () => {
  let server: LocalRpcServer | undefined;
  let baseUrl = "";

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("exposes Web integration channels for provider, source control, MCP, and explicit fallback surfaces", () => {
    expect(LOCAL_WEB_RPC_ALLOWLIST).toEqual(
      expect.arrayContaining([
        githubContracts.startFlow.channel,
        githubContracts.listRepos.channel,
        githubContracts.isRepoAvailable.channel,
        githubContracts.listLocalBranches.channel,
        gitContracts.getUncommittedFiles.channel,
        vercelContracts.saveToken.channel,
        vercelContracts.listProjects.channel,
        supabaseContracts.listOrganizations.channel,
        supabaseContracts.setAppProject.channel,
        neonContracts.listProjects.channel,
        neonContracts.setSelectedDatabaseBranchType.channel,
        mcpContracts.createServer.channel,
        mcpContracts.updateServer.channel,
        mcpContracts.deleteServer.channel,
        mcpContracts.setToolConsent.channel,
        mcpContracts.startOAuth.channel,
        mcpContracts.disconnectOAuth.channel,
        mcpContracts.probeConnection.channel,
        languageModelContracts.createCustomProvider.channel,
        languageModelContracts.listOllamaModels.channel,
        securityContracts.getLatestSecurityReview.channel,
        visualEditingContracts.analyzeComponent.channel,
        upgradeContracts.getAppUpgrades.channel,
        capacitorContracts.isCapacitor.channel,
        imageGenerationContracts.generateImage.channel,
        audioContracts.transcribeAudio.channel,
        systemContracts.openExternalUrl.channel,
        systemContracts.showItemInFolder.channel,
        systemContracts.installPnpm.channel,
      ]),
    );
  });

  it("serves representative integration success and fallback flows over authenticated HTTP", async () => {
    const service = createIntegrationService();
    await startRegistryServer(service);
    const transport = createTransport(baseUrl);

    await expect(
      transport.invoke(githubContracts.listLocalBranches.channel, {
        appId: 1,
      }),
    ).resolves.toEqual({ branches: ["main", "feature"], current: "main" });
    await expect(
      transport.invoke(gitContracts.getUncommittedFiles.channel, { appId: 1 }),
    ).resolves.toEqual([{ path: "src/App.tsx", status: "modified" }]);
    await expect(
      transport.invoke(vercelContracts.saveToken.channel, {
        token: "vercel-token",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke(supabaseContracts.setAppProject.channel, {
        appId: 1,
        projectId: "supabase-project",
        organizationSlug: "org",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke(neonContracts.listProjects.channel, undefined),
    ).resolves.toEqual({
      projects: [
        {
          id: "neon-project",
          name: "Neon Project",
          regionId: "aws-us-east-1",
          createdAt: now.toISOString(),
        },
      ],
    });
    await expect(
      transport.invoke(mcpContracts.createServer.channel, {
        name: "Local Docs",
        transport: "http",
        url: "https://example.com/mcp",
        enabled: true,
      }),
    ).resolves.toMatchObject({
      id: 2,
      name: "Local Docs",
      oauthConnected: false,
    });
    await expect(
      transport.invoke(
        languageModelContracts.listOllamaModels.channel,
        undefined,
      ),
    ).resolves.toEqual({ models: [] });
    await expect(
      transport.invoke(capacitorContracts.isCapacitor.channel, {
        appId: 1,
      }),
    ).resolves.toBe(false);
    await expect(
      transport.invoke(systemContracts.installPnpm.channel, undefined),
    ).resolves.toEqual({ pnpmVersion: "11.1.2" });

    expect(service.saveVercelToken).toHaveBeenCalledWith({
      token: "vercel-token",
    });
    expect(service.setSupabaseAppProject).toHaveBeenCalledOnce();
    expect(service.createMcpServer).toHaveBeenCalledOnce();
  });

  it("classifies auth, precondition, validation, and unsupported integration failures", async () => {
    const service = createIntegrationService({
      listGithubRepos: vi.fn(async () => {
        throw new DyadError(
          "Not authenticated with GitHub.",
          DyadErrorKind.Auth,
        );
      }),
      pushGithub: vi.fn(async () => {
        throw new DyadError(
          "App is not linked to a GitHub repo.",
          DyadErrorKind.Precondition,
        );
      }),
      startGithubFlow: vi.fn(async () => {
        throw new DyadError(
          "GitHub device flow is not available in Local Web mode yet.",
          DyadErrorKind.Precondition,
        );
      }),
    });
    await startRegistryServer(service);

    await expect(
      rpc(githubContracts.listRepos.channel, undefined),
    ).resolves.toEqual({
      status: 401,
      body: {
        ok: false,
        error: "Not authenticated with GitHub.",
        kind: "auth",
      },
    });
    await expect(
      rpc(githubContracts.push.channel, { appId: 1 }),
    ).resolves.toEqual({
      status: 409,
      body: {
        ok: false,
        error: "App is not linked to a GitHub repo.",
        kind: "precondition",
      },
    });
    const invalidMcpResponse = await rpc(mcpContracts.createServer.channel, {
      name: "Broken",
      transport: "http",
      envJson: "{",
    });
    expect(invalidMcpResponse.status).toBe(400);
    expect(invalidMcpResponse.body).toMatchObject({
      ok: false,
      kind: "validation",
    });
    expect(invalidMcpResponse.body.error).toContain(
      'Invalid JSON for "envJson":',
    );
    await expect(
      rpc(githubContracts.startFlow.channel, { appId: null }),
    ).resolves.toEqual({
      status: 409,
      body: {
        ok: false,
        error: "GitHub device flow is not available in Local Web mode yet.",
        kind: "precondition",
      },
    });
    await expect(
      rpc(
        systemContracts.openExternalUrl.channel,
        "file:///private/etc/passwd",
      ),
    ).resolves.toEqual({
      status: 400,
      body: {
        ok: false,
        error: "External URL must be http(s)",
        kind: "validation",
      },
    });
  });

  async function startRegistryServer(service: LocalWebRpcService) {
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
    });
    await registerLocalWebRpcHandlers(server, service);
    const listening = await server.listen();
    baseUrl = listening.url;
  }

  async function rpc(channel: string, input: unknown) {
    const response = await nodeFetch(
      `${baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
      {
        method: "POST",
        headers: rpcHeaders(),
        body: JSON.stringify(input),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  }
});

function createTransport(baseUrl: string) {
  return createHttpInvokeTransport({
    baseUrl,
    token: "local-token",
    fetch: nodeFetch,
    headers: { origin },
  });
}

function createIntegrationService(
  overrides: Partial<LocalWebRpcService> = {},
): LocalWebRpcService {
  const unsupported = vi.fn(async (feature: string): Promise<never> => {
    throw new DyadError(
      `${feature} is not available in Local Web mode.`,
      DyadErrorKind.Precondition,
    );
  });
  const service = {
    startGithubFlow: vi.fn(async () => unsupported("GitHub device flow")),
    listGithubRepos: vi.fn(async () => []),
    getGithubRepoBranches: vi.fn(async () => []),
    isGithubRepoAvailable: vi.fn(async () => ({ available: true })),
    createGithubRepo: vi.fn(async () => undefined),
    connectExistingGithubRepo: vi.fn(async () => undefined),
    pushGithub: vi.fn(async () => undefined),
    fetchGithub: vi.fn(async () => undefined),
    pullGithub: vi.fn(async () => undefined),
    rebaseGithub: vi.fn(async () => undefined),
    abortGithubRebase: vi.fn(async () => undefined),
    abortGithubMerge: vi.fn(async () => undefined),
    continueGithubRebase: vi.fn(async () => undefined),
    listLocalGitBranches: vi.fn(async () => ({
      branches: ["main", "feature"],
      current: "main",
    })),
    listRemoteGitBranches: vi.fn(async () => []),
    createGitBranch: vi.fn(async () => undefined),
    switchGitBranch: vi.fn(async () => undefined),
    deleteGitBranch: vi.fn(async () => undefined),
    renameGitBranch: vi.fn(async () => undefined),
    mergeGitBranch: vi.fn(async () => undefined),
    getGitConflicts: vi.fn(async () => []),
    getGitState: vi.fn(async () => ({
      mergeInProgress: false,
      rebaseInProgress: false,
    })),
    disconnectGithubRepo: vi.fn(async () => undefined),
    listGithubCollaborators: vi.fn(async () => []),
    inviteGithubCollaborator: vi.fn(async () => undefined),
    removeGithubCollaborator: vi.fn(async () => undefined),
    cloneGithubRepoFromUrl: vi.fn(async () => ({
      error: "Clone is not available in this test",
    })),
    getGitUncommittedFiles: vi.fn(async () => [
      { path: "src/App.tsx", status: "modified" as const },
    ]),
    commitGitChanges: vi.fn(async () => "commit-sha"),
    discardGitChanges: vi.fn(async () => undefined),
    saveVercelToken: vi.fn(async () => undefined),
    listVercelProjects: vi.fn(async () => []),
    isVercelProjectAvailable: vi.fn(async () => ({ available: true })),
    createVercelProject: vi.fn(async () => undefined),
    connectExistingVercelProject: vi.fn(async () => undefined),
    getVercelDeployments: vi.fn(async () => []),
    disconnectVercelProject: vi.fn(async () => undefined),
    getVercelSyncPreview: vi.fn(async () => ({
      vercelProjectName: null,
      branchType: "production" as const,
      envKeys: [],
      cookieSecretIncluded: false,
      target: ["production" as const],
      trustedDomainOrigins: [],
      authActive: false,
    })),
    syncNeonConfigToVercel: vi.fn(async () => ({
      envPushed: false,
      domainsAdded: [],
      skipped: [],
    })),
    removeNeonEnvVarsFromVercel: vi.fn(async () => ({ removedKeys: [] })),
    listSupabaseOrganizations: vi.fn(async () => []),
    deleteSupabaseOrganization: vi.fn(async () => undefined),
    listSupabaseProjects: vi.fn(async () => []),
    listSupabaseBranches: vi.fn(async () => []),
    getSupabaseEdgeLogs: vi.fn(async () => []),
    setSupabaseAppProject: vi.fn(async () => undefined),
    unsetSupabaseAppProject: vi.fn(async () => undefined),
    fakeConnectSupabaseProject: vi.fn(async () => undefined),
    createNeonProject: vi.fn(async () => ({
      id: "neon-project",
      name: "Neon Project",
      connectionString: "postgres://example",
      branchId: "br-main",
    })),
    getNeonProject: vi.fn(async () => ({
      projectId: "neon-project",
      projectName: "Neon Project",
      orgId: "org",
      branches: [],
    })),
    listNeonProjects: vi.fn(async () => ({
      projects: [
        {
          id: "neon-project",
          name: "Neon Project",
          regionId: "aws-us-east-1",
          createdAt: now.toISOString(),
        },
      ],
    })),
    setNeonAppProject: vi.fn(async () => ({ success: true })),
    unsetNeonAppProject: vi.fn(async () => ({ success: true })),
    setNeonActiveBranch: vi.fn(async () => ({ success: true })),
    getNeonEmailPasswordConfig: vi.fn(async () => ({
      enabled: false,
      email_verification_method: "link" as const,
      require_email_verification: false,
      auto_sign_in_after_verification: false,
      send_verification_email_on_sign_up: false,
      send_verification_email_on_sign_in: false,
      disable_sign_up: false,
    })),
    updateNeonEmailVerification: vi.fn(async () => ({
      enabled: false,
      email_verification_method: "link" as const,
      require_email_verification: true,
      auto_sign_in_after_verification: false,
      send_verification_email_on_sign_up: false,
      send_verification_email_on_sign_in: false,
      disable_sign_up: false,
    })),
    fakeConnectNeon: vi.fn(async () => undefined),
    getNeonBranchEnvVars: vi.fn(async () => ({
      databaseUrl: "postgres://example",
    })),
    setSelectedDatabaseBranchType: vi.fn(async () => ({ success: true })),
    createMcpServer: vi.fn(async (params) => {
      parseJsonField(params.args, "args");
      parseJsonField(params.envJson, "envJson");
      parseJsonField(params.headersJson, "headersJson");
      return {
        id: 2,
        name: params.name,
        transport: params.transport ?? "stdio",
        command: params.command ?? null,
        args: Array.isArray(params.args) ? params.args : null,
        envJson: typeof params.envJson === "object" ? params.envJson : null,
        headersJson:
          typeof params.headersJson === "object" ? params.headersJson : null,
        url: params.url ?? null,
        enabled: params.enabled ?? false,
        oauthEnabled: params.oauthEnabled ?? false,
        oauthConnected: false,
        oauthCallbackPort: null,
        createdAt: now,
        updatedAt: now,
      };
    }),
    updateMcpServer: vi.fn(async () => ({
      id: 2,
      name: "Updated",
      transport: "http" as const,
      command: null,
      args: null,
      envJson: null,
      headersJson: null,
      url: "https://example.com/mcp",
      enabled: true,
      oauthEnabled: false,
      oauthConnected: false,
      oauthCallbackPort: null,
      createdAt: now,
      updatedAt: now,
    })),
    deleteMcpServer: vi.fn(async () => ({ success: true })),
    setMcpToolConsent: vi.fn(async (params) => ({
      id: 1,
      serverId: params.serverId,
      toolName: params.toolName,
      consent: params.consent,
      updatedAt: now,
    })),
    respondToMcpConsent: vi.fn(async () => undefined),
    startMcpOAuth: vi.fn(async () => ({
      success: false,
      error: "OAuth server not configured",
      errorKind: "discovery_failed" as const,
    })),
    disconnectMcpOAuth: vi.fn(async () => ({ success: true })),
    probeMcpConnection: vi.fn(async () => ({
      status: "error" as const,
      error: "Server unavailable",
    })),
    createCustomLanguageModelProvider: vi.fn(async (params) => ({
      ...params,
      type: "custom" as const,
      isCustom: true,
    })),
    editCustomLanguageModelProvider: vi.fn(async (params) => ({
      ...params,
      type: "custom" as const,
      isCustom: true,
    })),
    deleteCustomLanguageModelProvider: vi.fn(async () => undefined),
    createCustomLanguageModel: vi.fn(async () => undefined),
    deleteCustomLanguageModel: vi.fn(async () => undefined),
    deleteCustomModel: vi.fn(async () => undefined),
    listOllamaModels: vi.fn(async () => ({ models: [] })),
    listLmStudioModels: vi.fn(async () => ({ models: [] })),
    getLatestSecurityReview: vi.fn(async () => ({
      findings: [],
      timestamp: now.toISOString(),
      chatId: 1,
    })),
    applyVisualEditingChanges: vi.fn(async () => undefined),
    analyzeComponent: vi.fn(async () => ({
      isDynamic: false,
      hasStaticText: false,
      hasImage: false,
    })),
    getAppUpgrades: vi.fn(async () => []),
    executeAppUpgrade: vi.fn(async () => undefined),
    isCapacitorApp: vi.fn(async () => false),
    syncCapacitor: vi.fn(async () => undefined),
    openIos: vi.fn(async () => undefined),
    openAndroid: vi.fn(async () => undefined),
    generateImage: vi.fn(async () => ({
      fileName: "image.png",
      filePath: "/tmp/image.png",
      appPath: "/tmp/app",
      appId: 1,
      appName: "App",
    })),
    cancelImageGeneration: vi.fn(async () => ({ cancelled: true })),
    transcribeAudio: vi.fn(async () => ({
      text: "",
    })),
    openExternalUrl: vi.fn(async (url) => {
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new DyadError(
          "External URL must be http(s)",
          DyadErrorKind.Validation,
        );
      }
      return undefined;
    }),
    showItemInFolder: vi.fn(async () => undefined),
    openFilePath: vi.fn(async () => undefined),
    installPnpm: vi.fn(async () => ({ pnpmVersion: "11.1.2" })),
  } as unknown as LocalWebRpcService;
  return Object.assign(service, overrides);
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

function rpcHeaders(): Record<string, string> {
  return {
    authorization: "Bearer local-token",
    "content-type": "application/json",
    origin,
  };
}

async function nodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  const body =
    typeof init?.body === "string" || init?.body instanceof Buffer
      ? init.body
      : undefined;

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: init?.headers as http.OutgoingHttpHeaders | undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}
