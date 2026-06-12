import {
  integrationContracts,
  type IntegrationResponsePayload,
} from "../types/integration";
import { integrationResolver } from "../../pro/main/ipc/handlers/local_agent/userInputResolvers";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";

export function respondToIntegrationHandler(
  params: IntegrationResponsePayload,
): void {
  const matched = integrationResolver.resolve(
    params.requestId,
    params.completed && params.provider ? { provider: params.provider } : null,
  );
  if (!matched) {
    // No pending resolver: the request has timed out, been aborted, or
    // already been answered. Surface this so the renderer can show an
    // actionable error instead of silently treating the IPC as success.
    throw new DyadError(
      `No pending integration request: ${params.requestId}`,
      DyadErrorKind.NotFound,
    );
  }
}

export function registerIntegrationHandlers() {
  createTypedHandler(integrationContracts.respond, async (_, params) => {
    respondToIntegrationHandler(params);
  });
}
