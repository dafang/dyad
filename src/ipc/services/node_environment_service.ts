import { execSync } from "node:child_process";
import { platform } from "node:os";

import log from "electron-log";
import fixPath from "fix-path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getCommandExecutionDisplayDetails,
  getPackageManagerCommandEnv,
  PNPM_GLOBAL_INSTALL_PACKAGE,
  runCommand,
  type CommandExecutionResult,
} from "@/ipc/utils/socket_firewall";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import type { InstallPnpmResult } from "@/ipc/types/system";

const logger = log.scope("node_environment_service");
const BRAILLE_SPINNER_PATTERN = /^[\u2800-\u28ff]+$/u;

type NodePathSettings = {
  customNodePath?: string | null;
};

type CommandRunner = (
  command: string,
  args: string[],
  options?: Parameters<typeof runCommand>[2],
) => Promise<CommandExecutionResult>;

export function reloadNodePath(
  readSettings: () => NodePathSettings = () => ({}),
): void {
  if (platform() === "win32") {
    const newPath = execSync("cmd /c echo %PATH%", {
      encoding: "utf8",
    }).trim();
    process.env.PATH = newPath;
  } else {
    fixPath();
  }

  const settings = readSettings();
  if (settings.customNodePath) {
    const separator = platform() === "win32" ? ";" : ":";
    process.env.PATH = `${settings.customNodePath}${separator}${process.env.PATH}`;
    logger.debug("Added custom Node.js path to PATH:", settings.customNodePath);
  }
}

export function formatInstallPnpmFailureReason(error: unknown): string {
  const details = getCommandExecutionDisplayDetails(error);
  const message = error instanceof Error ? error.message : String(error);
  const detailLines = (details ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line && !BRAILLE_SPINNER_PATTERN.test(line) && /[a-z0-9]/iu.test(line),
    );
  const reason = (detailLines.at(-1) || message).trim();

  if (!reason) {
    return "the install command failed";
  }

  return reason;
}

export async function installPnpm({
  readSettings = () => ({}),
  runner = runCommand,
  isTestBuild = IS_TEST_BUILD,
  env = process.env,
  reloadPath = () => reloadNodePath(readSettings),
}: {
  readSettings?: () => NodePathSettings;
  runner?: CommandRunner;
  isTestBuild?: boolean;
  env?: NodeJS.ProcessEnv;
  reloadPath?: () => void;
} = {}): Promise<InstallPnpmResult> {
  try {
    const testInstallPnpmVersion = isTestBuild
      ? env.DYAD_TEST_INSTALL_PNPM_VERSION
      : undefined;
    if (testInstallPnpmVersion) {
      env.DYAD_TEST_PNPM_VERSION = testInstallPnpmVersion;
      reloadPath();
      return { pnpmVersion: testInstallPnpmVersion };
    }

    // Use --force in case pnpm is already installed, but the user wants to upgrade.
    await runner(
      "npm",
      ["install", "-g", "--force", PNPM_GLOBAL_INSTALL_PACKAGE],
      {
        env: getPackageManagerCommandEnv(),
      },
    );
    reloadPath();

    const result = await runner("pnpm", ["--version"], {
      env: getPackageManagerCommandEnv(),
    });
    const pnpmVersion = result.stdout.trim();
    if (!pnpmVersion) {
      throw new Error("pnpm installed, but its version could not be verified");
    }

    return { pnpmVersion };
  } catch (error) {
    logger.error("Failed to install pnpm:", error);
    const details = getCommandExecutionDisplayDetails(error);
    if (details) {
      logger.error("pnpm install command output:", details);
    }

    const reason = formatInstallPnpmFailureReason(error);
    throw new DyadError(
      `Could not install pnpm because of ${reason}`,
      DyadErrorKind.Precondition,
    );
  }
}
