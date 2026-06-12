import type { ServerResponse } from "node:http";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  ChatStreamParamsSchema,
  type ChatStreamParams,
} from "@/ipc/types/chat";
import type { LocalEventStream } from "./local_event_stream";
import { createLocalWebIpcEvent } from "./local_web_ipc_event";
import type {
  LocalRpcAuxiliaryRoute,
  LocalRpcServer,
} from "./local_rpc_server";
import type { LocalWebRpcService } from "./local_web_rpc_registry";

const CHAT_STREAM_PATH = `/api/rpc/${encodeURIComponent("chat:stream")}`;

export function createLocalWebStreamRoutes({
  events,
  getRpcServer,
  getService,
}: {
  events: Pick<LocalEventStream, "publish">;
  getRpcServer: () => LocalRpcServer | undefined;
  getService: () => LocalWebRpcService | undefined;
}): LocalRpcAuxiliaryRoute[] {
  return [
    {
      method: "POST",
      path: CHAT_STREAM_PATH,
      requireOrigin: true,
      requireBearerToken: true,
      handle: async ({ request, response }) => {
        const rpcServer = getRpcServer();
        const service = getService();
        if (!rpcServer || !service) {
          throw new DyadError(
            "Local Web stream service is not ready",
            DyadErrorKind.Precondition,
          );
        }

        startJsonlStream(response);
        writeJsonl(response, { type: "ready" });
        const eventBridge = createLocalWebIpcEvent(events, (channel, payload) =>
          writeJsonl(response, { type: "event", channel, payload }),
        );
        let params: ChatStreamParams | undefined;
        let completed = false;
        const cancelIfDisconnected = () => {
          if (completed || !params || response.writableEnded) {
            return;
          }
          void service.cancelChatStream?.(eventBridge, params.chatId);
        };
        response.on("close", cancelIfDisconnected);
        request.on("aborted", cancelIfDisconnected);

        try {
          params = ChatStreamParamsSchema.parse(
            await rpcServer.readJsonRequestBody(request),
          );
          const result = await service.startChatStream(eventBridge, params);
          completed = true;
          writeJsonl(response, { type: "result", data: result });
        } catch (error) {
          completed = true;
          writeJsonl(response, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          completed = true;
          response.off("close", cancelIfDisconnected);
          request.off("aborted", cancelIfDisconnected);
          response.end();
        }
      },
    },
  ];
}

function startJsonlStream(response: ServerResponse): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "application/x-ndjson",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  });
  response.flushHeaders?.();
}

function writeJsonl(response: ServerResponse, payload: unknown): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.write(`${JSON.stringify(payload)}\n`);
  response.flushHeaders?.();
}
