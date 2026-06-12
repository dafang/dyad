import fs from "node:fs";
import path from "node:path";
import { spawn as defaultSpawnPty } from "node-pty";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  cleanUpPort,
  executeApp,
  ensureProxyForRunningApp,
  getRunningAppPreview as getRunningAppPreviewState,
} from "@/ipc/services/app_runtime_service";
import {
  PtySessionManager,
  type TerminalPtySpawner,
  type TerminalSubscriberTarget,
} from "@/ipc/utils/pty_session_manager";
import {
  runningApps,
  setCurrentlySelectedAppId,
  stopAppByInfo,
} from "@/ipc/utils/process_manager";
import { withLock } from "@/ipc/utils/lock_utils";
import {
  AppIdParamsSchema,
  RestartAppParamsSchema,
  type RunningAppPreview,
} from "@/ipc/types/app";
import { toLocalWebRunningAppPreview } from "@/server/local_web_preview_proxy";
import type {
  TerminalOpenParams,
  TerminalOpenResult,
} from "@/ipc/types/terminal";
import type { LocalEventStream } from "@/server/local_event_stream";
import type { LocalWebPathResolver } from "@/server/local_web_paths";
import type { LocalWebSettingsStore } from "@/server/local_web_settings";
import { getAppPort } from "../../../shared/ports";
import type { z } from "zod";

export interface LocalWebRuntimeServiceOptions {
  events: Pick<LocalEventStream, "publish">;
  settingsStore: LocalWebSettingsStore;
  pathResolver: LocalWebPathResolver;
  previewBaseUrl?: string;
  previewReadyProbe?: (url: string) => Promise<boolean>;
}

type AppIdParams = z.infer<typeof AppIdParamsSchema>;
type RestartAppParams = z.infer<typeof RestartAppParamsSchema>;
const DEFAULT_PREVIEW_READY_PROBE_TIMEOUT_MS = 1_500;

export interface LocalWebRuntimeService {
  setPreviewBaseUrl(baseUrl: string): void;
  runApp(params: AppIdParams): Promise<void>;
  stopApp(params: AppIdParams): Promise<void>;
  restartApp(params: RestartAppParams): Promise<void>;
  getRunningAppPreview(params: AppIdParams): Promise<RunningAppPreview | null>;
  respondToAppInput(params: { appId: number; response: string }): Promise<void>;
  selectAppForPreview(params: { appId: number | null }): Promise<void>;
  openTerminal(params: TerminalOpenParams): Promise<TerminalOpenResult>;
  closeTerminal(params: { sessionId: string }): Promise<{ ok: true }>;
  killTerminal(params: { sessionId: string }): Promise<{ ok: true }>;
  writeTerminal(params: {
    sessionId: string;
    data: string;
  }): Promise<{ ok: true }>;
  resizeTerminal(params: {
    sessionId: string;
    cols: number;
    rows: number;
  }): Promise<{ ok: true }>;
  serializeTerminal(params: {
    sessionId: string;
  }): Promise<{ scrollback: string; scrollbackEndOffset: number }>;
}

export function createLocalWebRuntimeService(
  options: LocalWebRuntimeServiceOptions,
): LocalWebRuntimeService {
  let previewBaseUrl = options.previewBaseUrl;
  const previewReadyProbe =
    options.previewReadyProbe ?? defaultPreviewReadyProbe;
  const eventSink = {
    send(channel: string, payload: unknown) {
      options.events.publish(channel, payload);
    },
  };
  const readSettingsForRuntime = () => options.settingsStore.readSettings();
  const resolveApp = async (appId: number) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });
    if (!app) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }
    return {
      app,
      appPath: options.pathResolver.getDyadAppPath(app.path),
    };
  };
  const resolveRunnableApp = async (appId: number) => {
    const resolved = await resolveApp(appId);
    if (resolved.app.needsAppBlueprint) {
      throw new DyadError(
        "Approve the app blueprint before starting the preview.",
        DyadErrorKind.Precondition,
      );
    }
    try {
      await fs.promises.access(
        path.join(resolved.appPath, "package.json"),
        fs.constants.R_OK,
      );
    } catch {
      throw new DyadError(
        `App files are not ready at ${resolved.appPath}. Regenerate the app template or approve the app blueprint before starting the preview.`,
        DyadErrorKind.Precondition,
      );
    }
    return resolved;
  };
  const terminalSubscriber = (): TerminalSubscriberTarget => ({
    type: "local-web",
    subscriberId: "local-web",
    send(channel, payload) {
      options.events.publish(channel, payload);
    },
  });
  const terminalManager = new PtySessionManager({
    resolveApp: async (appId) => {
      const { app, appPath } = await resolveApp(appId);
      return {
        id: app.id,
        name: app.name,
        cwd: appPath,
      };
    },
    pathExists: (targetPath) => {
      try {
        return fs.statSync(targetPath).isDirectory();
      } catch {
        return false;
      }
    },
    ptySpawner: defaultSpawnPty as TerminalPtySpawner,
    getShellEnv: () => ({ ...process.env }),
    send: () => undefined,
    now: () => Date.now(),
  });

  return {
    setPreviewBaseUrl(baseUrl) {
      previewBaseUrl = baseUrl;
    },

    async runApp({ appId }) {
      return withLock(appId, async () => {
        if (runningApps.has(appId)) {
          const appInfo = runningApps.get(appId);
          appInfo!.eventSink = eventSink;
          if (appInfo?.proxyUrl && appInfo.originalUrl) {
            await ensureProxyForRunningApp({
              appId,
              eventSink,
              originalUrl: appInfo.originalUrl,
              mode: appInfo.mode,
            });
          }
          return;
        }

        const { app, appPath } = await resolveRunnableApp(appId);

        await cleanUpPort(getAppPort(appId), readSettingsForRuntime);
        await executeApp({
          appPath,
          appId,
          eventSink,
          isNeon: Boolean(app.neonProjectId),
          installCommand: app.installCommand,
          startCommand: app.startCommand,
          readSettingsForRuntime,
        });
      });
    },

    async stopApp({ appId }) {
      return withLock(appId, async () => {
        const appInfo = runningApps.get(appId);
        if (!appInfo) {
          return;
        }
        await stopAppByInfo(appId, appInfo);
      });
    },

    async restartApp({ appId, removeNodeModules }) {
      return withLock(appId, async () => {
        const { app, appPath } = await resolveRunnableApp(appId);
        const appInfo = runningApps.get(appId);
        if (appInfo) {
          await stopAppByInfo(appId, appInfo);
        }

        if (removeNodeModules) {
          await fs.promises.rm(path.join(appPath, "node_modules"), {
            recursive: true,
            force: true,
          });
        }

        await cleanUpPort(getAppPort(appId), readSettingsForRuntime);
        await executeApp({
          appPath,
          appId,
          eventSink,
          isNeon: Boolean(app.neonProjectId),
          installCommand: app.installCommand,
          startCommand: app.startCommand,
          readSettingsForRuntime,
        });
      });
    },

    async getRunningAppPreview({ appId }) {
      const preview = getRunningAppPreviewState(appId);
      if (!preview) {
        return null;
      }
      const ready = await previewReadyProbe(preview.appUrl);
      if (!ready) {
        return null;
      }
      return previewBaseUrl
        ? toLocalWebRunningAppPreview(preview, previewBaseUrl)
        : preview;
    },

    async respondToAppInput({ appId, response }) {
      if (response !== "y" && response !== "n") {
        throw new DyadError(
          `Invalid response: ${response}`,
          DyadErrorKind.Validation,
        );
      }
      const appInfo = runningApps.get(appId);
      if (!appInfo) {
        throw new DyadError(
          `App ${appId} is not running`,
          DyadErrorKind.External,
        );
      }
      if (!appInfo.process?.stdin) {
        throw new DyadError(
          `App ${appId} is running in ${appInfo.mode} mode and does not accept stdin responses.`,
          DyadErrorKind.Precondition,
        );
      }
      appInfo.process.stdin.write(`${response}\n`);
    },

    async selectAppForPreview({ appId }) {
      setCurrentlySelectedAppId(appId);
    },

    async openTerminal(params) {
      return terminalManager.openSession({
        appId: params.appId,
        cols: params.cols,
        rows: params.rows,
        subscriber: terminalSubscriber(),
      });
    },

    async closeTerminal({ sessionId }) {
      terminalManager.closeSession(sessionId, terminalSubscriber());
      return { ok: true as const };
    },

    async killTerminal({ sessionId }) {
      terminalManager.killSession(sessionId, terminalSubscriber());
      return { ok: true as const };
    },

    async writeTerminal({ sessionId, data }) {
      terminalManager.write(sessionId, data, terminalSubscriber());
      return { ok: true as const };
    },

    async resizeTerminal({ sessionId, cols, rows }) {
      terminalManager.resize(sessionId, cols, rows, terminalSubscriber());
      return { ok: true as const };
    },

    async serializeTerminal({ sessionId }) {
      return terminalManager.serialize(sessionId, terminalSubscriber());
    },
  };
}

async function defaultPreviewReadyProbe(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DEFAULT_PREVIEW_READY_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    // App-level HTTP errors (404/500/etc.) still mean the dev server is up and
    // the iframe should show the framework's error page. Keep polling only for
    // proxy-generated upstream failures while the server is not reachable yet.
    return response.status !== 502;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
