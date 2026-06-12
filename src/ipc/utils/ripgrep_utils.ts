/**
 * Shared utilities for ripgrep integration
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { getElectronModule } from "./electron_module";

export const MAX_FILE_SEARCH_SIZE = 1024 * 1024;
export const RIPGREP_EXCLUDED_GLOBS = [
  "!node_modules/**",
  "!.git/**",
  "!.next/**",
];

/**
 * Get the path to the ripgrep executable.
 * Handles both development and packaged Electron app scenarios.
 */
export function getRgExecutablePath(): string {
  const isWindows = os.platform() === "win32";
  const executableName = isWindows ? "rg.exe" : "rg";
  const app = getElectronApp();
  if (!app?.isPackaged) {
    // Dev: app.getAppPath() is the project root (same pattern as dugite).
    // Some local installs skip @vscode/ripgrep's postinstall scripts, leaving
    // the package present but without bin/rg. Fall back to PATH in that case.
    return firstExistingPath(
      app?.getAppPath() ?? process.cwd(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      executableName,
    );
  }
  // Packaged app: ripgrep is bundled via extraResource
  // Since we extract "node_modules/@vscode/ripgrep", it's at resources/@vscode/ripgrep
  return firstExistingPath(
    process.resourcesPath,
    "@vscode",
    "ripgrep",
    "bin",
    executableName,
  );
}

function firstExistingPath(...segments: string[]): string {
  const candidate = path.join(...segments);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return os.platform() === "win32" ? "rg.exe" : "rg";
}

function getElectronApp(): typeof import("electron").app | null {
  try {
    if (!process.versions.electron) {
      return null;
    }
    return getElectronModule<typeof import("electron")>()?.app ?? null;
  } catch {
    return null;
  }
}
