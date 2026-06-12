import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  ResolveWorkspacePathInput,
  RunCommandInput,
  RunCommandResult,
  RuntimeProvider,
} from "./runtime_provider";

export interface LocalRuntimeProviderOptions {
  allowedWorkspaceRoots: readonly string[];
  allowedCommands?: readonly string[];
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  defaultMaxOutputBytes?: number;
  maxOutputBytes?: number;
}

export class LocalRuntimeProvider implements RuntimeProvider {
  private readonly allowedWorkspaceRoots: readonly string[];
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly defaultMaxOutputBytes: number;
  private readonly maxOutputBytes: number;

  constructor(options: LocalRuntimeProviderOptions) {
    if (options.allowedWorkspaceRoots.length === 0) {
      throw new DyadError(
        "At least one workspace root is required",
        DyadErrorKind.Validation,
      );
    }

    this.allowedWorkspaceRoots = options.allowedWorkspaceRoots.map((root) =>
      path.resolve(root),
    );
    this.allowedCommands = new Set(
      options.allowedCommands ?? ["npm", "node", "git"],
    );
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.maxTimeoutMs = options.maxTimeoutMs ?? 120_000;
    this.defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? 128 * 1024;
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  }

  async resolveWorkspacePath(
    input: ResolveWorkspacePathInput,
  ): Promise<string> {
    return this.resolveWithinAllowedRoot(
      input.workspaceRoot,
      input.relativePath ?? ".",
    );
  }

  async runCommand(input: RunCommandInput): Promise<RunCommandResult> {
    if (!this.allowedCommands.has(input.command)) {
      throw new DyadError(
        `Command is not allowed: ${input.command}`,
        DyadErrorKind.Precondition,
      );
    }

    const cwd = await this.resolveWithinAllowedRoot(
      input.workspaceRoot,
      input.cwd ?? ".",
    );
    const timeoutMs = clampPositiveInteger(
      input.timeoutMs ?? this.defaultTimeoutMs,
      this.maxTimeoutMs,
      "timeoutMs",
    );
    const outputLimit = clampPositiveInteger(
      input.maxOutputBytes ?? this.defaultMaxOutputBytes,
      this.maxOutputBytes,
      "maxOutputBytes",
    );

    return runBoundedProcess({
      command: input.command,
      args: input.args ?? [],
      cwd,
      timeoutMs,
      outputLimit,
    });
  }

  private async resolveWithinAllowedRoot(
    workspaceRoot: string,
    relativePath: string,
  ): Promise<string> {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    if (
      !this.allowedWorkspaceRoots.some((allowedRoot) =>
        isPathInside(resolvedWorkspaceRoot, allowedRoot),
      )
    ) {
      throw new DyadError(
        "Workspace root is outside allowed roots",
        DyadErrorKind.Precondition,
      );
    }

    const resolvedPath = path.resolve(resolvedWorkspaceRoot, relativePath);
    if (!isPathInside(resolvedPath, resolvedWorkspaceRoot)) {
      throw new DyadError(
        "Resolved path escapes the workspace root",
        DyadErrorKind.Precondition,
      );
    }

    const realWorkspaceRoot = await realpathForExistingPath(
      resolvedWorkspaceRoot,
    );
    const realAllowedWorkspaceRoots = await Promise.all(
      this.allowedWorkspaceRoots.map((allowedRoot) =>
        realpathForExistingPath(allowedRoot),
      ),
    );
    if (
      !realAllowedWorkspaceRoots.some((allowedRoot) =>
        isPathInside(realWorkspaceRoot, allowedRoot),
      )
    ) {
      throw new DyadError(
        "Workspace root is outside allowed roots",
        DyadErrorKind.Precondition,
      );
    }

    const realResolvedPath = await realpathForExistingPath(resolvedPath);
    if (!isPathInside(realResolvedPath, realWorkspaceRoot)) {
      throw new DyadError(
        "Resolved path escapes the workspace root",
        DyadErrorKind.Precondition,
      );
    }

    return resolvedPath;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function clampPositiveInteger(
  value: number,
  max: number,
  fieldName: string,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DyadError(
      `${fieldName} must be a positive integer`,
      DyadErrorKind.Validation,
    );
  }
  return Math.min(value, max);
}

async function realpathForExistingPath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const parent = path.dirname(candidate);
  if (parent === candidate) {
    throw new DyadError(
      "Workspace path does not exist",
      DyadErrorKind.Precondition,
    );
  }

  const realParent = await realpathForExistingPath(parent);
  return path.join(realParent, path.basename(candidate));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function runBoundedProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  outputLimit: number;
}): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputBytes = 0;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new DyadError("Failed to start command", DyadErrorKind.External, {
          cause: error,
        }),
      );
    });

    collectOutput(child, "stdout", (chunk) => {
      const collected = appendBoundedOutput(
        stdout,
        chunk,
        outputBytes,
        options.outputLimit,
      );
      stdout = collected.value;
      outputBytes = collected.totalBytes;
    });
    collectOutput(child, "stderr", (chunk) => {
      const collected = appendBoundedOutput(
        stderr,
        chunk,
        outputBytes,
        options.outputLimit,
      );
      stderr = collected.value;
      outputBytes = collected.totalBytes;
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function collectOutput(
  child: ChildProcessWithoutNullStreams,
  stream: "stdout" | "stderr",
  onChunk: (chunk: Buffer) => void,
): void {
  child[stream].on("data", (chunk: Buffer | string) => {
    onChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
}

function appendBoundedOutput(
  current: string,
  chunk: Buffer,
  currentTotalBytes: number,
  maxBytes: number,
): { value: string; totalBytes: number } {
  if (currentTotalBytes >= maxBytes) {
    return { value: current, totalBytes: currentTotalBytes + chunk.byteLength };
  }

  const availableBytes = maxBytes - currentTotalBytes;
  const slice = chunk.subarray(0, availableBytes);
  return {
    value: current + slice.toString("utf8"),
    totalBytes: currentTotalBytes + chunk.byteLength,
  };
}
