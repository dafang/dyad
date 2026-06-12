import fs from "node:fs/promises";
import path from "node:path";

import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import {
  resolveLocalOperationConsent,
  type LocalOperationAuditLog,
  type LocalOperationAuditRecord,
  type LocalOperationConsent,
  type LocalOperationConsentResponse,
  type LocalOperationType,
} from "@/server/local_operation_audit";
import type {
  RunCommandInput,
  RunCommandResult,
  RuntimeProvider,
} from "./runtime_provider";

export interface LocalRuntimeOperationContext {
  workspaceRoot: string;
  consent?: LocalOperationConsent;
  consentResponse?: LocalOperationConsentResponse;
  readOnly?: boolean;
  planModeOnly?: boolean;
}

export interface LocalRuntimeReadFileInput extends LocalRuntimeOperationContext {
  relativePath: string;
  encoding?: BufferEncoding;
}

export interface LocalRuntimeWriteFileInput extends LocalRuntimeOperationContext {
  relativePath: string;
  content: string;
  encoding?: BufferEncoding;
}

export interface LocalRuntimeRunTypecheckInput extends LocalRuntimeOperationContext {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface LocalRuntimeReadCommandOutputInput extends LocalRuntimeOperationContext {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface LocalRuntimeOperationResult<T> {
  operationId: string;
  auditRecord: LocalOperationAuditRecord;
  result: T;
}

export interface LocalRuntimeOperationsOptions {
  provider: RuntimeProvider;
  auditLog: LocalOperationAuditLog;
}

export class LocalRuntimeOperations {
  private readonly provider: RuntimeProvider;
  private readonly auditLog: LocalOperationAuditLog;

  constructor(options: LocalRuntimeOperationsOptions) {
    this.provider = options.provider;
    this.auditLog = options.auditLog;
  }

  async readFile(
    input: LocalRuntimeReadFileInput,
  ): Promise<LocalRuntimeOperationResult<string>> {
    return this.runAuditedOperation({
      type: "read-file",
      target: input.relativePath,
      modifiesState: false,
      consent: input.consent,
      consentResponse: input.consentResponse,
      readOnly: input.readOnly,
      planModeOnly: input.planModeOnly,
      run: async () => {
        const resolvedPath = await this.provider.resolveWorkspacePath({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
        return fs.readFile(resolvedPath, input.encoding ?? "utf8");
      },
    });
  }

  async writeFile(
    input: LocalRuntimeWriteFileInput,
  ): Promise<LocalRuntimeOperationResult<void>> {
    return this.runAuditedOperation({
      type: "write-file",
      target: input.relativePath,
      modifiesState: true,
      consent: input.consent,
      consentResponse: input.consentResponse,
      readOnly: input.readOnly,
      planModeOnly: input.planModeOnly,
      run: async () => {
        const resolvedPath = await this.provider.resolveWorkspacePath({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, input.content, {
          encoding: input.encoding ?? "utf8",
        });
      },
    });
  }

  async runTypecheck(
    input: LocalRuntimeRunTypecheckInput,
  ): Promise<LocalRuntimeOperationResult<RunCommandResult>> {
    return this.runCommandOperation({
      ...input,
      command: "npm",
      args: ["run", "ts"],
      type: "run-command",
      target: "npm run ts",
      modifiesState: true,
    });
  }

  async readCommandOutput(
    input: LocalRuntimeReadCommandOutputInput,
  ): Promise<LocalRuntimeOperationResult<RunCommandResult>> {
    return this.runCommandOperation({
      ...input,
      type: "read-command-output",
      target: [input.command, ...(input.args ?? [])].join(" "),
      modifiesState: false,
    });
  }

  private async runCommandOperation(
    input: LocalRuntimeReadCommandOutputInput & {
      type: LocalOperationType;
      target: string;
      modifiesState: boolean;
    },
  ): Promise<LocalRuntimeOperationResult<RunCommandResult>> {
    return this.runAuditedOperation({
      type: input.type,
      target: input.target,
      modifiesState: input.modifiesState,
      consent: input.consent,
      consentResponse: input.consentResponse,
      readOnly: input.readOnly,
      planModeOnly: input.planModeOnly,
      run: () =>
        this.provider.runCommand({
          workspaceRoot: input.workspaceRoot,
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
        } satisfies RunCommandInput),
    });
  }

  private async runAuditedOperation<T>(input: {
    type: LocalOperationType;
    target: string;
    modifiesState: boolean;
    consent?: LocalOperationConsent;
    consentResponse?: LocalOperationConsentResponse;
    readOnly?: boolean;
    planModeOnly?: boolean;
    run: () => Promise<T>;
  }): Promise<LocalRuntimeOperationResult<T>> {
    const resolution = resolveLocalOperationConsent({
      modifiesState: input.modifiesState,
      consent: input.consent,
      response: input.consentResponse,
      readOnly: input.readOnly,
      planModeOnly: input.planModeOnly,
    });

    if (resolution.decision === "denied") {
      this.auditLog.record({
        type: input.type,
        target: input.target,
        modifiesState: input.modifiesState,
        decision: "denied",
        outcome: "skipped",
        error: resolution.reason,
      });
      throw new DyadError(resolution.reason, DyadErrorKind.UserCancelled);
    }

    try {
      const result = await input.run();
      const auditRecord = this.auditLog.record({
        type: input.type,
        target: input.target,
        modifiesState: input.modifiesState,
        decision: "allowed",
        outcome: "success",
      });
      return {
        operationId: auditRecord.id,
        auditRecord,
        result,
      };
    } catch (error) {
      this.auditLog.record({
        type: input.type,
        target: input.target,
        modifiesState: input.modifiesState,
        decision: "allowed",
        outcome: "failure",
        error: getErrorMessage(error),
      });
      if (isDyadError(error)) {
        throw error;
      }
      throw new DyadError(
        "Local runtime operation failed",
        DyadErrorKind.External,
        {
          cause: error,
        },
      );
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
