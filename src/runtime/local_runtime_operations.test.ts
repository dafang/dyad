import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { InMemoryLocalOperationAuditLog } from "@/server/local_operation_audit";
import { LocalRuntimeOperations } from "./local_runtime_operations";
import { LocalRuntimeProvider } from "./local_runtime_provider";
import type { RuntimeProvider } from "./runtime_provider";

describe("LocalRuntimeOperations", () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let provider: LocalRuntimeProvider;
  let auditLog: InMemoryLocalOperationAuditLog;
  let operations: LocalRuntimeOperations;
  let id: number;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-ops-"));
    workspaceRoot = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceRoot);
    provider = new LocalRuntimeProvider({
      allowedWorkspaceRoots: [tempRoot],
      allowedCommands: ["node"],
      defaultTimeoutMs: 2_000,
      defaultMaxOutputBytes: 128,
    });
    id = 0;
    auditLog = new InMemoryLocalOperationAuditLog({
      createId: () => `operation-${++id}`,
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });
    operations = new LocalRuntimeOperations({ provider, auditLog });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reads a workspace file as a read-only audited operation", async () => {
    await fs.writeFile(path.join(workspaceRoot, "notes.txt"), "hello");

    const result = await operations.readFile({
      workspaceRoot,
      relativePath: "notes.txt",
      consent: "ask",
    });

    expect(result.result).toBe("hello");
    expect(result.operationId).toBe("operation-1");
    expect(result.auditRecord).toMatchObject({
      id: "operation-1",
      type: "read-file",
      target: "notes.txt",
      modifiesState: false,
      decision: "allowed",
      outcome: "success",
    });
  });

  it("writes a workspace file when consent allows state changes", async () => {
    const result = await operations.writeFile({
      workspaceRoot,
      relativePath: "src/App.tsx",
      content: "export const App = () => null;\n",
      consent: "ask",
      consentResponse: "accept-once",
    });

    await expect(
      fs.readFile(path.join(workspaceRoot, "src/App.tsx"), "utf8"),
    ).resolves.toBe("export const App = () => null;\n");
    expect(result.auditRecord).toEqual({
      id: "operation-1",
      type: "write-file",
      target: "src/App.tsx",
      modifiesState: true,
      decision: "allowed",
      timestamp: "2026-06-11T00:00:00.000Z",
      outcome: "success",
    });
  });

  it("denies a write before resolving paths or touching files", async () => {
    const mockProvider: RuntimeProvider = {
      resolveWorkspacePath: vi.fn(async () => {
        throw new Error("resolveWorkspacePath should not run");
      }),
      runCommand: vi.fn(async () => {
        throw new Error("runCommand should not run");
      }),
    };
    const deniedAuditLog = new InMemoryLocalOperationAuditLog({
      createId: () => "operation-denied",
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });
    const deniedOperations = new LocalRuntimeOperations({
      provider: mockProvider,
      auditLog: deniedAuditLog,
    });

    await expect(
      deniedOperations.writeFile({
        workspaceRoot,
        relativePath: "denied.txt",
        content: "no side effects",
        consent: "ask",
        consentResponse: "decline",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
      message: "operation declined",
    });

    expect(mockProvider.resolveWorkspacePath).not.toHaveBeenCalled();
    expect(mockProvider.runCommand).not.toHaveBeenCalled();
    await expect(
      fs.access(path.join(workspaceRoot, "denied.txt")),
    ).rejects.toThrow();
    expect(deniedAuditLog.list()).toEqual([
      {
        id: "operation-denied",
        type: "write-file",
        target: "denied.txt",
        modifiesState: true,
        decision: "denied",
        timestamp: "2026-06-11T00:00:00.000Z",
        outcome: "skipped",
        error: "operation declined",
      },
    ]);
  });

  it("audits path escape failures from the runtime provider", async () => {
    await expect(
      operations.readFile({
        workspaceRoot,
        relativePath: "../outside.txt",
      }),
    ).rejects.toThrow("escapes the workspace");

    expect(auditLog.list()).toEqual([
      {
        id: "operation-1",
        type: "read-file",
        target: "../outside.txt",
        modifiesState: false,
        decision: "allowed",
        timestamp: "2026-06-11T00:00:00.000Z",
        outcome: "failure",
        error: "Resolved path escapes the workspace root",
      },
    ]);
  });

  it("runs allowed command output reads through the runtime provider", async () => {
    const result = await operations.readCommandOutput({
      workspaceRoot,
      command: "node",
      args: ["-e", "process.stdout.write('ready')"],
    });

    expect(result.result).toMatchObject({
      exitCode: 0,
      stdout: "ready",
      stderr: "",
      timedOut: false,
    });
    expect(auditLog.list()).toEqual([
      {
        id: "operation-1",
        type: "read-command-output",
        target: "node -e process.stdout.write('ready')",
        modifiesState: false,
        decision: "allowed",
        timestamp: "2026-06-11T00:00:00.000Z",
        outcome: "success",
      },
    ]);
  });

  it("audits command allowlist rejection from the runtime provider", async () => {
    await expect(
      operations.readCommandOutput({
        workspaceRoot,
        command: "sh",
        args: ["-c", "echo unsafe"],
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: "Command is not allowed: sh",
    });

    expect(auditLog.list()).toEqual([
      {
        id: "operation-1",
        type: "read-command-output",
        target: "sh -c echo unsafe",
        modifiesState: false,
        decision: "allowed",
        timestamp: "2026-06-11T00:00:00.000Z",
        outcome: "failure",
        error: "Command is not allowed: sh",
      },
    ]);
  });

  it("denies typecheck before spawning when read-only guards require it", async () => {
    const mockProvider: RuntimeProvider = {
      resolveWorkspacePath: vi.fn(),
      runCommand: vi.fn(),
    };
    const deniedAuditLog = new InMemoryLocalOperationAuditLog({
      createId: () => "operation-read-only",
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });
    const deniedOperations = new LocalRuntimeOperations({
      provider: mockProvider,
      auditLog: deniedAuditLog,
    });

    await expect(
      deniedOperations.runTypecheck({
        workspaceRoot,
        consent: "never",
      }),
    ).rejects.toBeInstanceOf(DyadError);

    expect(mockProvider.runCommand).not.toHaveBeenCalled();
    expect(deniedAuditLog.list()).toEqual([
      {
        id: "operation-read-only",
        type: "run-command",
        target: "npm run ts",
        modifiesState: true,
        decision: "denied",
        timestamp: "2026-06-11T00:00:00.000Z",
        outcome: "skipped",
        error: "operation consent is never",
      },
    ]);
  });
});
