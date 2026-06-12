import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createEventClient,
  createStreamClient,
  defineEvent,
  defineStream,
} from "@/ipc/contracts/core";
import {
  createLocalEventStream,
  createSseEventTransport,
} from "./local_event_stream";
import { createLocalRpcServer, type LocalRpcServer } from "./local_rpc_server";

const origin = "http://localhost:5173";

describe("local SSE event stream", () => {
  let server: LocalRpcServer | undefined;
  let baseUrl: string;
  let stream: ReturnType<typeof createLocalEventStream>;

  afterEach(async () => {
    stream?.close();
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("delivers server-pushed events through createEventClient shape", async () => {
    await startEventServer();
    const events = {
      output: defineEvent({
        channel: "app:output",
        payload: z.object({ appId: z.number(), line: z.string() }),
      }),
    };
    const transport = createSseEventTransport({
      baseUrl,
      token: "local-token",
      fetch: streamingNodeFetch,
    });
    const client = createEventClient(events, transport);
    const handler = vi.fn();

    const unsubscribe = client.onOutput(handler);
    await waitFor(() => stream.subscriberCount("app:output") === 1);
    stream.publish("app:output", { appId: 1, line: "hello" });
    await waitFor(() => handler.mock.calls.length === 1);

    expect(handler).toHaveBeenCalledWith({ appId: 1, line: "hello" });
    unsubscribe();
    await waitFor(() => stream.subscriberCount("app:output") === 0);
  });

  it("multiplexes multiple event channels over one SSE connection", async () => {
    await startEventServer();
    const eventOne = defineEvent({
      channel: "app:output",
      payload: z.object({ appId: z.number(), line: z.string() }),
    });
    const eventTwo = defineEvent({
      channel: "toast:error",
      payload: z.object({ message: z.string() }),
    });
    const transport = createSseEventTransport({
      baseUrl,
      token: "local-token",
      fetch: streamingNodeFetch,
    });
    const outputHandler = vi.fn();
    const toastHandler = vi.fn();

    const unsubscribeOutput = createEventClient(
      { output: eventOne },
      transport,
    ).onOutput(outputHandler);
    const unsubscribeToast = createEventClient(
      { toast: eventTwo },
      transport,
    ).onToast(toastHandler);

    await waitFor(() => stream.subscriberCount("*") === 1);
    expect(stream.subscriberCount()).toBe(1);
    expect(stream.subscriberCount("app:output")).toBe(1);
    expect(stream.subscriberCount("toast:error")).toBe(1);

    stream.publish("app:output", { appId: 1, line: "hello" });
    stream.publish("toast:error", { message: "boom" });

    await waitFor(() => outputHandler.mock.calls.length === 1);
    await waitFor(() => toastHandler.mock.calls.length === 1);
    expect(outputHandler).toHaveBeenCalledWith({ appId: 1, line: "hello" });
    expect(toastHandler).toHaveBeenCalledWith({ message: "boom" });

    unsubscribeOutput();
    expect(stream.subscriberCount()).toBe(1);
    unsubscribeToast();
    await waitFor(() => stream.subscriberCount() === 0);
  });

  it("rejects event connections without the bearer token", async () => {
    await startEventServer();

    const response = await nodeFetch(
      `${baseUrl}/api/events?channel=app%3Aoutput`,
      {
        headers: { origin },
      },
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Invalid local RPC token",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("rejects event connections from disallowed origins", async () => {
    await startEventServer();

    const response = await nodeFetch(
      `${baseUrl}/api/events?channel=app%3Aoutput`,
      {
        headers: {
          authorization: "Bearer local-token",
          origin: "https://example.com",
        },
      },
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Origin is not allowed",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("requires explicit event channel query", async () => {
    await startEventServer();

    const response = await nodeFetch(`${baseUrl}/api/events`, {
      headers: {
        authorization: "Bearer local-token",
        origin,
      },
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Event stream channel is required",
      kind: "validation",
    });
    expect(response.status).toBe(400);
  });

  it("fails unsupported stream endpoints explicitly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>(), {
        status: 200,
        statusText: "OK",
      }),
    );
    const transport = createSseEventTransport({
      baseUrl: "http://127.0.0.1:42517",
      token: "local-token",
      fetch: fetchMock,
    });
    const streamClient = createStreamClient(
      defineStream({
        channel: "chat:stream",
        input: z.object({ chatId: z.number() }),
        keyField: "chatId",
        events: {
          chunk: {
            channel: "chat:response:chunk",
            payload: z.object({ chatId: z.number(), chunk: z.string() }),
          },
          end: {
            channel: "chat:response:end",
            payload: z.object({ chatId: z.number() }),
          },
          error: {
            channel: "chat:response:error",
            payload: z.object({ chatId: z.number(), error: z.string() }),
          },
        },
      }),
      transport,
    );
    const onError = vi.fn();

    streamClient.start(
      { chatId: 1 },
      { onChunk: vi.fn(), onEnd: vi.fn(), onError },
    );

    await waitFor(() => onError.mock.calls.length === 1);
    expect(onError).toHaveBeenCalledWith({
      chatId: 1,
      error:
        "The configured SSE transport does not support invoke for chat:stream",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [eventUrl, eventInit] = fetchMock.mock.calls[0];
    expect(eventUrl.toString()).toBe(
      "http://127.0.0.1:42517/api/events?channel=*",
    );
    expect(eventInit?.headers).toMatchObject({
      accept: "text/event-stream",
      authorization: "Bearer local-token",
    });
  });

  it("delivers chat stream error events through the SSE stream client", async () => {
    await startEventServer();
    const streamClient = createStreamClient(
      defineStream({
        channel: "chat:stream",
        input: z.object({ chatId: z.number() }),
        keyField: "chatId",
        events: {
          chunk: {
            channel: "chat:response:chunk",
            payload: z.object({ chatId: z.number(), chunk: z.string() }),
          },
          end: {
            channel: "chat:response:end",
            payload: z.object({ chatId: z.number() }),
          },
          error: {
            channel: "chat:response:error",
            payload: z.object({ chatId: z.number(), error: z.string() }),
          },
        },
      }),
      {
        ...createSseEventTransport({
          baseUrl,
          token: "local-token",
          fetch: streamingNodeFetch,
        }),
        invoke: vi.fn().mockResolvedValue(42),
      },
    );
    const onError = vi.fn();

    streamClient.start(
      { chatId: 42 },
      { onChunk: vi.fn(), onEnd: vi.fn(), onError },
    );

    await waitFor(() => stream.subscriberCount("chat:response:error") === 1);
    stream.publish("chat:response:error", {
      chatId: 42,
      error: "Provider rejected the request",
    });

    await waitFor(() => onError.mock.calls.length === 1);
    expect(onError).toHaveBeenCalledWith({
      chatId: 42,
      error: "Provider rejected the request",
    });
  });

  async function startEventServer() {
    stream = createLocalEventStream();
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
      routes: stream.routes,
    });
    const listening = await server.listen();
    baseUrl = listening.url;
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

async function nodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: {
          origin,
          ...(init?.headers as http.OutgoingHttpHeaders | undefined),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function streamingNodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: {
          origin,
          ...(init?.headers as http.OutgoingHttpHeaders | undefined),
        },
      },
      (response) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on("data", (chunk: Buffer | string) => {
              controller.enqueue(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
              );
            });
            response.on("end", () => controller.close());
            response.on("error", (error) => controller.error(error));
          },
          cancel() {
            request.destroy();
          },
        });
        resolve(
          new Response(body, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers: response.headers as HeadersInit,
          }),
        );
      },
    );
    request.on("error", reject);
    if (init?.signal) {
      init.signal.addEventListener("abort", () => {
        request.destroy();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }
    request.end();
  });
}
