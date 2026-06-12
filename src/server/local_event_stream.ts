import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LocalRpcAuxiliaryRoute } from "./local_rpc_server";
export { createSseEventTransport } from "@/lib/local_web_transport";

export interface LocalEventStreamOptions {
  token?: string;
}

export interface LocalEventStream {
  routes: readonly LocalRpcAuxiliaryRoute[];
  publish(channel: string, payload: unknown): void;
  subscriberCount(channel?: string): number;
  close(): void;
}

type SseSubscriber = {
  type: "sse";
  channel: string;
  response: ServerResponse;
};

type WebSocketSubscriber = {
  type: "websocket";
  channel: string;
  socket: Duplex;
};

type Subscriber = SseSubscriber | WebSocketSubscriber;

const ALL_CHANNELS = "*";
const WEB_SOCKET_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function createLocalEventStream(
  options: LocalEventStreamOptions = {},
): LocalEventStream {
  const subscribers = new Set<Subscriber>();

  return {
    routes: [
      {
        method: "GET",
        path: "/api/events",
        requireOrigin: false,
        requireBearerToken: true,
        handle: ({ request, response }) => {
          const channel = getSingleQueryParam(request.url, "channel");
          const subscriber: SseSubscriber = { type: "sse", channel, response };
          subscribers.add(subscriber);
          response.writeHead(200, {
            "cache-control": "no-cache",
            connection: "keep-alive",
            "content-type": "text/event-stream",
          });
          response.write(": connected\n\n");
          request.on("close", () => {
            subscribers.delete(subscriber);
          });
        },
      },
      {
        method: "GET",
        path: "/api/events/ws",
        requireOrigin: true,
        requireBearerToken: false,
        handle: ({ response }) => {
          response.writeHead(426, {
            "content-type": "text/plain; charset=utf-8",
          });
          response.end("WebSocket upgrade required");
        },
        handleUpgrade: ({ request, socket }) => {
          requireWebSocketToken(request.url, options.token);
          const channel = getSingleQueryParam(request.url, "channel");
          acceptWebSocket(request, socket);
          const subscriber: WebSocketSubscriber = {
            type: "websocket",
            channel,
            socket,
          };
          subscribers.add(subscriber);
          const cleanup = () => subscribers.delete(subscriber);
          socket.on("close", cleanup);
          socket.on("end", cleanup);
          socket.on("error", cleanup);
        },
      },
    ],
    publish(channel: string, payload: unknown): void {
      for (const subscriber of subscribers) {
        if (subscribesToChannel(subscriber.channel, channel)) {
          writeEvent(subscriber, channel, payload);
        }
      }
    },
    subscriberCount(channel?: string): number {
      if (!channel) {
        return subscribers.size;
      }
      return Array.from(subscribers).filter((subscriber) =>
        channel === ALL_CHANNELS
          ? subscriber.channel === ALL_CHANNELS
          : subscribesToChannel(subscriber.channel, channel),
      ).length;
    },
    close(): void {
      for (const subscriber of subscribers) {
        if (subscriber.type === "sse") {
          subscriber.response.end();
        } else {
          subscriber.socket.end();
        }
      }
      subscribers.clear();
    },
  };
}

function subscribesToChannel(
  subscribedChannel: string,
  publishedChannel: string,
): boolean {
  return (
    subscribedChannel === ALL_CHANNELS || subscribedChannel === publishedChannel
  );
}

function getSingleQueryParam(url: string | undefined, key: string): string {
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  const value = parsed.searchParams.get(key);
  if (!value) {
    throw new DyadError(
      `Event stream ${key} is required`,
      DyadErrorKind.Validation,
    );
  }
  return value;
}

function requireWebSocketToken(
  url: string | undefined,
  expectedToken: string | undefined,
): void {
  if (!expectedToken) {
    return;
  }
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  if (parsed.searchParams.get("token") !== expectedToken) {
    throw new DyadError("Invalid local event token", DyadErrorKind.Auth);
  }
}

function acceptWebSocket(
  request: { headers: { [key: string]: string | string[] | undefined } },
  socket: Duplex,
): void {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    throw new DyadError(
      "WebSocket key header is required",
      DyadErrorKind.Validation,
    );
  }

  const accept = createHash("sha1")
    .update(`${key}${WEB_SOCKET_ACCEPT_GUID}`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
}

function writeEvent(
  subscriber: Subscriber,
  channel: string,
  payload: unknown,
): void {
  if (subscriber.type === "sse") {
    writeSseEvent(subscriber.response, channel, payload);
    return;
  }
  writeWebSocketText(
    subscriber.socket,
    JSON.stringify({ event: channel, data: payload }),
  );
}

function writeSseEvent(
  response: ServerResponse,
  channel: string,
  payload: unknown,
): void {
  response.write(`event: ${channel}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeWebSocketText(socket: Duplex, text: string): void {
  if (socket.destroyed) {
    return;
  }
  socket.write(encodeWebSocketTextFrame(text));
}

function encodeWebSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const length = payload.byteLength;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length <= 0xffff) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.allocUnsafe(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}
