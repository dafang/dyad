import crypto from "node:crypto";

export type LocalOperationType =
  | "read-file"
  | "write-file"
  | "run-command"
  | "read-command-output";

export type LocalOperationDecision = "allowed" | "denied";
export type LocalOperationOutcome = "success" | "failure" | "skipped";

export interface LocalOperationAuditEntry {
  type: LocalOperationType;
  target: string;
  modifiesState: boolean;
  decision: LocalOperationDecision;
  outcome: LocalOperationOutcome;
  error?: string;
}

export interface LocalOperationAuditRecord extends LocalOperationAuditEntry {
  id: string;
  timestamp: string;
}

export interface LocalOperationAuditLog {
  record(entry: LocalOperationAuditEntry): LocalOperationAuditRecord;
  list(): readonly LocalOperationAuditRecord[];
  get(id: string): LocalOperationAuditRecord | undefined;
  clear(): void;
}

export interface InMemoryLocalOperationAuditLogOptions {
  createId?: () => string;
  now?: () => Date;
}

export class InMemoryLocalOperationAuditLog implements LocalOperationAuditLog {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly records: LocalOperationAuditRecord[] = [];

  constructor(options: InMemoryLocalOperationAuditLogOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  record(entry: LocalOperationAuditEntry): LocalOperationAuditRecord {
    const record: LocalOperationAuditRecord = {
      ...entry,
      id: this.createId(),
      timestamp: this.now().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  list(): readonly LocalOperationAuditRecord[] {
    return [...this.records];
  }

  get(id: string): LocalOperationAuditRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  clear(): void {
    this.records.length = 0;
  }
}

export type LocalOperationConsent = "always" | "ask" | "never";
export type LocalOperationConsentResponse =
  | "accept-once"
  | "accept-always"
  | "decline";

export interface ResolveLocalOperationConsentInput {
  modifiesState: boolean;
  consent?: LocalOperationConsent;
  response?: LocalOperationConsentResponse;
  readOnly?: boolean;
  planModeOnly?: boolean;
}

export interface LocalOperationConsentResolution {
  decision: LocalOperationDecision;
  reason: string;
  persistConsent?: LocalOperationConsent;
}

export function resolveLocalOperationConsent(
  input: ResolveLocalOperationConsentInput,
): LocalOperationConsentResolution {
  const consent = input.consent ?? (input.modifiesState ? "ask" : "always");

  if (consent === "never") {
    return {
      decision: "denied",
      reason: "operation consent is never",
    };
  }

  if (input.modifiesState && input.readOnly) {
    return {
      decision: "denied",
      reason: "state-changing operation is blocked in read-only mode",
    };
  }

  if (input.modifiesState && input.planModeOnly) {
    return {
      decision: "denied",
      reason: "state-changing operation is blocked in plan-only mode",
    };
  }

  if (!input.modifiesState) {
    return {
      decision: "allowed",
      reason: "read-only operation",
    };
  }

  if (consent === "always") {
    return {
      decision: "allowed",
      reason: "operation consent is always",
    };
  }

  if (input.response === "accept-once") {
    return {
      decision: "allowed",
      reason: "operation accepted once",
    };
  }

  if (input.response === "accept-always") {
    return {
      decision: "allowed",
      reason: "operation accepted always",
      persistConsent: "always",
    };
  }

  if (input.response === "decline") {
    return {
      decision: "denied",
      reason: "operation declined",
    };
  }

  return {
    decision: "denied",
    reason: "operation requires approval",
  };
}
