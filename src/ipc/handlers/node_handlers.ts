import { dialog, ipcMain } from "electron";
import { platform, arch } from "os";
import { runShellCommand } from "../utils/runShellCommand";
import log from "electron-log";
import { existsSync } from "fs";
import { join } from "path";
import { readSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { IS_TEST_BUILD } from "../utils/test_utils";
import {
  getPackageManagerCommandEnv,
  PNPM_GLOBAL_INSTALL_PACKAGE,
} from "@/ipc/utils/socket_firewall";
import {
  installPnpm,
  reloadNodePath,
} from "@/ipc/services/node_environment_service";

const logger = log.scope("node_handlers");

// Test-only: Mock state for Node.js installation status
// null = use real check, true = mock as installed, false = mock as not installed
let mockNodeInstalled: boolean | null = null;

function getNodeDownloadUrl(): string {
  // In E2E test mode, return a placeholder URL to avoid actual Node.js downloads.
  // This URL is never actually fetched since open-external-url is also skipped in test mode.
  if (IS_TEST_BUILD) {
    return "https://example.com/fake-node-installer.pkg";
  }

  // Default to mac download url.
  let nodeDownloadUrl = "https://nodejs.org/dist/v22.22.3/node-v22.22.3.pkg";
  if (platform() == "win32") {
    if (arch() === "arm64" || arch() === "arm") {
      nodeDownloadUrl =
        "https://nodejs.org/dist/v22.22.3/node-v22.22.3-arm64.msi";
    } else {
      // x64 is the most common architecture for Windows so it's the
      // default download url.
      nodeDownloadUrl =
        "https://nodejs.org/dist/v22.22.3/node-v22.22.3-x64.msi";
    }
  }
  return nodeDownloadUrl;
}

export function registerNodeHandlers() {
  // Test-only handler to control Node.js mock state
  // Guarded by IS_TEST_BUILD constant
  if (IS_TEST_BUILD) {
    ipcMain.handle(
      "test:set-node-mock",
      async (_, { installed }: { installed: boolean | null }) => {
        logger.log("test:set-node-mock called with installed:", installed);
        mockNodeInstalled = installed;
      },
    );
  }

  createTypedHandler(systemContracts.getNodejsStatus, async () => {
    logger.log(
      "handling ipc: nodejs-status for platform:",
      platform(),
      "and arch:",
      arch(),
    );

    const nodeDownloadUrl = getNodeDownloadUrl();

    // Test-only: Return mock state if set
    if (IS_TEST_BUILD && mockNodeInstalled !== null) {
      logger.log("Using mock Node.js status:", mockNodeInstalled);
      if (mockNodeInstalled) {
        return {
          nodeVersion: "v22.22.3",
          pnpmVersion: "9.0.0",
          nodeDownloadUrl,
        };
      }
      return { nodeVersion: null, pnpmVersion: null, nodeDownloadUrl };
    }

    // Run checks in parallel
    const [nodeVersion, pnpmVersion] = await Promise.all([
      runShellCommand("node --version"),
      // First, check if pnpm is installed.
      // If not, try to install it using corepack.
      // If both fail, then pnpm is not available.
      runShellCommand(
        `pnpm --version || (corepack enable pnpm && pnpm --version) || (npm install -g ${PNPM_GLOBAL_INSTALL_PACKAGE} && pnpm --version)`,
        { env: getPackageManagerCommandEnv() },
      ),
    ]);
    return { nodeVersion, pnpmVersion, nodeDownloadUrl };
  });

  createTypedHandler(systemContracts.installPnpm, async () => {
    return installPnpm({ readSettings });
  });

  createTypedHandler(systemContracts.reloadEnvPath, async () => {
    logger.debug("Reloading env path, previously:", process.env.PATH);
    reloadNodePath(readSettings);
    logger.debug("Reloaded env path, now:", process.env.PATH);
  });

  createTypedHandler(systemContracts.selectNodeFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Node.js Installation Folder",
      properties: ["openDirectory"],
      message: "Select the folder where Node.js is installed",
    });

    if (result.canceled) {
      return { path: null, canceled: true, selectedPath: null };
    }

    if (!result.filePaths[0]) {
      return { path: null, canceled: false, selectedPath: null };
    }

    const selectedPath = result.filePaths[0];

    // Verify Node.js exists in selected path
    const nodeBinary = platform() === "win32" ? "node.exe" : "node";
    const nodePath = join(selectedPath, nodeBinary);

    if (!existsSync(nodePath)) {
      // Check bin subdirectory (common on Unix systems)
      const binPath = join(selectedPath, "bin", nodeBinary);
      if (existsSync(binPath)) {
        return {
          path: join(selectedPath, "bin"),
          canceled: false,
          selectedPath,
        };
      }
      return { path: null, canceled: false, selectedPath };
    }
    return { path: selectedPath, canceled: false, selectedPath };
  });
}
