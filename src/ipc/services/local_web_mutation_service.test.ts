import { beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import {
  createLocalWebMutationService,
  type LocalWebMutationServiceDependencies,
} from "./local_web_mutation_service";

const now = new Date("2026-06-11T00:00:00.000Z");

describe("LocalWebMutationService", () => {
  let deps: LocalWebMutationServiceDependencies & ReturnType<typeof createDeps>;
  let service: ReturnType<typeof createLocalWebMutationService>;

  beforeEach(() => {
    deps = createDeps();
    service = createLocalWebMutationService(deps);
  });

  it("creates an app by writing DB rows, scaffold files, git, and initial chat", async () => {
    deps.pathExists.mockResolvedValue(false);

    await expect(
      service.createApp({ name: "new-app", initialChatMode: "ask" }),
    ).resolves.toMatchObject({
      app: { id: 1, name: "new-app", resolvedPath: "/apps/new-app" },
      chatId: 7,
    });

    expect(deps.insertApp).toHaveBeenCalledWith({
      name: "new-app",
      path: "new-app",
      needsAppBlueprint: true,
    });
    expect(deps.copyPath).toHaveBeenCalledWith(
      "/repo/scaffold",
      "/apps/new-app",
      {
        excludeNodeModules: true,
      },
    );
    expect(deps.gitInit).toHaveBeenCalledWith("/apps/new-app");
    expect(deps.insertChat).toHaveBeenCalledWith({
      appId: 1,
      chatMode: "ask",
      initialCommitHash: "commit-1",
    });
  });

  it("rejects create when the destination already exists", async () => {
    deps.pathExists.mockResolvedValue(true);

    await expect(service.createApp({ name: "new-app" })).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message: "App already exists at: /apps/new-app",
    });
    expect(deps.insertApp).not.toHaveBeenCalled();
  });

  it("renames an app and rejects name conflicts", async () => {
    deps.findAppByName.mockResolvedValueOnce(createAppRecord({ id: 2 }));

    await expect(
      service.renameApp({
        appId: 1,
        appName: "Existing",
        appPath: "existing",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message: "An app with the name 'Existing' already exists",
    });
  });

  it("guards file reads against path traversal", async () => {
    await expect(
      service.readAppFile({ appId: 1, filePath: "../secret.txt" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("Unsafe path"),
    });
  });

  it("edits an app file inside the app root and commits it", async () => {
    deps.pathExists.mockImplementation(async (targetPath: string) =>
      targetPath === "/apps/test-app/.git" ? true : false,
    );

    await expect(
      service.editAppFile({
        appId: 1,
        filePath: "src/App.tsx",
        content: "updated",
      }),
    ).resolves.toEqual({});

    expect(deps.writeTextFile).toHaveBeenCalledWith(
      "/apps/test-app/src/App.tsx",
      "updated",
    );
    expect(deps.gitAdd).toHaveBeenCalledWith("/apps/test-app", "src/App.tsx");
    expect(deps.gitCommit).toHaveBeenCalledWith(
      "/apps/test-app",
      "Updated src/App.tsx",
    );
  });

  it("reads and writes app env vars through .env.local", async () => {
    deps.pathExists.mockResolvedValue(true);
    deps.readTextFile.mockResolvedValue('VITE_FLAG=true\nSECRET="two words"');

    await expect(service.getAppEnvVars(1)).resolves.toEqual([
      { key: "VITE_FLAG", value: "true" },
      { key: "SECRET", value: "two words" },
    ]);

    await service.setAppEnvVars(1, [{ key: "VITE_FLAG", value: "false" }]);
    expect(deps.writeTextFile).toHaveBeenCalledWith(
      "/apps/test-app/.env.local",
      "VITE_FLAG=false\n",
    );
  });

  it("persists context paths", async () => {
    await service.setContextPaths({
      appId: 1,
      chatContext: {
        contextPaths: [{ globPath: "src/**" }],
        smartContextAutoIncludes: [],
      },
    });

    expect(deps.updateApp).toHaveBeenCalledWith(1, {
      chatContext: {
        contextPaths: [{ globPath: "src/**" }],
        smartContextAutoIncludes: [],
      },
    });
  });

  it("validates custom theme duplicates as conflicts", async () => {
    deps.findCustomThemeByName.mockResolvedValueOnce(createTheme());

    await expect(
      service.createCustomTheme({ name: "Theme", prompt: "<theme></theme>" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message:
        'A theme named "Theme" already exists. Please choose a different name.',
    });
  });

  it("renames media with conflict and filename validation", async () => {
    deps.pathExists.mockImplementation(async (targetPath: string) =>
      targetPath.endsWith("/.dyad/media/new.png"),
    );

    await expect(
      service.renameMediaFile({
        appId: 1,
        fileName: "old.png",
        newBaseName: "new",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message: "A media file with that name already exists",
    });

    await expect(
      service.renameMediaFile({
        appId: 1,
        fileName: "../old.png",
        newBaseName: "new",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Invalid file name",
    });
  });

  it("returns browser-safe canceled folder picker results", () => {
    expect(service.selectAppFolder()).toEqual({ path: null, name: null });
    expect(service.selectAppLocation()).toEqual({
      path: null,
      canceled: true,
    });
  });
});

function createDeps(): LocalWebMutationServiceDependencies & {
  [K in keyof LocalWebMutationServiceDependencies]: any;
} {
  return {
    findAppById: vi.fn(async () => createAppRecord()),
    findAppByName: vi.fn(async () => undefined),
    listApps: vi.fn(async () => [createAppRecord()]),
    insertApp: vi.fn(async (values) => createAppRecord(values)),
    updateApp: vi.fn(async (appId, values) =>
      createAppRecord({ id: appId, ...values }),
    ),
    deleteApp: vi.fn(async () => undefined),
    insertChat: vi.fn(async (values) => createChatRecord(values)),
    updateChat: vi.fn(async () => undefined),
    deleteChat: vi.fn(async () => undefined),
    deleteMessages: vi.fn(async () => undefined),
    searchChats: vi.fn(async () => []),
    listPrompts: vi.fn(async () => []),
    insertPrompt: vi.fn(async (values) => ({
      id: 1,
      ...values,
      createdAt: now,
      updatedAt: now,
    })),
    updatePrompt: vi.fn(async () => undefined),
    deletePrompt: vi.fn(async () => undefined),
    listAppCollections: vi.fn(async () => []),
    createAppCollection: vi.fn(async ({ name, appIds }) => ({
      id: 1,
      name,
      appIds: appIds ?? [],
      createdAt: now,
      updatedAt: now,
    })),
    updateAppCollection: vi.fn(async () => undefined),
    deleteAppCollection: vi.fn(async () => undefined),
    assignApps: vi.fn(async () => undefined),
    listCustomThemes: vi.fn(async () => []),
    findCustomThemeById: vi.fn(async () => createTheme()),
    findCustomThemeByName: vi.fn(async () => undefined),
    insertCustomTheme: vi.fn(async (values) => createTheme(values)),
    updateCustomTheme: vi.fn(async (_id, values) => createTheme(values)),
    deleteCustomTheme: vi.fn(async () => undefined),
    resolveAppPath: vi.fn((appPath: string) =>
      appPath.startsWith("/") ? appPath : `/apps/${appPath}`,
    ),
    getScaffoldPath: vi.fn(() => "/repo/scaffold"),
    isDirectoryAccessible: vi.fn(() => true),
    readSettings: vi.fn(() => ({
      selectedModel: { provider: "auto" as const, name: "auto" },
      providerSettings: {},
      selectedTemplateId: "react",
      enableAutoUpdate: true,
      releaseChannel: "stable" as const,
      enableAppBlueprint: true,
      selectedChatMode: "build" as const,
    })),
    copyPath: vi.fn(async () => undefined),
    ensureDirectory: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    renamePath: vi.fn(async () => undefined),
    pathExists: vi.fn(async (_targetPath: string) => false),
    readTextFile: vi.fn(async () => ""),
    writeTextFile: vi.fn(async () => undefined),
    listDirectory: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 100 })),
    unlink: vi.fn(async () => undefined),
    gitInit: vi.fn(async () => undefined),
    gitAdd: vi.fn(async () => undefined),
    gitCommit: vi.fn(async () => "commit-1"),
    getCurrentCommitHash: vi.fn(async () => "commit-1"),
    searchFiles: vi.fn(async () => []),
  };
}

function createAppRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "test-app",
    path: "test-app",
    createdAt: now,
    updatedAt: now,
    githubOrg: null,
    githubRepo: null,
    githubBranch: null,
    supabaseProjectId: null,
    supabaseParentProjectId: null,
    supabaseOrganizationSlug: null,
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
    vercelTeamId: null,
    installCommand: null,
    startCommand: null,
    chatContext: null,
    isFavorite: false,
    themeId: null,
    needsAppBlueprint: true,
    collectionId: null,
    ...overrides,
  };
}

function createChatRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    appId: 1,
    title: null,
    initialCommitHash: null,
    createdAt: now,
    compactedAt: null,
    compactionBackupPath: null,
    pendingCompaction: null,
    chatMode: "build" as const,
    ...overrides,
  };
}

function createTheme(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Theme",
    description: null,
    prompt: "<theme></theme>",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
