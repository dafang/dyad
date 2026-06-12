import { describe, expect, it } from "vitest";
import {
  TOOL_DEFINITIONS,
  resolveAgentToolConsent,
  shouldIncludeTool,
  waitForAgentToolConsent,
} from "./tool_definitions";
import type { AgentContext } from "./tools/types";

function buildMockContext(): AgentContext {
  return {
    event: {
      sender: {
        isDestroyed: () => false,
        send: () => undefined,
      },
    },
    appId: 1,
    appPath: "/tmp/app",
    referencedApps: new Map(),
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    todos: [],
    dyadRequestId: "request",
    fileEditTracker: {},
    isDyadPro: true,
    onXmlStream: () => undefined,
    onXmlComplete: () => undefined,
    requireConsent: async () => true,
    appendUserMessage: () => undefined,
    onUpdateTodos: () => undefined,
  };
}

function getTool(name: string) {
  const tool = TOOL_DEFINITIONS.find((definition) => definition.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

describe("agent tool consent queue", () => {
  it("accept-always resolves queued requests for the same chat and tool", async () => {
    const firstWrite = waitForAgentToolConsent(
      "request-write-1",
      1,
      "write_file",
    );
    const secondWrite = waitForAgentToolConsent(
      "request-write-2",
      1,
      "write_file",
    );
    const otherTool = waitForAgentToolConsent(
      "request-search-replace",
      1,
      "search_replace",
    );

    resolveAgentToolConsent("request-write-1", "accept-always");

    await expect(Promise.all([firstWrite, secondWrite])).resolves.toEqual([
      "accept-always",
      "accept-always",
    ]);

    resolveAgentToolConsent("request-search-replace", "decline");
    await expect(otherTool).resolves.toBe("decline");
  });

  it("accept-once only resolves the selected request", async () => {
    const firstWrite = waitForAgentToolConsent(
      "request-once-write-1",
      1,
      "write_file",
    );
    const secondWrite = waitForAgentToolConsent(
      "request-once-write-2",
      1,
      "write_file",
    );

    resolveAgentToolConsent("request-once-write-1", "accept-once");
    await expect(firstWrite).resolves.toBe("accept-once");

    resolveAgentToolConsent("request-once-write-2", "decline");
    await expect(secondWrite).resolves.toBe("decline");
  });
});

describe("agent tool inclusion", () => {
  it("hides implementation tools while the app blueprint is pending", () => {
    const ctx = buildMockContext();
    const options = { enableAppBlueprint: true };

    expect(
      shouldIncludeTool(getTool("write_app_blueprint"), ctx, options),
    ).toBe(true);
    expect(shouldIncludeTool(getTool("read_file"), ctx, options)).toBe(true);
    expect(shouldIncludeTool(getTool("write_file"), ctx, options)).toBe(false);
    expect(shouldIncludeTool(getTool("search_replace"), ctx, options)).toBe(
      false,
    );
    expect(shouldIncludeTool(getTool("delete_file"), ctx, options)).toBe(false);
  });

  it("allows implementation tools after the app blueprint flow is disabled for the turn", () => {
    const ctx = buildMockContext();
    const options = { enableAppBlueprint: false };

    expect(
      shouldIncludeTool(getTool("write_app_blueprint"), ctx, options),
    ).toBe(false);
    expect(shouldIncludeTool(getTool("write_file"), ctx, options)).toBe(true);
    expect(shouldIncludeTool(getTool("search_replace"), ctx, options)).toBe(
      true,
    );
    expect(shouldIncludeTool(getTool("delete_file"), ctx, options)).toBe(true);
  });
});
