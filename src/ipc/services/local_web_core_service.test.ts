import { beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { createLocalWebCoreService } from "./local_web_core_service";

const now = new Date("2026-06-11T00:00:00.000Z");

describe("LocalWebCoreService", () => {
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    deps = createDeps();
  });

  it("reads an app through injected dependencies", async () => {
    deps.findAppById.mockResolvedValue(createAppRecord());
    const service = createLocalWebCoreService(deps);

    await expect(service.getApp(1)).resolves.toMatchObject({
      id: 1,
      name: "Test App",
      files: ["src/App.tsx", "package.json"],
      frameworkType: "vite",
      resolvedPath: "/apps/test-app",
      supabaseProjectName: "Supabase Project",
      vercelTeamSlug: "team-slug",
    });
    expect(deps.findAppById).toHaveBeenCalledWith(1);
    expect(deps.listAppFiles).toHaveBeenCalledWith("/apps/test-app");
    expect(deps.getSupabaseProjectName).toHaveBeenCalledWith(
      "parent-project",
      "org-slug",
    );
    expect(deps.getVercelTeamSlug).toHaveBeenCalledWith("team-id");
  });

  it("keeps returning app data when file listing fails", async () => {
    deps.findAppById.mockResolvedValue(createAppRecord());
    deps.listAppFiles.mockImplementation(() => {
      throw new Error("filesystem unavailable");
    });
    const service = createLocalWebCoreService(deps);

    await expect(service.getApp(1)).resolves.toMatchObject({
      id: 1,
      files: [],
    });
    expect(deps.onRecoverableError).toHaveBeenCalledWith(
      "Error reading files for app 1:",
      expect.any(Error),
    );
  });

  it("throws NotFound for a missing app", async () => {
    deps.findAppById.mockResolvedValue(undefined);
    const service = createLocalWebCoreService(deps);

    await expect(service.getApp(404)).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "App not found",
    });
  });

  it("reads a chat with normalized message roles and chat mode", async () => {
    deps.findChatWithMessagesById.mockResolvedValue({
      id: 7,
      appId: 1,
      title: null,
      initialCommitHash: "abc123",
      createdAt: now,
      compactedAt: null,
      compactionBackupPath: null,
      pendingCompaction: null,
      chatMode: "agent",
      messages: [
        createMessageRecord({
          id: 10,
          role: "user",
          content: "hello",
        }),
        createMessageRecord({
          id: 11,
          role: "assistant",
          content: "hi",
        }),
      ],
    });
    const service = createLocalWebCoreService(deps);

    await expect(service.getChat(7)).resolves.toMatchObject({
      id: 7,
      title: "",
      chatMode: "build",
      messages: [
        { id: 10, role: "user", content: "hello" },
        { id: 11, role: "assistant", content: "hi" },
      ],
    });
    expect(deps.findChatWithMessagesById).toHaveBeenCalledWith(7);
  });

  it("throws NotFound for a missing chat", async () => {
    deps.findChatWithMessagesById.mockResolvedValue(undefined);
    const service = createLocalWebCoreService(deps);

    await expect(service.getChat(404)).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Chat not found",
    });
  });

  it("lists apps with resolved paths", async () => {
    deps.listApps.mockResolvedValue([
      createAppRecord({ id: 1, path: "test-app" }),
      createAppRecord({ id: 2, path: "/external/app" }),
    ] as any);
    deps.resolveAppPath.mockImplementation((appPath: string) =>
      appPath.startsWith("/") ? appPath : `/apps/${appPath}`,
    );
    const service = createLocalWebCoreService(deps);

    await expect(service.listApps()).resolves.toMatchObject({
      apps: [
        { id: 1, resolvedPath: "/apps/test-app" },
        { id: 2, resolvedPath: "/external/app" },
      ],
    });
  });

  it("reads chat summaries and metadata with migrated chat modes", async () => {
    deps.listChats.mockResolvedValue([
      {
        id: 7,
        appId: 1,
        title: null,
        createdAt: now,
        chatMode: "agent",
      },
    ] as any);
    deps.findChatMetadataById.mockResolvedValue({
      id: 8,
      appId: 1,
      title: "Metadata",
      createdAt: now,
      chatMode: "ask",
    });
    const service = createLocalWebCoreService(deps);

    await expect(service.getChats(1)).resolves.toEqual([
      {
        id: 7,
        appId: 1,
        title: null,
        createdAt: now,
        chatMode: "build",
      },
    ]);
    await expect(service.getChatMetadata(8)).resolves.toMatchObject({
      id: 8,
      title: "Metadata",
      chatMode: "ask",
    });
  });

  it("reads settings, env vars, and browser-safe defaults", async () => {
    deps.getLanguageModelProviders.mockResolvedValue([
      {
        id: "openai",
        name: "OpenAI",
        type: "cloud",
        envVarName: "OPENAI_API_KEY",
      },
      {
        id: "ollama",
        name: "Ollama",
        type: "local",
      },
    ] as any);
    deps.getEnvVar.mockReturnValue("configured");
    const service = createLocalWebCoreService(deps);

    expect(service.getSettings()).toMatchObject({
      selectedModel: { provider: "auto", name: "auto" },
    });
    expect(service.setSettings({ zoomLevel: "110" } as any)).toMatchObject({
      selectedModel: { provider: "auto", name: "auto" },
    });
    expect(deps.writeSettings).toHaveBeenCalledWith({ zoomLevel: "110" });
    await expect(service.getEnvVars()).resolves.toEqual({
      OPENAI_API_KEY: "configured",
    });
    expect(service.getInitialLoadTelemetryContext()).toEqual({
      isFirstSession: false,
    });
    await expect(service.getFreeAgentQuotaStatus()).resolves.toMatchObject({
      messagesUsed: 0,
      messagesLimit: 5,
      isQuotaExceeded: false,
    });
  });

  it("forwards Local Web theme generation operations through injected dependencies", async () => {
    const service = createLocalWebCoreService(deps);

    await expect(
      service.saveThemeImage({
        data: Buffer.from("image").toString("base64"),
        filename: "reference.png",
      }),
    ).resolves.toEqual({ path: "/tmp/reference.png" });
    await expect(
      service.generateThemePrompt({
        imagePaths: ["/tmp/reference.png"],
        keywords: "modern",
        generationMode: "inspired",
        model: "dyad/theme-generator/openai",
      }),
    ).resolves.toEqual({ prompt: "<theme>generated</theme>" });
    await expect(
      service.cleanupThemeImages({ paths: ["/tmp/reference.png"] }),
    ).resolves.toBeUndefined();
    await expect(
      service.generateThemeFromUrl({
        url: "https://example.com",
        keywords: "",
        generationMode: "inspired",
        model: "dyad/theme-generator/openai",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message:
        "Website URL theme generation is not available in Local Web mode yet.",
    });

    expect(deps.saveThemeImage).toHaveBeenCalledOnce();
    expect(deps.generateThemePrompt).toHaveBeenCalledOnce();
    expect(deps.cleanupThemeImages).toHaveBeenCalledOnce();
  });

  it("forwards app detail diagnostics and logs through injected dependencies", async () => {
    const service = createLocalWebCoreService(deps);
    const logEntry = {
      level: "info" as const,
      type: "server" as const,
      message: "Connecting to app...",
      appId: 1,
      timestamp: now.getTime(),
    };

    await expect(service.getCurrentBranch(1)).resolves.toEqual({
      branch: "main",
    });
    await expect(
      service.revertVersion({ appId: 1, previousVersionId: "abc123" }),
    ).resolves.toEqual({ successMessage: "Restored version" });
    await expect(
      service.checkoutVersion({ appId: 1, versionId: "abc123" }),
    ).resolves.toBeUndefined();
    await expect(service.checkProblems(1)).resolves.toEqual({ problems: [] });
    await expect(service.getCurrentCommitHash(1)).resolves.toEqual({
      commitHash: null,
    });
    await expect(
      service.saveAppScreenshot({
        appId: 1,
        dataUrl: "data:image/png;base64,AA==",
        commitHash: "0123456789012345678901234567890123456789",
      }),
    ).resolves.toBeUndefined();
    service.addLog(logEntry);
    service.clearLogs(1);

    expect(deps.getCurrentBranch).toHaveBeenCalledWith(1);
    expect(deps.revertVersion).toHaveBeenCalledWith({
      appId: 1,
      previousVersionId: "abc123",
    });
    expect(deps.checkoutVersion).toHaveBeenCalledWith({
      appId: 1,
      versionId: "abc123",
    });
    expect(deps.checkProblems).toHaveBeenCalledWith(1);
    expect(deps.getCurrentCommitHash).toHaveBeenCalledWith(1);
    expect(deps.saveAppScreenshot).toHaveBeenCalledWith({
      appId: 1,
      dataUrl: "data:image/png;base64,AA==",
      commitHash: "0123456789012345678901234567890123456789",
    });
    expect(deps.addLog).toHaveBeenCalledWith(logEntry);
    expect(deps.clearLogs).toHaveBeenCalledWith(1);
  });
});

function createDeps() {
  return {
    findAppById: vi.fn(),
    findChatWithMessagesById: vi.fn(),
    listApps: vi.fn(async () => []),
    listChats: vi.fn(async () => []),
    findChatMetadataById: vi.fn(),
    searchApps: vi.fn(async () => []),
    listPrompts: vi.fn(async () => []),
    listAppCollections: vi.fn(async () => []),
    listCustomThemes: vi.fn(async () => []),
    listMcpServers: vi.fn(async () => []),
    listMcpToolConsents: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => ({ branch: "main" })),
    revertVersion: vi.fn(async () => ({ successMessage: "Restored version" })),
    checkoutVersion: vi.fn(async () => undefined),
    checkProblems: vi.fn(async () => ({ problems: [] })),
    addLog: vi.fn(),
    clearLogs: vi.fn(),
    listAllMedia: vi.fn(async () => ({ apps: [] })),
    listAppScreenshots: vi.fn(async () => ({ screenshots: [] })),
    listAppThumbnails: vi.fn(async () => ({ thumbnails: [] })),
    getCurrentCommitHash: vi.fn(async () => ({ commitHash: null })),
    saveAppScreenshot: vi.fn(async () => undefined),
    resolveAppPath: vi.fn((appPath: string) => `/apps/${appPath}`),
    listAppFiles: vi.fn(() => ["src/App.tsx", "package.json"]),
    normalizePath: vi.fn((filePath: string) => filePath.replaceAll("\\", "/")),
    readSettings: vi.fn(() => ({
      selectedModel: {
        provider: "auto" as const,
        name: "auto",
      },
      providerSettings: {},
      selectedTemplateId: "react",
      enableAutoUpdate: true,
      releaseChannel: "stable" as const,
      supabase: {
        accessToken: { value: "supabase-token" },
      },
    })),
    writeSettings: vi.fn(),
    getEnvVar: vi.fn(),
    getSystemPlatform: vi.fn(() => "darwin"),
    getAppVersion: vi.fn(() => "1.3.0"),
    getCustomAppsFolder: vi.fn(() => ({
      path: "/apps",
      isPathAvailable: true,
      isPathDefault: true,
    })),
    getSystemDebugInfo: vi.fn(async () => ({
      nodeVersion: "v24.0.0",
      pnpmVersion: null,
      nodePath: process.execPath,
      telemetryId: "telemetry",
      telemetryConsent: "unset",
      telemetryUrl: "https://us.i.posthog.com",
      dyadVersion: "1.3.0",
      platform: "darwin",
      architecture: "arm64",
      logs: "",
      selectedLanguageModel: "auto:auto",
    })),
    getNodejsStatus: vi.fn(async () => ({
      nodeVersion: "v24.0.0",
      pnpmVersion: null,
      nodeDownloadUrl: "https://nodejs.org",
    })),
    installPnpm: vi.fn(async () => ({
      pnpmVersion: "11.1.2",
    })),
    getTemplates: vi.fn(async () => []),
    getThemes: vi.fn(async () => []),
    getThemeGenerationModelOptions: vi.fn(async () => []),
    saveThemeImage: vi.fn(async () => ({ path: "/tmp/reference.png" })),
    cleanupThemeImages: vi.fn(async () => undefined),
    generateThemePrompt: vi.fn(async () => ({
      prompt: "<theme>generated</theme>",
    })),
    getLanguageModelProviders: vi.fn(async () => []),
    getLanguageModels: vi.fn(async () => []),
    getLanguageModelsByProviders: vi.fn(async () => ({})),
    getFreeAgentQuotaStatus: vi.fn(async () => ({
      messagesUsed: 0,
      messagesLimit: 5,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    })),
    getUserBudget: vi.fn(async () => null),
    getAppTheme: vi.fn(async () => null),
    listMcpTools: vi.fn(async () => ({ tools: [], status: "error" as const })),
    isMcpOauthStorageEncrypted: vi.fn(async () => ({ available: false })),
    probeMcpCallbackPort: vi.fn(async () => ({ port: 53682 })),
    getSupabaseProjectName: vi.fn(async () => "Supabase Project"),
    getVercelTeamSlug: vi.fn(async () => "team-slug"),
    detectFrameworkType: vi.fn(() => "vite" as const),
    onRecoverableError: vi.fn(),
  };
}

function createAppRecord(
  overrides: Partial<ReturnType<typeof baseAppRecord>> = {},
) {
  return {
    ...baseAppRecord(),
    ...overrides,
  };
}

function baseAppRecord() {
  return {
    id: 1,
    name: "Test App",
    path: "test-app",
    createdAt: now,
    updatedAt: now,
    githubOrg: null,
    githubRepo: null,
    githubBranch: null,
    supabaseProjectId: "project-id",
    supabaseParentProjectId: "parent-project",
    supabaseOrganizationSlug: "org-slug",
    neonProjectId: null,
    neonDevelopmentBranchId: null,
    neonPreviewBranchId: null,
    neonActiveBranchId: null,
    neonProductionAuthCookieSecret: null,
    neonDevelopmentAuthCookieSecret: null,
    selectedDatabaseBranchType: null,
    vercelProjectId: null,
    vercelProjectName: null,
    vercelDeploymentUrl: null,
    vercelTeamId: "team-id",
    installCommand: null,
    startCommand: null,
    chatContext: null,
    isFavorite: false,
    themeId: null,
    needsAppBlueprint: false,
    collectionId: null,
  };
}

function createMessageRecord(overrides: {
  id: number;
  role: "user" | "assistant";
  content: string;
}) {
  return {
    id: overrides.id,
    chatId: 7,
    role: overrides.role,
    content: overrides.content,
    approvalState: null,
    sourceCommitHash: null,
    commitHash: null,
    requestId: null,
    maxTokensUsed: null,
    model: null,
    aiMessagesJson: null,
    usingFreeAgentModeQuota: null,
    isCompactionSummary: null,
    createdAt: now,
  };
}
