import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import fixPath from "fix-path";
import killPort from "kill-port";
import log from "electron-log";

import { getAppPort, getAppProxyPort } from "../../../shared/ports";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type RuntimeMode2,
  type UserSettings,
} from "@/lib/schemas";
import type { AppOutput } from "@/ipc/types/misc";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { addLog } from "@/lib/log_store";
import { safeSend, type WebContentsLike } from "@/ipc/utils/safe_sender";
import { startProxy } from "@/ipc/utils/start_proxy_server";
import {
  processCounter,
  removeAppIfCurrentProcess,
  type RunningAppInfo,
  type RunningAppEventSink,
  runningApps,
} from "@/ipc/utils/process_manager";
import type { RunningAppPreview } from "@/ipc/types/app";
import {
  ensurePnpmAllowBuildsConfigured,
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  type PackageManager,
  PNPM_INSTALL_POLICY_ARGS,
} from "@/ipc/utils/socket_firewall";

const logger = log.scope("app_runtime_service");

// Needed, otherwise Electron on macOS/Linux may not find node/pnpm.
fixPath();

type CloudSandboxProviderModule =
  typeof import("@/ipc/utils/cloud_sandbox_provider");
type CloudSandboxApiErrorLike = Error & {
  code?: string;
  status?: number;
};
type AppRuntimeEvent = {
  sender: WebContentsLike;
};
type AppRuntimeSettingsReader = () => UserSettings | Promise<UserSettings>;

async function defaultReadSettingsForRuntime(): Promise<UserSettings> {
  const { readSettings } = await import("@/main/settings");
  return readSettings();
}

function createElectronEventSink(event: AppRuntimeEvent): RunningAppEventSink {
  return {
    send(channel, payload) {
      safeSend(event.sender, channel, payload);
    },
  };
}

function resolveEventSink(input: {
  event?: AppRuntimeEvent;
  eventSink?: RunningAppEventSink;
}): RunningAppEventSink {
  if (input.eventSink) {
    return input.eventSink;
  }
  if (input.event) {
    return createElectronEventSink(input.event);
  }
  throw new DyadError(
    "App runtime event sink is required",
    DyadErrorKind.Internal,
  );
}

function sendRuntimeEvent(
  eventSink: RunningAppEventSink | null | undefined,
  channel: string,
  payload: unknown,
): void {
  eventSink?.send(channel, payload);
}

export function formatCloudSandboxError(error: unknown) {
  if (!isCloudSandboxApiErrorLike(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.code) {
    case "sandbox_pro_required":
      return "Dyad Pro is required to use cloud sandboxes.";
    case "sandbox_insufficient_credits":
      return "You need at least 1 credit available to start a cloud sandbox.";
    case "sandbox_billing_unavailable":
      return "Dyad couldn’t verify sandbox billing right now. Please try again.";
    case "sandbox_credits_exhausted":
      return "This cloud sandbox stopped because your credits ran out.";
    default:
      if (error.status === 404) {
        return "This cloud sandbox is no longer available.";
      }
      if (error.status === 401 || error.status === 403) {
        return "Dyad couldn’t authorize the cloud sandbox request. Please try again.";
      }
      if (error.status === 429) {
        return "Dyad is rate limiting cloud sandbox requests right now. Please try again.";
      }
      if (typeof error.status === "number" && error.status >= 500) {
        return "Dyad’s cloud sandbox service is temporarily unavailable. Please try again.";
      }
      return error.message;
  }
}

async function getCloudSandboxProvider(): Promise<CloudSandboxProviderModule> {
  return import("@/ipc/utils/cloud_sandbox_provider");
}

function isCloudSandboxApiErrorLike(
  error: unknown,
): error is CloudSandboxApiErrorLike {
  return error instanceof Error && error.name === "CloudSandboxApiError";
}

function getPnpmInstallCommand(): string {
  return `pnpm ${PNPM_INSTALL_POLICY_ARGS.join(" ")} install`;
}

function getNpmInstallCommand(): string {
  return "npm install --legacy-peer-deps";
}

interface AppRuntimeCommand {
  command: string;
  isCustom: boolean;
  packageManager: PackageManager | null;
}

async function getDefaultCommand({
  runtimeMode,
  appId,
  appPath,
  onPnpmMinimumReleaseAgeWarning,
}: {
  runtimeMode: RuntimeMode2;
  appId: number;
  appPath: string;
  onPnpmMinimumReleaseAgeWarning?: (message: string) => void | Promise<void>;
}): Promise<AppRuntimeCommand> {
  const port = getAppPort(appId);
  if (runtimeMode === "docker") {
    await ensurePnpmAllowBuildsConfigured({ appPath });
    return {
      command: `${getPnpmInstallCommand()} && pnpm run dev --port ${port}`,
      isCustom: false,
      packageManager: "pnpm",
    };
  }

  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();

  if (!pnpmSupport.minimumReleaseAgeSupported && pnpmSupport.warningMessage) {
    await onPnpmMinimumReleaseAgeWarning?.(pnpmSupport.warningMessage);
  }

  if (!pnpmSupport.available) {
    return {
      command: `(${getNpmInstallCommand()} && npm run dev -- --port ${port})`,
      isCustom: false,
      packageManager: "npm",
    };
  }

  await ensurePnpmAllowBuildsConfigured({ appPath });
  return {
    command: `${getPnpmInstallCommand()} && pnpm run dev --port ${port}`,
    isCustom: false,
    packageManager: "pnpm",
  };
}

async function getCommand({
  runtimeMode,
  appId,
  appPath,
  installCommand,
  startCommand,
  onPnpmMinimumReleaseAgeWarning,
}: {
  runtimeMode: RuntimeMode2;
  appId: number;
  appPath: string;
  installCommand?: string | null;
  startCommand?: string | null;
  onPnpmMinimumReleaseAgeWarning?: (message: string) => void | Promise<void>;
}): Promise<AppRuntimeCommand> {
  const hasCustomCommands = !!installCommand?.trim() && !!startCommand?.trim();
  if (hasCustomCommands) {
    return {
      command: `${installCommand!.trim()} && ${startCommand!.trim()}`,
      isCustom: true,
      packageManager: null,
    };
  }

  return getDefaultCommand({
    runtimeMode,
    appId,
    appPath,
    onPnpmMinimumReleaseAgeWarning,
  });
}

async function emitPnpmMinimumReleaseAgeWarning({
  appId,
  eventSink,
  message,
  readSettingsForRuntime,
}: {
  appId: number;
  eventSink: RunningAppEventSink;
  message: string;
  readSettingsForRuntime: AppRuntimeSettingsReader;
}): Promise<void> {
  const settings = await readSettingsForRuntime();
  if (!shouldShowPnpmMinimumReleaseAgeWarning(settings)) {
    return;
  }

  sendRuntimeEvent(eventSink, "app:output", {
    type: "package-manager-warning",
    message,
    appId,
  });
}

export async function executeApp({
  appPath,
  appId,
  event,
  eventSink,
  isNeon,
  installCommand,
  startCommand,
  readSettingsForRuntime = defaultReadSettingsForRuntime,
}: {
  appPath: string;
  appId: number;
  event?: AppRuntimeEvent;
  eventSink?: RunningAppEventSink;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  readSettingsForRuntime?: AppRuntimeSettingsReader;
}): Promise<void> {
  const resolvedEventSink = resolveEventSink({ event, eventSink });
  const settings = await readSettingsForRuntime();
  const runtimeMode = settings.runtimeMode2 ?? "host";

  if (runtimeMode === "docker") {
    await executeAppInDocker({
      appPath,
      appId,
      event,
      eventSink: resolvedEventSink,
      isNeon,
      installCommand,
      startCommand,
      readSettingsForRuntime,
    });
  } else if (runtimeMode === "cloud") {
    await executeAppInCloud({
      appPath,
      appId,
      event,
      eventSink: resolvedEventSink,
      installCommand,
      startCommand,
    });
  } else {
    await executeAppLocalNode({
      appPath,
      appId,
      event,
      eventSink: resolvedEventSink,
      isNeon,
      installCommand,
      startCommand,
      readSettingsForRuntime,
    });
  }
}

export function createAppRuntimeEventSinkFromElectronEvent(
  event: AppRuntimeEvent,
): RunningAppEventSink {
  return createElectronEventSink(event);
}

export function emitProxyServerStarted({
  appId,
  eventSink,
  proxyUrl,
  originalUrl,
  mode,
}: {
  appId: number;
  eventSink: RunningAppEventSink;
  proxyUrl: string;
  originalUrl: string;
  mode: RuntimeMode2;
}) {
  sendRuntimeEvent(eventSink, "app:output", {
    type: "stdout",
    message: `[dyad-proxy-server]started=[${proxyUrl}] original=[${originalUrl}] mode=[${mode}]`,
    appId,
  });
}

export function getRunningAppPreview(
  appId: number,
  appInfo: RunningAppInfo | undefined = runningApps.get(appId),
): RunningAppPreview | null {
  if (!appInfo?.proxyUrl || !appInfo.originalUrl) {
    return null;
  }

  return {
    appId,
    appUrl: appInfo.proxyUrl,
    originalUrl: appInfo.originalUrl,
    mode: appInfo.mode,
  };
}

export async function ensureProxyForRunningApp({
  appId,
  event,
  eventSink,
  originalUrl,
  mode,
}: {
  appId: number;
  event?: AppRuntimeEvent;
  eventSink?: RunningAppEventSink;
  originalUrl: string;
  mode: RuntimeMode2;
}): Promise<void> {
  const appInfo = runningApps.get(appId);
  if (!appInfo) {
    return;
  }
  const resolvedEventSink =
    eventSink ??
    appInfo.eventSink ??
    (event ? createElectronEventSink(event) : undefined);
  if (!resolvedEventSink) {
    return;
  }

  const proxyAuthToken =
    mode === "cloud" ? appInfo.cloudPreviewAuthToken : undefined;

  if (
    appInfo.proxyWorker &&
    appInfo.originalUrl === originalUrl &&
    appInfo.proxyAuthToken === proxyAuthToken &&
    appInfo.proxyUrl
  ) {
    emitProxyServerStarted({
      appId,
      eventSink: resolvedEventSink,
      proxyUrl: appInfo.proxyUrl,
      originalUrl,
      mode,
    });
    return;
  }

  if (appInfo.proxyWorker) {
    await appInfo.proxyWorker.terminate();
    appInfo.proxyWorker = undefined;
  }

  // Prefer the deterministic port so the iframe origin stays stable across
  // restarts — otherwise origin-scoped browser state (auth sessions,
  // localStorage) gets orphaned and users appear logged out. If that port is
  // already taken (by a foreign service, or another Dyad app in the rare 10k
  // overlap), the proxy worker scans the fallback band upward rather than
  // killing whatever holds the port.
  const proxyPort = getAppProxyPort(appId);

  const proxyWorker = await startProxy(originalUrl, {
    port: proxyPort,
    onStarted: (proxyUrl) => {
      const latestAppInfo = runningApps.get(appId);
      if (latestAppInfo) {
        latestAppInfo.proxyUrl = proxyUrl;
        latestAppInfo.originalUrl = originalUrl;
        latestAppInfo.proxyAuthToken = proxyAuthToken;
      }
      emitProxyServerStarted({
        appId,
        eventSink: resolvedEventSink,
        proxyUrl,
        originalUrl,
        mode,
      });
    },
    onError: (error) => {
      logger.error(`Failed to start proxy for app ${appId}:`, error);
      sendRuntimeEvent(resolvedEventSink, "app:output", {
        type: "stderr",
        message: `[dyad-proxy-server] ${error.message}`,
        appId,
      });
    },
    fixedHeaders:
      mode === "cloud" && proxyAuthToken
        ? {
            Authorization: `Bearer ${proxyAuthToken}`,
          }
        : undefined,
  });

  const latestAppInfo = runningApps.get(appId);
  if (latestAppInfo) {
    latestAppInfo.proxyWorker = proxyWorker;
    latestAppInfo.originalUrl = originalUrl;
    latestAppInfo.proxyAuthToken = proxyAuthToken;
  } else {
    await proxyWorker.terminate();
  }
}

async function executeAppLocalNode({
  appPath,
  appId,
  event,
  eventSink,
  isNeon,
  installCommand,
  startCommand,
  readSettingsForRuntime,
}: {
  appPath: string;
  appId: number;
  event?: AppRuntimeEvent;
  eventSink: RunningAppEventSink;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  readSettingsForRuntime: AppRuntimeSettingsReader;
}): Promise<void> {
  const command = await getCommand({
    runtimeMode: "host",
    appId,
    appPath,
    installCommand,
    startCommand,
    onPnpmMinimumReleaseAgeWarning: (message) =>
      emitPnpmMinimumReleaseAgeWarning({
        appId,
        eventSink,
        message,
        readSettingsForRuntime,
      }),
  });
  let env = { ...process.env };
  if (!command.isCustom && command.packageManager === "pnpm") {
    env = getPackageManagerCommandEnv();
  }

  const spawnedProcess = spawn(command.command, [], {
    cwd: appPath,
    env,
    shell: true,
    stdio: "pipe",
    detached: false,
  });

  if (!spawnedProcess.pid) {
    let errorOutput = "";
    let spawnErr: any | null = null;
    spawnedProcess.stderr?.on(
      "data",
      (data) => (errorOutput += data.toString()),
    );
    await new Promise<void>((resolve) => {
      spawnedProcess.once("error", (err) => {
        spawnErr = err;
        resolve();
      });
    });

    const details = [
      spawnErr?.message ? `message=${spawnErr.message}` : null,
      spawnErr?.code ? `code=${spawnErr.code}` : null,
      spawnErr?.errno ? `errno=${spawnErr.errno}` : null,
      spawnErr?.syscall ? `syscall=${spawnErr.syscall}` : null,
      spawnErr?.path ? `path=${spawnErr.path}` : null,
      spawnErr?.spawnargs
        ? `spawnargs=${JSON.stringify(spawnErr.spawnargs)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error(
      `Failed to spawn process for app ${appId}. Command="${command.command}", CWD="${appPath}", ${details}\nSTDERR:\n${
        errorOutput || "(empty)"
      }`,
    );

    throw new Error(
      `Failed to spawn process for app ${appId}.
Error output:
${errorOutput || "(empty)"}
Details: ${details || "n/a"}
`,
    );
  }

  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process: spawnedProcess,
    processId: currentProcessId,
    mode: "host",
    eventSink,
    rendererSender: event?.sender,
    lastViewedAt: Date.now(),
  });

  listenToProcess({
    process: spawnedProcess,
    appId,
    isNeon,
    event,
    eventSink,
  });
}

const APP_OUTPUT_FLUSH_INTERVAL_MS = 100;

const pendingOutputs = new Map<RunningAppEventSink, AppOutput[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueAppOutput(
  eventSink: RunningAppEventSink,
  output: AppOutput,
): void {
  let queue = pendingOutputs.get(eventSink);
  if (!queue) {
    queue = [];
    pendingOutputs.set(eventSink, queue);
  }
  queue.push(output);

  if (!flushTimer) {
    flushTimer = setTimeout(flushAllAppOutputs, APP_OUTPUT_FLUSH_INTERVAL_MS);
  }
}

function flushAllAppOutputs(): void {
  flushTimer = null;
  for (const [eventSink, outputs] of pendingOutputs) {
    if (outputs.length > 0) {
      sendRuntimeEvent(eventSink, "app:output-batch", outputs);
    }
  }
  pendingOutputs.clear();
}

let cloudSandboxSyncUpdateListenerRegistered = false;

export function registerCloudSandboxSyncUpdateListener(): void {
  if (cloudSandboxSyncUpdateListenerRegistered) {
    return;
  }

  void getCloudSandboxProvider().then((cloudSandboxProvider) => {
    cloudSandboxProvider.setCloudSandboxSyncUpdateListener(
      ({ appId, errorMessage }) => {
        const appInfo = runningApps.get(appId);
        if (!appInfo || appInfo.mode !== "cloud") {
          return;
        }

        const previousErrorMessage = appInfo.cloudSyncErrorMessage ?? null;
        appInfo.cloudSyncErrorMessage = errorMessage ?? undefined;

        const eventSink = appInfo.eventSink;
        if (!eventSink) {
          return;
        }

        if (errorMessage) {
          if (previousErrorMessage === errorMessage) {
            return;
          }

          addLog({
            level: "error",
            type: "server",
            message: errorMessage,
            timestamp: Date.now(),
            appId,
          });

          sendRuntimeEvent(eventSink, "app:output", {
            type: "sync-error",
            message: errorMessage,
            appId,
          });
          return;
        }

        if (!previousErrorMessage) {
          return;
        }

        const recoveredMessage =
          "Cloud sandbox sync recovered. Local changes are uploading again.";

        addLog({
          level: "info",
          type: "server",
          message: recoveredMessage,
          timestamp: Date.now(),
          appId,
        });

        sendRuntimeEvent(eventSink, "app:output", {
          type: "sync-recovered",
          message: recoveredMessage,
          appId,
        });
      },
    );
  });

  cloudSandboxSyncUpdateListenerRegistered = true;
}

function listenToProcess({
  process: spawnedProcess,
  appId,
  isNeon,
  event,
  eventSink,
}: {
  process: ChildProcess;
  appId: number;
  isNeon: boolean;
  event?: AppRuntimeEvent;
  eventSink: RunningAppEventSink;
}) {
  spawnedProcess.stdout?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.debug(
      `App ${appId} (PID: ${spawnedProcess.pid}) stdout: ${message}`,
    );

    addLog({
      level: "info",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    if (isNeon && message.includes("created or renamed from another")) {
      spawnedProcess.stdin?.write(`\r\n`);
      logger.info(
        `App ${appId} (PID: ${spawnedProcess.pid}) wrote enter to stdin to automatically respond to drizzle push input`,
      );
    }

    const inputRequestPattern = /\s*›\s*\([yY]\/[nN]\)\s*$/;
    const isInputRequest = inputRequestPattern.test(message);
    if (isInputRequest) {
      sendRuntimeEvent(eventSink, "app:output", {
        type: "input-requested",
        message,
        appId,
      });
    } else {
      const urlMatch = message.match(/(https?:\/\/localhost:\d+\/?)/);
      const output = {
        type: "stdout" as const,
        message,
        appId,
      };
      if (urlMatch) {
        sendRuntimeEvent(eventSink, "app:output", output);
        const originalUrl = urlMatch[1];
        await ensureProxyForRunningApp({
          appId,
          event,
          eventSink,
          originalUrl,
          mode: "host",
        });
      } else {
        enqueueAppOutput(eventSink, output);
      }
    }
  });

  spawnedProcess.stderr?.on("data", async (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.error(
      `App ${appId} (PID: ${spawnedProcess.pid}) stderr: ${message}`,
    );

    addLog({
      level: "error",
      type: "server",
      message,
      timestamp: Date.now(),
      appId,
    });

    enqueueAppOutput(eventSink, {
      type: "stderr",
      message,
      appId,
    });
  });

  spawnedProcess.on("close", (code, signal) => {
    logger.log(
      `App ${appId} (PID: ${spawnedProcess.pid}) process closed with code ${code}, signal ${signal}.`,
    );
    flushAllAppOutputs();
    const currentAppInfo = runningApps.get(appId);
    if (!currentAppInfo || currentAppInfo.process !== spawnedProcess) {
      removeAppIfCurrentProcess(appId, spawnedProcess);
      return;
    }

    sendRuntimeEvent(eventSink, "app:output", {
      type: "app-exit",
      message: `App process exited with code ${code ?? "null"}`,
      appId,
      exitCode: code,
      signal,
      timestamp: Date.now(),
    });
    removeAppIfCurrentProcess(appId, spawnedProcess);
  });

  spawnedProcess.on("error", (err) => {
    logger.error(
      `Error in app ${appId} (PID: ${spawnedProcess.pid}) process: ${err.message}`,
    );
    removeAppIfCurrentProcess(appId, spawnedProcess);
  });
}

async function executeAppInDocker({
  appPath,
  appId,
  event,
  eventSink,
  isNeon,
  installCommand,
  startCommand,
  readSettingsForRuntime,
}: {
  appPath: string;
  appId: number;
  event?: AppRuntimeEvent;
  eventSink: RunningAppEventSink;
  isNeon: boolean;
  installCommand?: string | null;
  startCommand?: string | null;
  readSettingsForRuntime: AppRuntimeSettingsReader;
}): Promise<void> {
  const containerName = `dyad-app-${appId}`;

  try {
    await new Promise<void>((resolve, reject) => {
      const checkDocker = spawn("docker", ["--version"], { stdio: "pipe" });
      checkDocker.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("Docker is not available"));
        }
      });
      checkDocker.on("error", () => {
        reject(new Error("Docker is not available"));
      });
    });
  } catch {
    throw new Error(
      "Docker is required but not available. Please install Docker Desktop and ensure it's running.",
    );
  }

  try {
    await new Promise<void>((resolve) => {
      const stopContainer = spawn("docker", ["stop", containerName], {
        stdio: "pipe",
      });
      stopContainer.on("close", () => {
        const removeContainer = spawn("docker", ["rm", containerName], {
          stdio: "pipe",
        });
        removeContainer.on("close", () => resolve());
        removeContainer.on("error", () => resolve());
      });
      stopContainer.on("error", () => resolve());
    });
  } catch (error) {
    logger.info(
      `Docker container ${containerName} not found. Ignoring error: ${error}`,
    );
  }

  const dockerfilePath = path.join(appPath, "Dockerfile.dyad");
  if (!fs.existsSync(dockerfilePath)) {
    const dockerfileContent = `FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm
`;

    try {
      await fs.promises.writeFile(dockerfilePath, dockerfileContent, "utf-8");
    } catch (error) {
      logger.error(`Failed to create Dockerfile for app ${appId}:`, error);
      throw new DyadError(
        `Failed to create Dockerfile: ${error}`,
        DyadErrorKind.External,
      );
    }
  }

  const buildProcess = spawn(
    "docker",
    ["build", "-f", "Dockerfile.dyad", "-t", `dyad-app-${appId}`, "."],
    {
      cwd: appPath,
      stdio: "pipe",
    },
  );

  let buildError = "";
  buildProcess.stderr?.on("data", (data) => {
    buildError += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    buildProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed: ${buildError}`));
      }
    });
    buildProcess.on("error", (err) => {
      reject(new Error(`Docker build process error: ${err.message}`));
    });
  });

  const port = getAppPort(appId);
  const process = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      "-p",
      `${port}:${port}`,
      "-v",
      `${appPath}:/app`,
      "-v",
      `dyad-pnpm-${appId}:/app/.pnpm-store`,
      "-e",
      "PNPM_STORE_PATH=/app/.pnpm-store",
      "-w",
      "/app",
      `dyad-app-${appId}`,
      "sh",
      "-c",
      (
        await getCommand({
          runtimeMode: "docker",
          appId,
          appPath,
          installCommand,
          startCommand,
          onPnpmMinimumReleaseAgeWarning: (message) =>
            emitPnpmMinimumReleaseAgeWarning({
              appId,
              eventSink,
              message,
              readSettingsForRuntime,
            }),
        })
      ).command,
    ],
    {
      stdio: "pipe",
      detached: false,
    },
  );

  if (!process.pid) {
    let errorOutput = "";
    let spawnErr: any = null;
    process.stderr?.on("data", (data) => (errorOutput += data.toString()));
    await new Promise<void>((resolve) => {
      process.once("error", (err) => {
        spawnErr = err;
        resolve();
      });
    });

    const details = [
      spawnErr?.message ? `message=${spawnErr.message}` : null,
      spawnErr?.code ? `code=${spawnErr.code}` : null,
      spawnErr?.errno ? `errno=${spawnErr.errno}` : null,
      spawnErr?.syscall ? `syscall=${spawnErr.syscall}` : null,
      spawnErr?.path ? `path=${spawnErr.path}` : null,
      spawnErr?.spawnargs
        ? `spawnargs=${JSON.stringify(spawnErr.spawnargs)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error(
      `Failed to spawn Docker container for app ${appId}. ${details}\nSTDERR:\n${
        errorOutput || "(empty)"
      }`,
    );

    throw new Error(
      `Failed to spawn Docker container for app ${appId}.
Details: ${details || "n/a"}
STDERR:
${errorOutput || "(empty)"}`,
    );
  }

  const currentProcessId = processCounter.increment();
  runningApps.set(appId, {
    process,
    processId: currentProcessId,
    mode: "docker",
    eventSink,
    rendererSender: event?.sender,
    containerName,
    lastViewedAt: Date.now(),
  });

  listenToProcess({
    process,
    appId,
    isNeon,
    event,
    eventSink,
  });
}

async function executeAppInCloud({
  appPath,
  appId,
  event,
  eventSink,
  installCommand,
  startCommand,
}: {
  appPath: string;
  appId: number;
  event?: AppRuntimeEvent;
  eventSink: RunningAppEventSink;
  installCommand?: string | null;
  startCommand?: string | null;
}): Promise<void> {
  const currentProcessId = processCounter.increment();
  let sandboxId: string | undefined;
  let previewUrl: string | undefined;
  let previewAuthToken: string | undefined;
  const cloudSandboxProvider = await getCloudSandboxProvider();

  try {
    const createResult = await cloudSandboxProvider.createCloudSandbox({
      appId,
      appPath,
      installCommand,
      startCommand,
    });
    sandboxId = createResult.sandboxId;
    previewUrl = createResult.previewUrl;
    previewAuthToken = createResult.previewAuthToken;

    const files = await cloudSandboxProvider.buildCloudSandboxFileMap(appPath);
    const uploadResult = await cloudSandboxProvider.uploadCloudSandboxFiles({
      sandboxId,
      files,
      replaceAll: true,
    });
    previewUrl = uploadResult.previewUrl ?? previewUrl;
    previewAuthToken = uploadResult.previewAuthToken ?? previewAuthToken;
  } catch (error) {
    if (sandboxId) {
      try {
        await cloudSandboxProvider.destroyCloudSandbox(sandboxId);
      } catch (cleanupError) {
        logger.warn(
          `Failed to clean up cloud sandbox ${sandboxId} after startup error for app ${appId}:`,
          cleanupError,
        );
      }
    }
    throw new Error(formatCloudSandboxError(error));
  }

  const resolvedPreviewUrl = previewUrl;
  const resolvedPreviewAuthToken = previewAuthToken;
  if (!sandboxId || !resolvedPreviewUrl || !resolvedPreviewAuthToken) {
    throw new Error(
      "Cloud sandbox startup returned incomplete preview credentials.",
    );
  }

  const cloudLogAbortController = new AbortController();
  runningApps.set(appId, {
    process: null,
    processId: currentProcessId,
    mode: "cloud",
    eventSink,
    rendererSender: event?.sender,
    cloudSandboxId: sandboxId,
    cloudPreviewUrl: resolvedPreviewUrl,
    cloudPreviewAuthToken: resolvedPreviewAuthToken,
    cloudLogAbortController,
    lastViewedAt: Date.now(),
    originalUrl: resolvedPreviewUrl,
  });
  cloudSandboxProvider.registerRunningCloudSandbox({
    appId,
    appPath,
    sandboxId,
  });

  await ensureProxyForRunningApp({
    appId,
    event,
    eventSink,
    originalUrl: resolvedPreviewUrl,
    mode: "cloud",
  });

  startCloudSandboxLogStream({
    appId,
    eventSink,
    sandboxId,
    cloudLogAbortController,
  });
}

export function startCloudSandboxLogStream(input: {
  appId: number;
  eventSink: RunningAppEventSink;
  sandboxId: string;
  cloudLogAbortController: AbortController;
}) {
  void (async () => {
    try {
      const cloudSandboxProvider = await getCloudSandboxProvider();
      for await (const message of cloudSandboxProvider.streamCloudSandboxLogs(
        input.sandboxId,
        input.cloudLogAbortController.signal,
      )) {
        const appInfo = runningApps.get(input.appId);
        if (!appInfo || appInfo.cloudSandboxId !== input.sandboxId) {
          return;
        }

        addLog({
          level: "info",
          type: "server",
          message,
          timestamp: Date.now(),
          appId: input.appId,
        });

        sendRuntimeEvent(input.eventSink, "app:output", {
          type: "stdout",
          message,
          appId: input.appId,
        });
      }
    } catch (error) {
      if (input.cloudLogAbortController.signal.aborted) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : `Cloud sandbox log stream failed: ${String(error)}`;

      addLog({
        level: "error",
        type: "server",
        message,
        timestamp: Date.now(),
        appId: input.appId,
      });

      sendRuntimeEvent(input.eventSink, "app:output", {
        type: "stderr",
        message,
        appId: input.appId,
      });
    }
  })();
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPort(port, "tcp");
  } catch {
    // Ignore if nothing was running on that port.
  }
}

async function stopDockerContainersOnPort(port: number): Promise<void> {
  try {
    const list = spawn("docker", ["ps", "--filter", `publish=${port}`, "-q"], {
      stdio: "pipe",
    });

    let stdout = "";
    list.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    await new Promise<void>((resolve) => {
      list.on("close", () => resolve());
      list.on("error", () => resolve());
    });

    const containerIds = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (containerIds.length === 0) {
      return;
    }

    await Promise.all(
      containerIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const stop = spawn("docker", ["stop", id], { stdio: "pipe" });
            stop.on("close", () => resolve());
            stop.on("error", () => resolve());
          }),
      ),
    );
  } catch (e) {
    logger.warn(`Failed stopping Docker containers on port ${port}: ${e}`);
  }
}

export async function cleanUpPort(
  port: number,
  readSettingsForRuntime: AppRuntimeSettingsReader = defaultReadSettingsForRuntime,
) {
  const settings = await readSettingsForRuntime();
  if (settings.runtimeMode2 === "docker") {
    await stopDockerContainersOnPort(port);
  } else {
    await killProcessOnPort(port);
  }
}
