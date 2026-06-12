/**
 * IPC handlers for agent tool consent management
 */

import {
  getAllAgentToolConsents,
  setAgentToolConsent,
  resolveAgentToolConsent,
  TOOL_DEFINITIONS,
  getDefaultConsent,
  type AgentToolName,
} from "./tool_definitions";
import log from "electron-log";
import type {
  AgentTool,
  SetAgentToolConsentParams,
  AgentToolConsentResponseParams,
} from "@/ipc/types";
import { createLoggedHandler } from "@/ipc/handlers/safe_handle";

const logger = log.scope("agent_tool_handlers");

export function getAgentToolsHandler(): AgentTool[] {
  const consents = getAllAgentToolConsents();
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    isAllowedByDefault: getDefaultConsent(tool.name) === "always",
    consent: consents[tool.name],
  }));
}

export function setAgentConsentHandler(
  params: SetAgentToolConsentParams,
): void {
  setAgentToolConsent(params.toolName as AgentToolName, params.consent);
}

export function respondToAgentConsentHandler(
  params: AgentToolConsentResponseParams,
): void {
  resolveAgentToolConsent(params.requestId, params.decision);
}

export function registerAgentToolHandlers() {
  const handle = createLoggedHandler(logger);
  // Get list of available tools with their consent settings
  handle("agent-tool:get-tools", async (): Promise<AgentTool[]> => {
    return getAgentToolsHandler();
  });

  // Set consent for a single tool
  handle(
    "agent-tool:set-consent",
    async (_event, params: SetAgentToolConsentParams) => {
      setAgentConsentHandler(params);
      return { success: true };
    },
  );

  // Handle consent response from renderer
  handle(
    "agent-tool:consent-response",
    async (_event, params: AgentToolConsentResponseParams) => {
      respondToAgentConsentHandler(params);
    },
  );
}
