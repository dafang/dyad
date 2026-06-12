import { describe, expect, it } from "vitest";

import {
  InMemoryLocalOperationAuditLog,
  resolveLocalOperationConsent,
} from "./local_operation_audit";

describe("local operation audit", () => {
  it("records operation id, type, target, decision, timestamp, and outcome", () => {
    let id = 0;
    const auditLog = new InMemoryLocalOperationAuditLog({
      createId: () => `operation-${++id}`,
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });

    const record = auditLog.record({
      type: "write-file",
      target: "src/App.tsx",
      modifiesState: true,
      decision: "allowed",
      outcome: "success",
    });

    expect(record).toEqual({
      id: "operation-1",
      type: "write-file",
      target: "src/App.tsx",
      modifiesState: true,
      decision: "allowed",
      timestamp: "2026-06-11T00:00:00.000Z",
      outcome: "success",
    });
    expect(auditLog.get("operation-1")).toEqual(record);
    expect(auditLog.list()).toEqual([record]);
  });

  it("returns defensive copies from list", () => {
    const auditLog = new InMemoryLocalOperationAuditLog({
      createId: () => "operation-1",
      now: () => new Date("2026-06-11T00:00:00.000Z"),
    });
    auditLog.record({
      type: "read-file",
      target: "package.json",
      modifiesState: false,
      decision: "allowed",
      outcome: "success",
    });

    const records = auditLog.list() as unknown[];
    records.length = 0;

    expect(auditLog.list()).toHaveLength(1);
  });

  it("maps read-only operations to allowed without a prompt decision", () => {
    expect(
      resolveLocalOperationConsent({
        modifiesState: false,
        consent: "ask",
      }),
    ).toMatchObject({
      decision: "allowed",
      reason: "read-only operation",
    });
  });

  it("maps state-changing consent states to operation decisions", () => {
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "always",
      }),
    ).toMatchObject({
      decision: "allowed",
      reason: "operation consent is always",
    });
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "ask",
        response: "accept-once",
      }),
    ).toMatchObject({
      decision: "allowed",
      reason: "operation accepted once",
    });
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "ask",
        response: "accept-always",
      }),
    ).toMatchObject({
      decision: "allowed",
      reason: "operation accepted always",
      persistConsent: "always",
    });
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "ask",
        response: "decline",
      }),
    ).toMatchObject({
      decision: "denied",
      reason: "operation declined",
    });
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "never",
      }),
    ).toMatchObject({
      decision: "denied",
      reason: "operation consent is never",
    });
  });

  it("blocks state-changing operations in read-only and plan-only modes", () => {
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "always",
        readOnly: true,
      }),
    ).toMatchObject({
      decision: "denied",
      reason: "state-changing operation is blocked in read-only mode",
    });
    expect(
      resolveLocalOperationConsent({
        modifiesState: true,
        consent: "always",
        planModeOnly: true,
      }),
    ).toMatchObject({
      decision: "denied",
      reason: "state-changing operation is blocked in plan-only mode",
    });
  });
});
