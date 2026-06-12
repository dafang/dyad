import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalRuntimeProvider } from "./local_runtime_provider";

describe("LocalRuntimeProvider", () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let provider: LocalRuntimeProvider;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-runtime-"));
    workspaceRoot = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceRoot);
    provider = new LocalRuntimeProvider({
      allowedWorkspaceRoots: [tempRoot],
      allowedCommands: ["node"],
      defaultTimeoutMs: 2_000,
      maxOutputBytes: 256,
      defaultMaxOutputBytes: 128,
    });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves paths inside an allowed workspace", async () => {
    await expect(
      provider.resolveWorkspacePath({
        workspaceRoot,
        relativePath: "src/index.ts",
      }),
    ).resolves.toBe(path.join(workspaceRoot, "src/index.ts"));
  });

  it("rejects paths that escape the workspace", async () => {
    await expect(
      provider.resolveWorkspacePath({
        workspaceRoot,
        relativePath: "../outside.txt",
      }),
    ).rejects.toThrow("escapes the workspace");
  });

  it("rejects symlinks that escape the workspace", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-outside-"));
    try {
      await fs.symlink(outside, path.join(workspaceRoot, "linked-outside"));

      await expect(
        provider.resolveWorkspacePath({
          workspaceRoot,
          relativePath: "linked-outside/file.txt",
        }),
      ).rejects.toThrow("escapes the workspace");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects workspace roots outside configured bounds", async () => {
    await expect(
      provider.resolveWorkspacePath({
        workspaceRoot: os.tmpdir(),
        relativePath: "file.txt",
      }),
    ).rejects.toThrow("outside allowed roots");
  });

  it("rejects commands outside the allowlist", async () => {
    await expect(
      provider.runCommand({
        workspaceRoot,
        command: "sh",
        args: ["-c", "echo unsafe"],
      }),
    ).rejects.toThrow("Command is not allowed");
  });

  it("runs allowed commands without a shell and captures bounded output", async () => {
    const result = await provider.runCommand({
      workspaceRoot,
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(300))"],
      maxOutputBytes: 64,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(64);
    expect(result.timedOut).toBe(false);
  });
});
