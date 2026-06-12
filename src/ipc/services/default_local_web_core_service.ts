import fs from "node:fs";
import path from "node:path";
import { arch, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { desc, eq, inArray, isNotNull, like } from "drizzle-orm";
import log from "electron-log";

import { db } from "@/db";
import {
  appCollections,
  apps,
  chats,
  messages,
  mcpServers,
  mcpToolConsents,
  prompts,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getMimeType, MIME_TYPE_MAP } from "@/ipc/utils/mime_utils";
import {
  DYAD_MEDIA_DIR_NAME,
  DYAD_SCREENSHOT_DIR_NAME,
  SCREENSHOT_FILENAME_REGEX,
} from "@/ipc/utils/media_path_utils";
import { generateProblemReport } from "@/ipc/processors/tsc";
import { addLog, clearLogs } from "@/lib/log_store";
import { localTemplatesData } from "@/shared/templates";
import { themesData } from "@/shared/themes";
import { normalizePath } from "../../../shared/normalizePath";
import { getFilesRecursively } from "../utils/file_utils";
import { detectFrameworkType } from "../utils/framework_utils";
import { createLocalWebCoreService } from "./local_web_core_service";
import {
  createLocalWebSettingsStore,
  type LocalWebSettingsStore,
} from "@/server/local_web_settings";
import {
  createLocalWebPathResolver,
  getDefaultLocalWebUserDataPath,
  type LocalWebPathResolver,
} from "@/server/local_web_paths";
import { getLocalWebMediaUrl } from "@/server/local_web_media_routes";
import {
  getLanguageModelProviders,
  getLanguageModels,
  getLanguageModelsByProviders,
} from "../shared/language_model_helpers";
import { installPnpm } from "./node_environment_service";
import {
  checkoutVersionHandler,
  revertVersionHandler,
} from "../handlers/version_handlers";
import type {
  AppSearchResult,
  McpConsentValue,
  McpServer,
  McpTransport,
  SystemDebugInfo,
  Version,
} from "@/ipc/types";

const logger = log.scope("local_web_core_service");
const execFileAsync = promisify(execFile);
const SUPPORTED_MEDIA_EXTENSIONS = Object.keys(MIME_TYPE_MAP);
const DEFAULT_OAUTH_CALLBACK_PORT = 53682;

export interface DefaultLocalWebCoreServiceOptions {
  settingsStore?: LocalWebSettingsStore;
  pathResolver?: LocalWebPathResolver;
  userDataPath?: string;
  getSupabaseProjectName?: (
    projectId: string,
    organizationSlug?: string,
  ) => Promise<string>;
  getVercelTeamSlug?: (teamId: string) => Promise<string | null>;
  getMediaBaseUrl?: () => string | undefined;
}

export function createDefaultLocalWebCoreService(
  options: DefaultLocalWebCoreServiceOptions = {},
) {
  const settingsStore =
    options.settingsStore ??
    createLocalWebSettingsStore({
      userDataPath: options.userDataPath ?? getDefaultLocalWebUserDataPath(),
    });
  const pathResolver =
    options.pathResolver ??
    createLocalWebPathResolver({
      userDataPath: settingsStore.userDataPath,
      settingsStore,
    });

  return createLocalWebCoreService({
    findAppById: (appId) =>
      db.query.apps.findFirst({
        where: eq(apps.id, appId),
      }),
    listApps: () =>
      db.query.apps.findMany({
        orderBy: [desc(apps.createdAt)],
      }),
    findChatWithMessagesById: (chatId) =>
      db.query.chats.findFirst({
        where: eq(chats.id, chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
        },
      }),
    listChats: (appId) =>
      db.query.chats.findMany({
        where: appId === undefined ? undefined : eq(chats.appId, appId),
        columns: {
          id: true,
          appId: true,
          title: true,
          createdAt: true,
          chatMode: true,
        },
        orderBy: [desc(chats.createdAt)],
      }),
    findChatMetadataById: (chatId) =>
      db.query.chats.findFirst({
        where: eq(chats.id, chatId),
        columns: {
          id: true,
          appId: true,
          title: true,
          createdAt: true,
          chatMode: true,
        },
      }),
    searchApps: (query) => searchApps(query),
    listPrompts: async () =>
      db
        .select()
        .from(prompts)
        .orderBy(desc(prompts.updatedAt))
        .all()
        .map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          content: row.content,
          slug: row.slug,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
    listAppCollections: async () => {
      const rows = db
        .select()
        .from(appCollections)
        .orderBy(appCollections.name)
        .all();
      const appRows = db
        .select({ id: apps.id, collectionId: apps.collectionId })
        .from(apps)
        .where(isNotNull(apps.collectionId))
        .all();
      const appsByCollection = new Map<number, number[]>();
      for (const row of appRows) {
        if (row.collectionId == null) continue;
        const list = appsByCollection.get(row.collectionId) ?? [];
        list.push(row.id);
        appsByCollection.set(row.collectionId, list);
      }
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        appIds: appsByCollection.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    },
    listCustomThemes: async () =>
      db.query.customThemes.findMany({
        orderBy: (themes, { desc }) => [desc(themes.createdAt)],
      }),
    listMcpServers: async () => {
      const servers = await db.select().from(mcpServers);
      return servers.map(toMcpServer);
    },
    listMcpToolConsents: async () => {
      const consents = await db.select().from(mcpToolConsents);
      return consents.map((consent) => ({
        ...consent,
        consent: consent.consent as McpConsentValue,
      }));
    },
    listVersions: (appId) => listVersions(appId, pathResolver),
    getCurrentBranch: (appId) => getCurrentBranch(appId, pathResolver),
    revertVersion: (params) => revertVersionHandler(params),
    checkoutVersion: (params) => checkoutVersionHandler(params),
    checkProblems: (appId) => checkProblems(appId, pathResolver),
    addLog,
    clearLogs,
    listAllMedia: () => listAllMedia(pathResolver),
    listAppScreenshots: (appId) =>
      listAppScreenshots(appId, pathResolver, options.getMediaBaseUrl),
    listAppThumbnails: (appIds) =>
      listAppThumbnails(appIds, pathResolver, options.getMediaBaseUrl),
    getCurrentCommitHash: (appId) => getCurrentCommitHash(appId, pathResolver),
    saveAppScreenshot: (params) => saveAppScreenshot(params, pathResolver),
    resolveAppPath: (appPath) => pathResolver.getDyadAppPath(appPath),
    listAppFiles: (appPath) => getFilesRecursively(appPath, appPath),
    normalizePath,
    readSettings: settingsStore.readSettings,
    writeSettings: settingsStore.writeSettings,
    getEnvVar: (name) => process.env[name],
    getSystemPlatform: () => platform(),
    getAppVersion: () => readPackageVersion(),
    getCustomAppsFolder: () => {
      const directory = pathResolver.getDyadAppsBaseDirectory();
      return {
        path: directory,
        isPathAvailable: isDirectoryAccessible(directory),
        isPathDefault: settingsStore.readSettings().customAppsFolder == null,
      };
    },
    getSystemDebugInfo: async () =>
      getSystemDebugInfo({
        settingsStore,
      }),
    getNodejsStatus: () => getNodejsStatus(),
    installPnpm: () =>
      installPnpm({ readSettings: settingsStore.readSettings }),
    getTemplates: async () => localTemplatesData,
    getThemes: async () => themesData,
    getLanguageModelProviders,
    getLanguageModels: (providerId) => getLanguageModels({ providerId }),
    getLanguageModelsByProviders,
    getFreeAgentQuotaStatus: async () => ({
      messagesUsed: 0,
      messagesLimit: 5,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    }),
    getUserBudget: async () => null,
    getAppTheme: async (appId) => {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: { themeId: true },
      });
      return app?.themeId ?? null;
    },
    listMcpTools: async () => ({ tools: [], status: "error" }),
    isMcpOauthStorageEncrypted: async () => ({ available: false }),
    probeMcpCallbackPort: async () => ({ port: DEFAULT_OAUTH_CALLBACK_PORT }),
    getSupabaseProjectName:
      options.getSupabaseProjectName ?? (async () => null as never),
    getVercelTeamSlug: options.getVercelTeamSlug ?? (async () => null),
    detectFrameworkType,
    onRecoverableError: (message, error) => logger.error(message, error),
  });
}

async function getCurrentBranch(
  appId: number,
  pathResolver: LocalWebPathResolver,
): Promise<{ branch: string }> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  const appPath = pathResolver.getDyadAppPath(app.path);
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    throw new DyadError("Not a git repository", DyadErrorKind.External);
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      { cwd: appPath },
    );
    return { branch: stdout.trim() || "<no-branch>" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DyadError(
      `Failed to get current branch: ${message}`,
      DyadErrorKind.External,
    );
  }
}

async function checkProblems(
  appId: number,
  pathResolver: LocalWebPathResolver,
) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new DyadError(`App not found: ${appId}`, DyadErrorKind.NotFound);
  }

  try {
    return await generateProblemReport({
      fullResponse: "",
      appPath: pathResolver.getDyadAppPath(app.path),
    });
  } catch (error) {
    if (
      error instanceof DyadError &&
      error.kind === DyadErrorKind.Precondition
    ) {
      logger.warn(`Skipping problem check for app ${appId}: ${error.message}`);
      return { problems: [] };
    }
    throw error;
  }
}

async function searchApps(query: string): Promise<AppSearchResult[]> {
  const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;

  const appNameMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
    })
    .from(apps)
    .where(like(apps.name, pattern))
    .orderBy(desc(apps.createdAt));

  const appNameMatchesResult: AppSearchResult[] = appNameMatches.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    matchedChatTitle: null,
    matchedChatMessage: null,
  }));

  const chatMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
      matchedChatTitle: chats.title,
    })
    .from(apps)
    .innerJoin(chats, eq(apps.id, chats.appId))
    .where(like(chats.title, pattern))
    .orderBy(desc(apps.createdAt));

  const chatMatchesResult: AppSearchResult[] = chatMatches.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    matchedChatTitle: row.matchedChatTitle,
    matchedChatMessage: null,
  }));

  const messageMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
      matchedChatTitle: chats.title,
      matchedChatMessage: messages.content,
    })
    .from(apps)
    .innerJoin(chats, eq(apps.id, chats.appId))
    .innerJoin(messages, eq(chats.id, messages.chatId))
    .where(like(messages.content, pattern))
    .orderBy(desc(apps.createdAt));

  const combined = [
    ...appNameMatchesResult,
    ...chatMatchesResult,
    ...messageMatches,
  ];
  const uniqueApps = Array.from(
    new Map(combined.map((item) => [item.id, item])).values(),
  );
  uniqueApps.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return uniqueApps;
}

async function listVersions(
  appId: number,
  pathResolver: LocalWebPathResolver,
): Promise<Version[]> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    return [];
  }

  const appPath = pathResolver.getDyadAppPath(app.path);
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--pretty=format:%H%x1f%s%x1f%ct", "-n", "100000"],
      { cwd: appPath },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [oid, message, timestamp] = line.split("\x1f");
        return {
          oid,
          message: message ?? "",
          timestamp: Number(timestamp ?? 0),
          dbTimestamp: null,
        };
      });
  } catch (error) {
    logger.warn(`Failed to list versions for app ${appId}`, error);
    return [];
  }
}

async function listAppScreenshots(
  appId: number,
  pathResolver: LocalWebPathResolver,
  getMediaBaseUrl?: () => string | undefined,
): Promise<{ screenshots: { commitHash: string; url: string }[] }> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!appRecord) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  const screenshotDir = path.join(
    pathResolver.getDyadAppPath(appRecord.path),
    DYAD_SCREENSHOT_DIR_NAME,
  );
  const entries = await readScreenshotEntries(screenshotDir);
  return {
    screenshots: entries.map(({ name }) => ({
      commitHash: name.slice(0, -".png".length),
      url: buildLocalWebMediaUrl({
        appPath: appRecord.path,
        dyadRelativePath: path.posix.join(DYAD_SCREENSHOT_DIR_NAME, name),
        getMediaBaseUrl,
      }),
    })),
  };
}

async function listAppThumbnails(
  appIds: number[],
  pathResolver: LocalWebPathResolver,
  getMediaBaseUrl?: () => string | undefined,
): Promise<{ thumbnails: { appId: number; thumbnailUrl: string | null }[] }> {
  if (appIds.length === 0) {
    return { thumbnails: [] };
  }

  const records = await db.query.apps.findMany({
    where: inArray(apps.id, appIds),
  });
  const recordById = new Map(records.map((record) => [record.id, record]));

  const thumbnails = await Promise.all(
    appIds.map(async (appId) => {
      const record = recordById.get(appId);
      if (!record) {
        return { appId, thumbnailUrl: null };
      }

      const screenshotDir = path.join(
        pathResolver.getDyadAppPath(record.path),
        DYAD_SCREENSHOT_DIR_NAME,
      );
      const latest = (await readScreenshotEntries(screenshotDir))[0];
      return {
        appId,
        thumbnailUrl: latest
          ? buildLocalWebMediaUrl({
              appPath: record.path,
              dyadRelativePath: path.posix.join(
                DYAD_SCREENSHOT_DIR_NAME,
                latest.name,
              ),
              getMediaBaseUrl,
            })
          : null,
      };
    }),
  );

  return { thumbnails };
}

function buildLocalWebMediaUrl({
  appPath,
  dyadRelativePath,
  getMediaBaseUrl,
}: {
  appPath: string;
  dyadRelativePath: string;
  getMediaBaseUrl?: () => string | undefined;
}): string {
  const baseUrl = getMediaBaseUrl?.();
  if (baseUrl) {
    return getLocalWebMediaUrl({ appPath, dyadRelativePath, baseUrl });
  }
  return `dyad-media://media/${encodeURIComponent(appPath)}/${dyadRelativePath}`;
}

async function getCurrentCommitHash(
  appId: number,
  pathResolver: LocalWebPathResolver,
): Promise<{ commitHash: string | null }> {
  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!appRecord) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  const appPath = pathResolver.getDyadAppPath(appRecord.path);
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    return { commitHash: null };
  }

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: appPath,
    });
    return { commitHash: stdout.trim() || null };
  } catch {
    return { commitHash: null };
  }
}

async function saveAppScreenshot(
  params: { appId: number; dataUrl: string; commitHash: string },
  pathResolver: LocalWebPathResolver,
): Promise<void> {
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(params.dataUrl)) {
    throw new DyadError(
      "Invalid screenshot data URL format",
      DyadErrorKind.Validation,
    );
  }

  const maxDataUrlLength = 5 * 1024 * 1024;
  if (params.dataUrl.length > maxDataUrlLength) {
    throw new DyadError(
      "Screenshot data URL exceeds maximum allowed size",
      DyadErrorKind.Validation,
    );
  }

  const appRecord = await db.query.apps.findFirst({
    where: eq(apps.id, params.appId),
  });
  if (!appRecord) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  if (!SCREENSHOT_FILENAME_REGEX.test(`${params.commitHash}.png`)) {
    logger.warn(
      `Skipping screenshot save for app ${params.appId}: unexpected commit hash format`,
    );
    return;
  }

  const screenshotDir = path.join(
    pathResolver.getDyadAppPath(appRecord.path),
    DYAD_SCREENSHOT_DIR_NAME,
  );
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  const base64Data = params.dataUrl.replace(/^data:image\/\w+;base64,/, "");
  await fs.promises.writeFile(
    path.join(screenshotDir, `${params.commitHash}.png`),
    Buffer.from(base64Data, "base64"),
  );

  const maxScreenshotsPerApp = 10;
  const screenshots = await readScreenshotEntries(screenshotDir);
  for (const extra of screenshots.slice(maxScreenshotsPerApp)) {
    await fs.promises
      .unlink(path.join(screenshotDir, extra.name))
      .catch(() => undefined);
  }
}

async function listAllMedia(pathResolver: LocalWebPathResolver) {
  const allApps = await db.select().from(apps);
  const appResults = await Promise.all(
    allApps.map(async (app) => {
      const appPath = pathResolver.getDyadAppPath(app.path);
      const files = await getMediaFilesForApp(app.id, app.name, appPath);
      if (files.length === 0) {
        return null;
      }
      return {
        appId: app.id,
        appName: app.name,
        appPath,
        files,
      };
    }),
  );

  return { apps: appResults.filter((result) => result !== null) };
}

async function getMediaFilesForApp(
  appId: number,
  appName: string,
  appPath: string,
) {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  try {
    await fs.promises.access(mediaDir);
  } catch {
    return [];
  }

  const entries = await fs.promises.readdir(mediaDir, { withFileTypes: true });
  const mediaEntries = entries.filter((entry) => {
    if (!entry.isFile()) return false;
    const ext = path.extname(entry.name).toLowerCase();
    return SUPPORTED_MEDIA_EXTENSIONS.includes(ext);
  });

  const results = await Promise.all(
    mediaEntries.map(async (entry) => {
      const fullPath = path.join(mediaDir, entry.name);
      try {
        const stat = await fs.promises.stat(fullPath);
        return {
          fileName: entry.name,
          filePath: fullPath,
          appId,
          appName,
          sizeBytes: stat.size,
          mimeType: getMimeType(path.extname(entry.name).toLowerCase()),
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((file) => file !== null);
}

async function readScreenshotEntries(
  screenshotDir: string,
): Promise<{ name: string; mtimeMs: number }[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(screenshotDir);
  } catch {
    return [];
  }

  const results: { name: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!SCREENSHOT_FILENAME_REGEX.test(entry)) continue;
    try {
      const stat = await fs.promises.stat(path.join(screenshotDir, entry));
      results.push({ name: entry, mtimeMs: stat.mtimeMs });
    } catch {
      // Skip files deleted while listing.
    }
  }
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

async function getSystemDebugInfo({
  settingsStore,
}: {
  settingsStore: LocalWebSettingsStore;
}): Promise<SystemDebugInfo> {
  const settings = settingsStore.readSettings();
  const [nodeVersion, pnpmVersion] = await Promise.all([
    runVersionCommand(process.execPath, ["--version"]),
    runVersionCommand("pnpm", ["--version"]),
  ]);

  return {
    nodeVersion,
    pnpmVersion,
    nodePath: process.execPath,
    telemetryId: settings.telemetryUserId || "unknown",
    telemetryConsent: settings.telemetryConsent || "unknown",
    telemetryUrl: "https://us.i.posthog.com",
    dyadVersion: readPackageVersion(),
    platform: platform(),
    architecture: arch(),
    logs: "",
    selectedLanguageModel: `${settings.selectedModel.provider}:${settings.selectedModel.name} | customId: ${settings.selectedModel.customModelId}`,
  };
}

async function getNodejsStatus() {
  const [nodeVersion, pnpmVersion] = await Promise.all([
    runVersionCommand(process.execPath, ["--version"]),
    runVersionCommand("pnpm", ["--version"]),
  ]);
  return {
    nodeVersion,
    pnpmVersion,
    nodeDownloadUrl: getNodeDownloadUrl(),
  };
}

async function runVersionCommand(
  command: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args);
    return stdout.trim();
  } catch {
    return null;
  }
}

function getNodeDownloadUrl(): string {
  if (platform() === "win32") {
    return arch() === "arm64" || arch() === "arm"
      ? "https://nodejs.org/dist/v22.22.3/node-v22.22.3-arm64.msi"
      : "https://nodejs.org/dist/v22.22.3/node-v22.22.3-x64.msi";
  }
  return "https://nodejs.org/dist/v22.22.3/node-v22.22.3.pkg";
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function isDirectoryAccessible(directory: string): boolean {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function toMcpServer(dbServer: typeof mcpServers.$inferSelect): McpServer {
  return {
    id: dbServer.id,
    name: dbServer.name,
    transport: dbServer.transport as McpTransport,
    command: dbServer.command,
    args: dbServer.args,
    envJson: dbServer.envJson,
    headersJson: dbServer.headersJson,
    url: dbServer.url,
    enabled: dbServer.enabled,
    oauthEnabled: dbServer.oauthEnabled,
    oauthConnected: false,
    oauthCallbackPort: dbServer.oauthCallbackPort,
    createdAt: dbServer.createdAt,
    updatedAt: dbServer.updatedAt,
  };
}
