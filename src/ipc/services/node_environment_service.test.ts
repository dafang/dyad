import { describe, expect, it, vi } from "vitest";

import { CommandExecutionError } from "@/ipc/utils/socket_firewall";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  formatInstallPnpmFailureReason,
  installPnpm,
} from "./node_environment_service";

describe("node environment service", () => {
  it("installs pnpm globally and verifies the installed version", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "installed\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: "11.1.2\n", stderr: "" });
    const reloadPath = vi.fn();

    await expect(
      installPnpm({
        runner,
        reloadPath,
      }),
    ).resolves.toEqual({ pnpmVersion: "11.1.2" });

    expect(runner).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "-g", "--force", "pnpm@latest-11"],
      expect.objectContaining({ env: expect.any(Object) }),
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["--version"],
      expect.objectContaining({ env: expect.any(Object) }),
    );
    expect(reloadPath).toHaveBeenCalledOnce();
  });

  it("uses test install version without running package manager commands", async () => {
    const env: NodeJS.ProcessEnv = {
      DYAD_TEST_INSTALL_PNPM_VERSION: "11.2.0",
    };
    const runner = vi.fn();
    const reloadPath = vi.fn();

    await expect(
      installPnpm({
        env,
        isTestBuild: true,
        runner,
        reloadPath,
      }),
    ).resolves.toEqual({ pnpmVersion: "11.2.0" });

    expect(env.DYAD_TEST_PNPM_VERSION).toBe("11.2.0");
    expect(runner).not.toHaveBeenCalled();
    expect(reloadPath).toHaveBeenCalledOnce();
  });

  it("classifies install failures as preconditions with command details", async () => {
    const runner = vi.fn(async () => {
      throw new CommandExecutionError({
        message: "npm failed",
        stdout: "⠋\npermission denied\n",
        exitCode: 1,
      });
    });

    await expect(
      installPnpm({
        runner,
        reloadPath: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Precondition,
      message: "Could not install pnpm because of permission denied",
    } satisfies Partial<DyadError>);
  });

  it("formats empty install failure details with a stable fallback", () => {
    expect(formatInstallPnpmFailureReason(new Error(""))).toBe(
      "the install command failed",
    );
  });
});
