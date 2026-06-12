import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import { and, desc, eq, inArray, isNotNull, like, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  appCollections,
  apps,
  chats,
  customThemes,
  messages,
  prompts,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AppCollectionDto, AppFileSearchResult } from "@/ipc/types";
import {
  createLocalWebPathResolver,
  getDefaultLocalWebUserDataPath,
  type LocalWebPathResolver,
} from "@/server/local_web_paths";
import {
  createLocalWebSettingsStore,
  type LocalWebSettingsStore,
} from "@/server/local_web_settings";
import {
  createLocalWebMutationService,
  searchAppFilesWithRipgrep,
} from "./local_web_mutation_service";
import { getRgExecutablePath } from "@/ipc/utils/ripgrep_utils";

export interface DefaultLocalWebMutationServiceOptions {
  settingsStore?: LocalWebSettingsStore;
  pathResolver?: LocalWebPathResolver;
  userDataPath?: string;
  rgPath?: string;
}

export function createDefaultLocalWebMutationService(
  options: DefaultLocalWebMutationServiceOptions = {},
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
  const rgPath = options.rgPath ?? getRgExecutablePath();

  return createLocalWebMutationService({
    findAppById: (appId) =>
      db.query.apps.findFirst({
        where: eq(apps.id, appId),
      }),
    findAppByName: (name) =>
      db.query.apps.findFirst({
        where: eq(apps.name, name),
      }),
    listApps: () => db.query.apps.findMany(),
    insertApp: async (values) => {
      const [app] = await db.insert(apps).values(values).returning();
      return app;
    },
    updateApp: async (appId, values) => {
      const [app] = await db
        .update(apps)
        .set(values)
        .where(eq(apps.id, appId))
        .returning();
      return app;
    },
    deleteApp: async (appId) => {
      await db.delete(apps).where(eq(apps.id, appId));
    },
    insertChat: async (values) => {
      const [chat] = await db.insert(chats).values(values).returning();
      return chat;
    },
    updateChat: async (chatId, values) => {
      await db.update(chats).set(values).where(eq(chats.id, chatId));
    },
    deleteChat: async (chatId) => {
      await db.delete(chats).where(eq(chats.id, chatId));
    },
    deleteMessages: async (chatId) => {
      await db.delete(messages).where(eq(messages.chatId, chatId));
    },
    searchChats: ({ appId, query }) => searchChats(appId, query),
    listPrompts: async () =>
      db
        .select()
        .from(prompts)
        .orderBy(desc(prompts.updatedAt))
        .all()
        .map(toPromptDto),
    insertPrompt: async (values) => {
      const [prompt] = await db.insert(prompts).values(values).returning();
      return toPromptDto(prompt);
    },
    updatePrompt: async (id, values) => {
      await db.update(prompts).set(values).where(eq(prompts.id, id));
    },
    deletePrompt: async (id) => {
      await db.delete(prompts).where(eq(prompts.id, id));
    },
    listAppCollections,
    createAppCollection,
    updateAppCollection,
    deleteAppCollection,
    assignApps,
    listCustomThemes: async () =>
      db.query.customThemes.findMany({
        orderBy: (themes, { desc }) => [desc(themes.createdAt)],
      }),
    findCustomThemeById: (id) =>
      db.query.customThemes.findFirst({
        where: eq(customThemes.id, id),
      }),
    findCustomThemeByName: (name, excludeId) =>
      db.query.customThemes.findFirst({
        where:
          excludeId === undefined
            ? sql`LOWER(${customThemes.name}) = LOWER(${name})`
            : and(
                sql`LOWER(${customThemes.name}) = LOWER(${name})`,
                ne(customThemes.id, excludeId),
              ),
      }),
    insertCustomTheme: async (values) => {
      const [theme] = await db.insert(customThemes).values(values).returning();
      return theme;
    },
    updateCustomTheme: async (id, values) => {
      const [theme] = await db
        .update(customThemes)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(customThemes.id, id))
        .returning();
      return theme;
    },
    deleteCustomTheme: async (id) => {
      await db.delete(customThemes).where(eq(customThemes.id, id));
    },
    resolveAppPath: (appPath) => pathResolver.getDyadAppPath(appPath),
    getScaffoldPath: () => path.resolve(process.cwd(), "scaffold"),
    isDirectoryAccessible,
    readSettings: settingsStore.readSettings,
    copyPath,
    ensureDirectory: (directory) =>
      fs.promises.mkdir(directory, { recursive: true }).then(() => undefined),
    removePath: (targetPath) =>
      fs.promises
        .rm(targetPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        })
        .then(() => undefined),
    renamePath: (source, destination) =>
      fs.promises.rename(source, destination),
    pathExists: (targetPath) =>
      fs.promises
        .access(targetPath)
        .then(() => true)
        .catch(() => false),
    readTextFile: (filePath) => fs.promises.readFile(filePath, "utf-8"),
    writeTextFile: async (filePath, content) => {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, "utf-8");
    },
    listDirectory: (directory) =>
      fs.promises.readdir(directory, { withFileTypes: true }),
    stat: (filePath) => fs.promises.stat(filePath),
    unlink: (filePath) => fs.promises.unlink(filePath),
    gitInit: (appPath) => runGit(appPath, ["init", "-b", "main"]),
    gitAdd: (appPath, filePath) => runGit(appPath, ["add", "--", filePath]),
    gitCommit: async (appPath, message) => {
      await runGit(appPath, [
        "-c",
        "user.name=Dyad",
        "-c",
        "user.email=dyad@example.com",
        "commit",
        "-m",
        message,
      ]);
      return getCurrentCommitHash(appPath);
    },
    getCurrentCommitHash,
    searchFiles: (appPath, query): Promise<AppFileSearchResult[]> =>
      searchAppFilesWithRipgrep({ appPath, query, rgPath }),
  });
}

async function searchChats(appId: number, query: string) {
  const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
  const titleMatches = await db
    .select({
      id: chats.id,
      appId: chats.appId,
      title: chats.title,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .where(and(eq(chats.appId, appId), like(chats.title, pattern)))
    .orderBy(desc(chats.createdAt))
    .limit(10);

  const messageMatches = await db
    .select({
      id: chats.id,
      appId: chats.appId,
      title: chats.title,
      createdAt: chats.createdAt,
      matchedMessageContent: messages.content,
    })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(and(eq(chats.appId, appId), like(messages.content, pattern)))
    .orderBy(desc(chats.createdAt))
    .limit(10);

  const combined = [
    ...titleMatches.map((chat) => ({
      ...chat,
      matchedMessageContent: null,
    })),
    ...messageMatches,
  ];
  const uniqueChats = [
    ...new Map(combined.map((chat) => [chat.id, chat])).values(),
  ];
  uniqueChats.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return uniqueChats;
}

async function listAppCollections(): Promise<AppCollectionDto[]> {
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
}

async function createAppCollection(params: {
  name: string;
  appIds?: number[];
}): Promise<AppCollectionDto> {
  try {
    const id = db.transaction((tx) => {
      const result = tx
        .insert(appCollections)
        .values({ name: params.name })
        .run();
      const newId = Number(result.lastInsertRowid);
      if (params.appIds?.length) {
        tx.update(apps)
          .set({ collectionId: newId })
          .where(inArray(apps.id, params.appIds))
          .run();
      }
      return newId;
    });
    const collection = (await listAppCollections()).find(
      (item) => item.id === id,
    );
    if (!collection) {
      throw new DyadError(
        "Failed to fetch created collection",
        DyadErrorKind.Internal,
      );
    }
    return collection;
  } catch (error) {
    if (isUniqueNameError(error, "app_collections.name")) {
      throw new DyadError(
        "A collection with that name already exists",
        DyadErrorKind.Conflict,
      );
    }
    throw error;
  }
}

async function updateAppCollection(params: {
  id: number;
  name: string;
  appIds?: number[];
}): Promise<void> {
  try {
    db.transaction((tx) => {
      const existingCollection = tx
        .select({ id: appCollections.id })
        .from(appCollections)
        .where(eq(appCollections.id, params.id))
        .get();
      if (!existingCollection) {
        throw new DyadError("Collection not found", DyadErrorKind.NotFound);
      }
      tx.update(appCollections)
        .set({ name: params.name, updatedAt: new Date() })
        .where(eq(appCollections.id, params.id))
        .run();
      if (params.appIds) {
        const existing = tx
          .select({ id: apps.id })
          .from(apps)
          .where(eq(apps.collectionId, params.id))
          .all();
        const before = new Set(existing.map((app) => app.id));
        const after = new Set(params.appIds);
        const toAdd = params.appIds.filter((appId) => !before.has(appId));
        const toRemove = existing
          .map((app) => app.id)
          .filter((appId) => !after.has(appId));
        if (toAdd.length > 0) {
          tx.update(apps)
            .set({ collectionId: params.id })
            .where(inArray(apps.id, toAdd))
            .run();
        }
        if (toRemove.length > 0) {
          tx.update(apps)
            .set({ collectionId: null })
            .where(inArray(apps.id, toRemove))
            .run();
        }
      }
    });
  } catch (error) {
    if (isUniqueNameError(error, "app_collections.name")) {
      throw new DyadError(
        "A collection with that name already exists",
        DyadErrorKind.Conflict,
      );
    }
    throw error;
  }
}

async function deleteAppCollection(id: number): Promise<void> {
  db.transaction((tx) => {
    const existingCollection = tx
      .select({ id: appCollections.id })
      .from(appCollections)
      .where(eq(appCollections.id, id))
      .get();
    if (!existingCollection) {
      throw new DyadError("Collection not found", DyadErrorKind.NotFound);
    }
    tx.update(apps)
      .set({ collectionId: null })
      .where(eq(apps.collectionId, id))
      .run();
    tx.delete(appCollections).where(eq(appCollections.id, id)).run();
  });
}

async function assignApps(params: {
  collectionId: number | null;
  appIds: number[];
}): Promise<void> {
  if (params.appIds.length === 0) return;
  db.transaction((tx) => {
    if (params.collectionId != null) {
      const existingCollection = tx
        .select({ id: appCollections.id })
        .from(appCollections)
        .where(eq(appCollections.id, params.collectionId))
        .get();
      if (!existingCollection) {
        throw new DyadError("Collection not found", DyadErrorKind.NotFound);
      }
    }
    tx.update(apps)
      .set({ collectionId: params.collectionId })
      .where(inArray(apps.id, params.appIds))
      .run();
  });
}

async function copyPath(
  source: string,
  destination: string,
  options: { excludeNodeModules?: boolean; excludeGit?: boolean } = {},
): Promise<void> {
  const stat = await fs.promises.stat(source);
  if (stat.isFile()) {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.copyFile(source, destination);
    return;
  }

  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (options.excludeNodeModules && entry.name === "node_modules") continue;
    if (options.excludeGit && entry.name === ".git") continue;
    await copyPath(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      options,
    );
  }
}

function toPromptDto(row: typeof prompts.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isDirectoryAccessible(directory: string): boolean {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

async function runGit(appPath: string, args: string[]): Promise<void> {
  const result = await runCommand("git", args, appPath);
  if (result.code !== 0) {
    throw new DyadError(
      `Git command failed: git ${args.join(" ")}. ${result.stderr || result.stdout}`,
      DyadErrorKind.External,
    );
  }
}

async function getCurrentCommitHash(appPath: string): Promise<string | null> {
  if (!fs.existsSync(path.join(appPath, ".git"))) {
    return null;
  }
  const result = await runCommand("git", ["rev-parse", "HEAD"], appPath);
  return result.code === 0 ? result.stdout.trim() : null;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
    proc.on("error", reject);
  });
}

function isUniqueNameError(error: unknown, constraint: string): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message.includes(`UNIQUE constraint failed: ${constraint}`);
}
