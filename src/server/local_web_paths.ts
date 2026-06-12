import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LocalWebSettingsStore } from "./local_web_settings";

export interface LocalWebPathResolver {
  readonly userDataPath: string;
  readonly defaultAppsDirectory: string;
  getDyadAppsBaseDirectory(): string;
  getDyadAppPath(appPath: string): string;
  getDatabasePath(): string;
  getTypeScriptCachePath(): string;
}

export interface LocalWebPathResolverOptions {
  userDataPath: string;
  settingsStore: LocalWebSettingsStore;
}

export function createLocalWebPathResolver(
  options: LocalWebPathResolverOptions,
): LocalWebPathResolver {
  const defaultAppsDirectory = path.join(options.userDataPath, "dyad-apps");
  return {
    userDataPath: options.userDataPath,
    defaultAppsDirectory,
    getDyadAppsBaseDirectory() {
      const customAppsFolder =
        options.settingsStore.readSettings().customAppsFolder;
      const baseDirectory = customAppsFolder ?? defaultAppsDirectory;
      fs.mkdirSync(baseDirectory, { recursive: true });
      return baseDirectory;
    },
    getDyadAppPath(appPath: string) {
      if (path.isAbsolute(appPath)) {
        return appPath;
      }
      return path.join(this.getDyadAppsBaseDirectory(), appPath);
    },
    getDatabasePath() {
      return path.join(options.userDataPath, "sqlite.db");
    },
    getTypeScriptCachePath() {
      return path.join(options.userDataPath, "typescript-cache");
    },
  };
}

export function getDefaultLocalWebUserDataPath(): string {
  return path.join(os.homedir(), ".dyad", "local-web");
}
