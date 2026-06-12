import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { createLocalWebHostCapabilities } from "./local_web_host_capabilities";
import {
  createLocalWebPathResolver,
  getDefaultLocalWebUserDataPath,
} from "./local_web_paths";
import { createLocalWebSettingsStore } from "./local_web_settings";

const runtimeMocks = vi.hoisted(() => ({
  initializeDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  configureDatabaseUserDataPath: vi.fn(),
  registerLocalWebRpcHandlers: vi.fn(),
  composeLocalWebRpcService: vi.fn((...services: unknown[]) =>
    Object.assign({}, ...services),
  ),
  createDefaultWorkflowService: vi.fn(async () => ({
    startChatStream: vi.fn(),
  })),
  createDefaultLocalWebCoreService: vi.fn(() => ({
    getApp: vi.fn(),
    getChat: vi.fn(),
  })),
}));

vi.mock("@/db", () => ({
  initializeDatabase: runtimeMocks.initializeDatabase,
  closeDatabase: runtimeMocks.closeDatabase,
  configureDatabaseUserDataPath: runtimeMocks.configureDatabaseUserDataPath,
}));

vi.mock("./local_web_rpc_registry", () => ({
  registerLocalWebRpcHandlers: runtimeMocks.registerLocalWebRpcHandlers,
  composeLocalWebRpcService: runtimeMocks.composeLocalWebRpcService,
  createDefaultWorkflowService: runtimeMocks.createDefaultWorkflowService,
}));

vi.mock("@/ipc/services/default_local_web_core_service", () => ({
  createDefaultLocalWebCoreService:
    runtimeMocks.createDefaultLocalWebCoreService,
}));

vi.mock("electron", () => {
  throw new Error("local Web runtime startup path imported electron");
});

describe("local Web settings and runtime", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-local-web-runtime-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses explicit plaintext secret storage without Electron safeStorage", () => {
    const store = createLocalWebSettingsStore({ userDataPath: tempDir });

    store.writeSettings({
      providerSettings: {
        openai: {
          apiKey: {
            value: "  sk-local\n",
            encryptionType: "electron-safe-storage",
          },
        },
        anthropic: {
          apiKey: {
            value: "  sk-plain\n",
          },
        },
      },
    });

    const settings = store.readSettings();
    expect(settings.providerSettings.openai.apiKey).toBeUndefined();
    expect(settings.providerSettings.anthropic.apiKey).toEqual({
      value: "sk-plain",
      encryptionType: "plaintext",
    });
    expect(store.secretStorageMode).toBe("plaintext");
  });

  it("resolves local Web paths from per-user data and custom settings", () => {
    const store = createLocalWebSettingsStore({ userDataPath: tempDir });
    const resolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore: store,
    });

    expect(resolver.getDatabasePath()).toBe(path.join(tempDir, "sqlite.db"));
    expect(resolver.getDyadAppPath("sample-app")).toBe(
      path.join(tempDir, "dyad-apps", "sample-app"),
    );

    const customAppsFolder = path.join(tempDir, "custom-apps");
    store.writeSettings({ customAppsFolder });
    expect(resolver.getDyadAppPath("sample-app")).toBe(
      path.join(customAppsFolder, "sample-app"),
    );
  });

  it("starts plain Node local Web runtime and closes server, database, and events", async () => {
    const { startLocalWebRuntime } = await import("./local_web_runtime");
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const hostCapabilities = createLocalWebHostCapabilities();

    const runtime = await startLocalWebRuntime({
      allowedOrigins: ["http://localhost:5173"],
      token: "local-token",
      userDataPath: tempDir,
      settingsStore,
      pathResolver,
      hostCapabilities,
    });

    expect(runtime.server.info.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(runtime.server.info.token).toBe("local-token");
    expect(runtime.settingsStore).toBe(settingsStore);
    expect(runtime.pathResolver).toBe(pathResolver);
    expect(runtime.hostCapabilities).toBe(hostCapabilities);
    expect(runtimeMocks.configureDatabaseUserDataPath).toHaveBeenCalledWith(
      tempDir,
    );
    expect(runtimeMocks.initializeDatabase).toHaveBeenCalledOnce();
    expect(runtimeMocks.createDefaultLocalWebCoreService).toHaveBeenCalledWith({
      settingsStore,
      pathResolver,
      userDataPath: tempDir,
      getMediaBaseUrl: expect.any(Function),
    });
    const coreServiceOptions = (
      runtimeMocks.createDefaultLocalWebCoreService.mock.calls as unknown as [
        [{ getMediaBaseUrl: () => string | undefined }],
      ]
    )[0][0];
    expect(coreServiceOptions?.getMediaBaseUrl()).toBe(
      runtime.server.info.baseUrl,
    );
    expect(runtimeMocks.createDefaultWorkflowService).toHaveBeenCalledOnce();
    expect(runtimeMocks.composeLocalWebRpcService).toHaveBeenCalledWith(
      expect.objectContaining({ getApp: expect.any(Function) }),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ startGithubFlow: expect.any(Function) }),
      expect.objectContaining({ startChatStream: expect.any(Function) }),
    );
    expect(runtimeMocks.registerLocalWebRpcHandlers).toHaveBeenCalledOnce();

    const { getUserDataPath } = await import("@/paths/paths");
    expect(getUserDataPath()).toBe(tempDir);

    await runtime.close();

    expect(runtimeMocks.closeDatabase).toHaveBeenCalledOnce();
    expect(runtime.events.subscriberCount()).toBe(0);
    expect(getUserDataPath()).toBe(path.resolve("./userData"));
  });

  it("does not import Electron on the local Web startup path", async () => {
    await expect(import("./local_web_runtime")).resolves.toBeDefined();
  });
});

describe("local Web host capabilities", () => {
  it("returns explicit unsupported results for browser-incompatible actions", async () => {
    const capabilities = createLocalWebHostCapabilities();

    await expect(capabilities.selectDirectory()).resolves.toMatchObject({
      capability: "select-directory",
      supported: false,
    });
    await expect(capabilities.controlWindow("close")).resolves.toMatchObject({
      capability: "window-control",
      supported: false,
    });
    await expect(capabilities.captureScreenshot()).resolves.toMatchObject({
      capability: "screenshot",
      supported: false,
    });
  });

  it("validates local Web external URL requests", async () => {
    const capabilities = createLocalWebHostCapabilities();

    await expect(
      capabilities.openExternalUrl("file:///private/etc/passwd"),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "External URL must be http(s)",
    });
  });
});

describe("getDefaultLocalWebUserDataPath", () => {
  it("uses a local Web specific per-user directory", () => {
    expect(getDefaultLocalWebUserDataPath()).toContain(
      path.join(".dyad", "local-web"),
    );
  });
});
