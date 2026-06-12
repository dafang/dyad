import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { createLocalWebRuntimeService } from "./local_web_runtime_service";
import { runningApps } from "@/ipc/utils/process_manager";
import { db } from "@/db";

const ptySpawnMock = vi.hoisted(() =>
  vi.fn(() => ({
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
);
const shellEnvSyncMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock("node-pty", () => ({
  spawn: ptySpawnMock,
}));

const executeAppMock = vi.hoisted(() => vi.fn());
const cleanUpPortMock = vi.hoisted(() => vi.fn());

vi.mock("shell-env", () => ({
  shellEnvSync: shellEnvSyncMock,
}));

vi.mock("@/ipc/services/app_runtime_service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/ipc/services/app_runtime_service")>();
  return {
    ...original,
    cleanUpPort: cleanUpPortMock,
    executeApp: executeAppMock,
  };
});

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(),
      },
    },
  },
}));

describe("LocalWebRuntimeService", () => {
  beforeEach(() => {
    runningApps.clear();
    vi.restoreAllMocks();
    ptySpawnMock.mockClear();
    shellEnvSyncMock.mockClear();
    cleanUpPortMock.mockResolvedValue(undefined);
    executeAppMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DYAD_TEST_LOCAL_WEB_ENV;
  });

  it("does not expose a local web preview URL until the proxy root is ready", async () => {
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: "http://localhost:42107/",
      originalUrl: "http://localhost:32107/",
    });
    const probe = vi.fn(async () => false);
    const service = createService({ previewReadyProbe: probe });

    await expect(
      service.getRunningAppPreview({ appId: 7 }),
    ).resolves.toBeNull();
    expect(probe).toHaveBeenCalledWith("http://localhost:42107/");
  });

  it("rewrites ready previews to the local web preview route", async () => {
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: "http://localhost:42107/",
      originalUrl: "http://localhost:32107/",
    });
    const service = createService({
      previewBaseUrl: "http://127.0.0.1:51975",
      previewReadyProbe: vi.fn(async () => true),
    });

    await expect(service.getRunningAppPreview({ appId: 7 })).resolves.toEqual({
      appId: 7,
      appUrl: "http://127.0.0.1:51975/api/preview/7/",
      originalUrl: "http://localhost:32107/",
      mode: "host",
    });
  });

  it("can rewrite ready previews to the configured public web base URL", async () => {
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: "http://localhost:42107/",
      originalUrl: "http://localhost:32107/",
    });
    const service = createService({
      previewBaseUrl: "https://dyad.example.test",
      previewReadyProbe: vi.fn(async () => true),
    });

    await expect(service.getRunningAppPreview({ appId: 7 })).resolves.toEqual({
      appId: 7,
      appUrl: "https://dyad.example.test/api/preview/7/",
      originalUrl: "http://localhost:32107/",
      mode: "host",
    });
  });

  it("exposes a local web preview URL even when the app route returns an error page", async () => {
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: "http://localhost:42107/",
      originalUrl: "http://localhost:32107/",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("error", { status: 500 }));
    const service = createService({
      previewBaseUrl: "http://127.0.0.1:51975",
    });

    await expect(service.getRunningAppPreview({ appId: 7 })).resolves.toEqual({
      appId: 7,
      appUrl: "http://127.0.0.1:51975/api/preview/7/",
      originalUrl: "http://localhost:32107/",
      mode: "host",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:42107/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps polling when the preview proxy cannot reach the app yet", async () => {
    runningApps.set(7, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: "http://localhost:42107/",
      originalUrl: "http://localhost:32107/",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 502 }),
    );
    const service = createService({
      previewBaseUrl: "http://127.0.0.1:51975",
    });

    await expect(
      service.getRunningAppPreview({ appId: 7 }),
    ).resolves.toBeNull();
  });

  it("does not start an app that still needs blueprint approval", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord({ needsAppBlueprint: true }) as any,
    );
    const service = createService();

    await expect(service.runApp({ appId: 7 })).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "Approve the app blueprint before starting the preview.",
    });
    expect(executeAppMock).not.toHaveBeenCalled();
  });

  it("does not spawn a local web preview when app files are not ready", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord() as any,
    );
    vi.spyOn(fs.promises, "access").mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    const service = createService();

    await expect(service.runApp({ appId: 7 })).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining(
        "App files are not ready at /apps/test-app",
      ),
    });
    expect(executeAppMock).not.toHaveBeenCalled();
  });

  it("starts a local web preview only after blueprint approval and files are ready", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord() as any,
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    const service = createService();

    await expect(service.runApp({ appId: 7 })).resolves.toBeUndefined();

    expect(cleanUpPortMock).toHaveBeenCalled();
    expect(executeAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 7,
        appPath: "/apps/test-app",
        isNeon: false,
      }),
    );
  });

  it("opens local web terminals without shell-env sync probing", async () => {
    process.env.DYAD_TEST_LOCAL_WEB_ENV = "from-process";
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord() as any,
    );
    vi.spyOn(fs, "statSync").mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);
    const service = createService();

    await expect(
      service.openTerminal({ appId: 7, cols: 100, rows: 30 }),
    ).resolves.toMatchObject({
      created: true,
      cwd: "/apps/test-app",
      appName: "Test App",
    });

    expect(shellEnvSyncMock).not.toHaveBeenCalled();
    expect(ptySpawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cols: 100,
        rows: 30,
        cwd: "/apps/test-app",
        env: expect.objectContaining({
          DYAD_TEST_LOCAL_WEB_ENV: "from-process",
          TERM: "xterm-256color",
        }),
      }),
    );
  });

  it("serializes concurrent local web preview starts for the same app", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord() as any,
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    let finishFirstExecute: () => void = () => {};
    let executeCount = 0;
    executeAppMock.mockImplementation(async ({ appId }) => {
      executeCount += 1;
      if (executeCount === 1) {
        await new Promise<void>((resolve) => {
          finishFirstExecute = resolve;
        });
      }
      runningApps.set(appId, {
        process: null,
        processId: executeCount,
        mode: "host",
        lastViewedAt: Date.now(),
      });
    });
    const service = createService();

    const firstRun = service.runApp({ appId: 7 });
    const secondRun = service.runApp({ appId: 7 });
    await flushPromises();

    expect(executeAppMock).toHaveBeenCalledTimes(1);

    finishFirstExecute();
    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(cleanUpPortMock).toHaveBeenCalledTimes(1);
    expect(executeAppMock).toHaveBeenCalledTimes(1);
  });

  it("serializes local web restart and run for the same app", async () => {
    runningApps.set(7, {
      process: null,
      processId: 99,
      mode: "host",
      lastViewedAt: Date.now(),
    });
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      createAppRecord() as any,
    );
    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);
    let finishFirstExecute: () => void = () => {};
    let executeCount = 0;
    executeAppMock.mockImplementation(async ({ appId }) => {
      executeCount += 1;
      if (executeCount === 1) {
        await new Promise<void>((resolve) => {
          finishFirstExecute = resolve;
        });
      }
      runningApps.set(appId, {
        process: null,
        processId: executeCount,
        mode: "host",
        lastViewedAt: Date.now(),
      });
    });
    const service = createService();

    const restart = service.restartApp({ appId: 7 });
    const run = service.runApp({ appId: 7 });
    await flushPromises();

    expect(executeAppMock).toHaveBeenCalledTimes(1);

    finishFirstExecute();
    await expect(Promise.all([restart, run])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(cleanUpPortMock).toHaveBeenCalledTimes(1);
    expect(executeAppMock).toHaveBeenCalledTimes(1);
  });
});

function createAppRecord(
  overrides: {
    id?: number;
    name?: string;
    path?: string;
    needsAppBlueprint?: boolean;
    neonProjectId?: string | null;
    installCommand?: string | null;
    startCommand?: string | null;
  } = {},
) {
  return {
    id: overrides.id ?? 7,
    name: overrides.name ?? "Test App",
    path: overrides.path ?? "test-app",
    needsAppBlueprint: overrides.needsAppBlueprint ?? false,
    neonProjectId: overrides.neonProjectId ?? null,
    installCommand: overrides.installCommand ?? null,
    startCommand: overrides.startCommand ?? null,
  };
}

function createService(
  overrides: Partial<Parameters<typeof createLocalWebRuntimeService>[0]> = {},
) {
  return createLocalWebRuntimeService({
    events: { publish: vi.fn() },
    settingsStore: {
      readSettings: vi.fn(() => ({})),
    } as any,
    pathResolver: {
      getDyadAppPath: vi.fn((appPath: string) => `/apps/${appPath}`),
    } as any,
    ...overrides,
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
