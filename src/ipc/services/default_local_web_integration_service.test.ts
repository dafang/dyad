import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  closeDatabase,
  configureDatabaseUserDataPath,
  initializeDatabase,
  db,
} from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "@/ipc/shared/language_model_helpers";
import { createDefaultLocalWebIntegrationService } from "./default_local_web_integration_service";
import { createLocalWebPathResolver } from "@/server/local_web_paths";
import { createLocalWebSettingsStore } from "@/server/local_web_settings";
import { SupabaseService } from "./supabase_service";
import { NeonService } from "./neon_service";

describe("default Local Web integration service", () => {
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tempDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-local-web-integration-"),
    );
    configureDatabaseUserDataPath(tempDir);
    initializeDatabase();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("publishes GitHub device-flow events and stores the access token", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
    });
    const events: Array<{ channel: string; payload: unknown }> = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device-1",
          interval: 0,
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: "gho_test_token" }));
    globalThis.fetch = fetchMock;

    service.startGithubFlow?.(
      {
        sender: {
          isDestroyed: () => false,
          send: (channel, payload) => {
            events.push({ channel, payload });
          },
        },
      },
      { appId: null },
    );
    await waitFor(() =>
      events.some((event) => event.channel === "github:flow-success"),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        {
          channel: "github:flow-update",
          payload: {
            message: "Requesting device code from GitHub...",
          },
        },
        {
          channel: "github:flow-update",
          payload: {
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device",
            message: "Please authorize in your browser.",
          },
        },
        {
          channel: "github:flow-success",
          payload: { message: "Successfully connected!" },
        },
      ]),
    );
    expect(settingsStore.readSettings().githubAccessToken?.value).toBe(
      "gho_test_token",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies missing GitHub token as auth for Local Web", async () => {
    const service = createDefaultLocalWebIntegrationService({
      settingsStore: createLocalWebSettingsStore({
        userDataPath: tempDir,
      }),
    });

    await expect(service.listGithubRepos?.()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    } satisfies Partial<DyadError>);
  });

  it("resolves app git operations through the Local Web path resolver", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("git-app");
    fs.mkdirSync(appPath, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: appPath });
    fs.writeFileSync(path.join(appPath, "README.md"), "hello\n");
    execFileSync("git", ["add", "README.md"], { cwd: appPath });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Dyad Test",
        "-c",
        "user.email=git@dyad.sh",
        "commit",
        "-m",
        "init",
      ],
      { cwd: appPath },
    );
    execFileSync("git", ["checkout", "-b", "feature/local-web"], {
      cwd: appPath,
    });
    execFileSync("git", ["checkout", "main"], { cwd: appPath });
    const appId = Number(
      db.insert(apps).values({ name: "Git App", path: "git-app" }).run()
        .lastInsertRowid,
    );
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    });

    await expect(
      service.listLocalGitBranches?.({ appId }),
    ).resolves.toMatchObject({
      branches: expect.arrayContaining(["main", "feature/local-web"]),
      current: "main",
    });
  });

  it("saves Supabase organization tokens in the Local Web settings shape", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
    });

    await service.saveSupabaseOrganizationToken?.({
      organizationSlug: "org-1",
      accessToken: "sbp_local_token",
    });

    const savedOrg =
      settingsStore.readSettings().supabase?.organizations?.["org-1"];
    expect(savedOrg?.accessToken.value).toBe("sbp_local_token");
    expect(savedOrg?.refreshToken.value).toBe("sbp_local_token");
    expect(savedOrg?.expiresIn).toBeGreaterThan(60 * 60 * 24);
  });

  it("classifies missing Supabase token as auth for Local Web", async () => {
    const service = createDefaultLocalWebIntegrationService({
      settingsStore: createLocalWebSettingsStore({
        userDataPath: tempDir,
      }),
    });

    await expect(service.listSupabaseProjects?.()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    } satisfies Partial<DyadError>);
  });

  it("lists Supabase projects through stored organization credentials", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const supabaseService = new SupabaseService({
      settings: settingsStore,
      clientFactory: async () =>
        ({
          getProjects: async () => [
            {
              id: "project-1",
              name: "Project One",
              region: "us-east-1",
              organization_id: "org-1",
              organization_slug: "org-1",
            },
          ],
        }) as any,
    });
    supabaseService.saveOrganizationToken({
      organizationSlug: "org-1",
      accessToken: "sbp_local_token",
    });

    await expect(supabaseService.listProjects()).resolves.toEqual([
      {
        id: "project-1",
        name: "Project One",
        region: "us-east-1",
        organizationSlug: "org-1",
      },
    ]);
  });

  it("sets and unsets Supabase app project metadata", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
    });
    const appId = Number(
      db
        .insert(apps)
        .values({ name: "Supabase App", path: "supabase-app" })
        .run().lastInsertRowid,
    );

    await service.setSupabaseAppProject?.({
      appId,
      projectId: "project-1",
      parentProjectId: "parent-1",
      organizationSlug: "org-1",
    });
    await expect(
      db.query.apps.findFirst({ where: eqAppId(appId) }),
    ).resolves.toMatchObject({
      supabaseProjectId: "project-1",
      supabaseParentProjectId: "parent-1",
      supabaseOrganizationSlug: "org-1",
    });

    await service.unsetSupabaseAppProject?.({ app: appId });
    await expect(
      db.query.apps.findFirst({ where: eqAppId(appId) }),
    ).resolves.toMatchObject({
      supabaseProjectId: null,
      supabaseParentProjectId: null,
      supabaseOrganizationSlug: null,
    });
  });

  it("saves Neon API keys in the Local Web settings shape", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
    });

    await service.saveNeonApiKey?.({ apiKey: "napi_local_key" });

    const savedNeon = settingsStore.readSettings().neon;
    expect(savedNeon?.accessToken?.value).toBe("napi_local_key");
    expect(savedNeon?.refreshToken?.value).toBe("napi_local_key");
    expect(savedNeon?.expiresIn).toBeGreaterThan(60 * 60 * 24);
  });

  it("classifies missing Neon API key as auth for Local Web", async () => {
    const service = createDefaultLocalWebIntegrationService({
      settingsStore: createLocalWebSettingsStore({
        userDataPath: tempDir,
      }),
    });

    await expect(service.listNeonProjects?.()).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
    } satisfies Partial<DyadError>);
  });

  it("lists Neon projects through stored API key credentials", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const neonService = new NeonService({
      settings: settingsStore,
      getOrganizationId: async () => "org-1",
      getClient: async () =>
        ({
          listProjects: async () => ({
            data: {
              projects: [
                {
                  id: "project-1",
                  name: "Project One",
                  region_id: "aws-us-east-1",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          }),
        }) as any,
    });
    neonService.saveApiKey({ apiKey: "napi_local_key" });

    await expect(neonService.listProjects()).resolves.toEqual({
      projects: [
        {
          id: "project-1",
          name: "Project One",
          regionId: "aws-us-east-1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("links, switches, previews env vars, and unlinks Neon projects", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("neon-app");
    await fs.promises.mkdir(appPath, { recursive: true });
    await fs.promises.writeFile(path.join(appPath, "next.config.js"), "");
    const appId = Number(
      db.insert(apps).values({ name: "Neon App", path: "neon-app" }).run()
        .lastInsertRowid,
    );
    const neonService = new NeonService({
      settings: settingsStore,
      getClient: async () =>
        ({
          listProjectBranches: async () => ({
            data: {
              branches: [
                {
                  id: "branch-main",
                  name: "main",
                  project_id: "project-1",
                  default: true,
                  updated_at: "2026-01-01T00:00:00.000Z",
                },
                {
                  id: "branch-dev",
                  name: "development",
                  project_id: "project-1",
                  default: false,
                  parent_id: "branch-main",
                  updated_at: "2026-01-02T00:00:00.000Z",
                },
                {
                  id: "branch-preview",
                  name: "preview",
                  project_id: "project-1",
                  default: false,
                  parent_id: "branch-dev",
                  updated_at: "2026-01-03T00:00:00.000Z",
                },
              ],
            },
          }),
          getProject: async () => ({
            data: {
              project: {
                id: "project-1",
                name: "Project One",
                org_id: "org-1",
              },
            },
          }),
          getProjectBranch: async (_projectId: string, branchId: string) => ({
            data: {
              branch: {
                id: branchId,
                project_id: "project-1",
              },
            },
          }),
        }) as any,
      ensureNitroIfVite: async () => ({
        warningMessages: [],
        rollback: async () => undefined,
      }),
      autoInjectNeonEnvVars: async ({ appPath, branchId }) => {
        await fs.promises.writeFile(
          path.join(pathResolver.getDyadAppPath(appPath), ".env.local"),
          `DATABASE_URL=postgresql://test:${branchId}@example.neon.tech/db\nPOSTGRES_URL=postgresql://test:${branchId}@example.neon.tech/db\n`,
        );
        return undefined;
      },
      resolveNeonBranchEnvVars: async ({ branchType }) => ({
        branchId: branchType === "production" ? "branch-main" : "branch-dev",
        databaseUrl: `postgresql://test:${branchType}@example.neon.tech/db`,
        isNextJs: true,
      }),
      getCachedEmailPasswordConfig: async () => ({
        enabled: true,
        email_verification_method: "otp",
        require_email_verification: false,
        auto_sign_in_after_verification: true,
        send_verification_email_on_sign_up: false,
        send_verification_email_on_sign_in: false,
        disable_sign_up: false,
      }),
    });
    neonService.saveApiKey({ apiKey: "napi_local_key" });

    await expect(
      neonService.setAppProject({ appId, projectId: "project-1" }),
    ).resolves.toEqual({ success: true });
    await expect(
      db.query.apps.findFirst({ where: eqAppId(appId) }),
    ).resolves.toMatchObject({
      neonProjectId: "project-1",
      neonDevelopmentBranchId: "branch-dev",
      neonPreviewBranchId: "branch-preview",
      neonActiveBranchId: "branch-dev",
    });

    await expect(neonService.getProject({ appId })).resolves.toMatchObject({
      projectId: "project-1",
      projectName: "Project One",
      branches: expect.arrayContaining([
        expect.objectContaining({
          branchId: "branch-main",
          type: "production",
        }),
        expect.objectContaining({
          branchId: "branch-dev",
          type: "development",
        }),
      ]),
    });
    await expect(
      neonService.setActiveBranch({ appId, branchId: "branch-main" }),
    ).resolves.toEqual({ success: true });
    await expect(
      neonService.setSelectedDatabaseBranchType({
        appId,
        branchType: "development",
      }),
    ).resolves.toEqual({ success: true });
    await expect(
      neonService.getBranchEnvVars({ appId, branchType: "development" }),
    ).resolves.toMatchObject({
      databaseUrl: "postgresql://test:development@example.neon.tech/db",
    });
    await expect(
      neonService.getEmailPasswordConfig({ appId }),
    ).resolves.toMatchObject({
      enabled: true,
      email_verification_method: "otp",
    });

    await expect(neonService.unsetAppProject({ appId })).resolves.toEqual({
      success: true,
    });
    await expect(
      db.query.apps.findFirst({ where: eqAppId(appId) }),
    ).resolves.toMatchObject({
      neonProjectId: null,
      neonDevelopmentBranchId: null,
      neonPreviewBranchId: null,
      neonActiveBranchId: null,
    });
  });

  it("persists custom OpenAI-compatible providers and models", async () => {
    const service = createDefaultLocalWebIntegrationService();

    expect(
      service.createCustomLanguageModelProvider?.({
        id: "ark-openai",
        name: "Ark OpenAI Compatible",
        apiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      }),
    ).toMatchObject({
      id: "custom::ark-openai",
      name: "Ark OpenAI Compatible",
      type: "custom",
      isCustom: true,
    });
    expect(
      service.createCustomLanguageModel?.({
        providerId: "custom::ark-openai",
        apiName: "MiniMax-M3",
        displayName: "MiniMax M3",
        contextWindow: 100000,
        maxOutputTokens: 8192,
      }),
    ).toBeUndefined();

    await expect(getLanguageModelProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "custom::ark-openai",
          apiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
        }),
      ]),
    );
    await expect(
      getLanguageModels({ providerId: "custom::ark-openai" }),
    ).resolves.toEqual([
      expect.objectContaining({
        apiName: "MiniMax-M3",
        displayName: "MiniMax M3",
        type: "custom",
      }),
    ]);

    expect(
      service.editCustomLanguageModelProvider?.({
        id: "ark-openai",
        name: "Ark Edited",
        apiBaseUrl: "https://ark.example.test/v1",
        envVarName: "ARK_API_KEY",
      }),
    ).toMatchObject({
      id: "custom::ark-openai",
      name: "Ark Edited",
      envVarName: "ARK_API_KEY",
    });
    expect(
      service.deleteCustomModel?.({
        providerId: "custom::ark-openai",
        modelApiName: "MiniMax-M3",
      }),
    ).toBeUndefined();
    await expect(
      getLanguageModels({ providerId: "custom::ark-openai" }),
    ).resolves.toEqual([]);
    expect(
      service.deleteCustomLanguageModelProvider?.({
        providerId: "custom::ark-openai",
      }),
    ).toBeUndefined();
    await expect(getLanguageModelProviders()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "custom::ark-openai" }),
      ]),
    );
  });

  it("applies visual editing changes to local app files", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("visual-app");
    await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <div className="p-[4px]">Old copy</div>;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const appId = Number(
      db.insert(apps).values({ name: "Visual App", path: "visual-app" }).run()
        .lastInsertRowid,
    );
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    });

    await service.applyVisualEditingChanges?.({
      appId,
      changes: [
        {
          componentId: "src/App.tsx:2",
          componentName: "div",
          relativePath: "src/App.tsx",
          lineNumber: 2,
          styles: {
            padding: { left: "12px", right: "12px" },
          },
          textContent: "Local Web copy",
        },
      ],
    });

    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toContain("Local Web copy");
    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toContain("px-[12px]");
  });

  it("analyzes components from local app files", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("analysis-app");
    await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <section className="hero">Static heading</section>;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const appId = Number(
      db
        .insert(apps)
        .values({ name: "Analysis App", path: "analysis-app" })
        .run().lastInsertRowid,
    );
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    });

    await expect(
      service.analyzeComponent?.({
        appId,
        componentId: "src/App.tsx:2",
      }),
    ).resolves.toMatchObject({
      isDynamic: false,
      hasStaticText: true,
      hasImage: false,
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

function eqAppId(appId: number) {
  return eq(apps.id, appId);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
