import { describe, expect, it, vi } from "vitest";

import {
  createRuntimeIpc,
  getRuntimeMode,
  isLocalWebRuntime,
} from "./runtime_client";
import {
  createLocalWebEventTransport,
  LocalWebTransportConfigError,
} from "./local_web_transport";

describe("runtime client", () => {
  it("defaults to Electron IPC mode", () => {
    expect(getRuntimeMode({ env: {}, globalConfig: undefined })).toBe(
      "electron",
    );
    expect(isLocalWebRuntime({ env: {}, globalConfig: undefined })).toBe(false);
  });

  it("selects local Web HTTP transport from bootstrap config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: createAppListResponse(),
        }),
      ),
    );
    const ipc = createRuntimeIpc({
      globalConfig: {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
      },
      fetch: fetchMock,
    });

    await expect(ipc.app.listApps()).resolves.toMatchObject({
      apps: [{ id: 1, name: "Test App" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:42517/api/rpc/list-apps",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer local-token",
        }),
      }),
    );
  });

  it("uses SSE event transport in local Web mode", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            controller = nextController;
          },
        }),
        { status: 200, statusText: "OK" },
      ),
    );
    const ipc = createRuntimeIpc({
      globalConfig: {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
        eventUrl: "http://127.0.0.1:42517/api/events",
      },
      fetch: fetchMock,
    });
    const handler = vi.fn();

    const unsubscribe = ipc.events.agent.onTodosUpdate(handler);
    await waitFor(() => controller !== undefined);
    controller!.enqueue(
      encoder.encode(
        'event: agent-tool:todos-update\ndata: {"chatId":7,"todos":[]}\n\n',
      ),
    );
    await waitFor(() => handler.mock.calls.length === 1);

    expect(handler).toHaveBeenCalledWith({ chatId: 7, todos: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:42517/api/events?channel=*"),
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "text/event-stream",
          authorization: "Bearer local-token",
        }),
      }),
    );
    unsubscribe();
  });

  it("prefers WebSocket for local Web event transport when available", async () => {
    const sockets: FakeWebSocket[] = [];
    const WebSocketMock = vi.fn((url: string) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    });
    const fetchMock = vi.fn();
    const transport = createLocalWebEventTransport({
      baseUrl: "https://dyad.example.test",
      eventUrl: "https://dyad.example.test/api/events",
      token: "local-token",
      fetch: fetchMock,
      webSocket: WebSocketMock as unknown as typeof WebSocket,
    });
    const handler = vi.fn();

    const unsubscribe = transport.on!("chat:response:chunk", handler);
    await transport.ready?.();
    sockets[0].emitMessage(
      JSON.stringify({
        event: "chat:response:chunk",
        data: { chatId: 1, streamingPatch: { offset: 0, content: "hi" } },
      }),
    );

    expect(WebSocketMock).toHaveBeenCalledWith(
      "wss://dyad.example.test/api/events/ws?channel=*&token=local-token",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({
      chatId: 1,
      streamingPatch: { offset: 0, content: "hi" },
    });
    unsubscribe();
  });

  it("routes local Web chat stream events after the event transport is ready", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes("/api/events")) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(": connected\n\n"));
              },
            }),
            {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "text/event-stream" },
            },
          );
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  [
                    JSON.stringify({
                      type: "event",
                      channel: "chat:response:chunk",
                      payload: {
                        chatId: 42,
                        messages: [
                          { id: 1, role: "assistant", content: "hello" },
                        ],
                      },
                    }),
                    JSON.stringify({ type: "result", data: 42 }),
                    "",
                  ].join("\n"),
                ),
              );
              controller.close();
            },
          }),
          {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/x-ndjson" },
          },
        );
      });
    const ipc = createRuntimeIpc({
      globalConfig: {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
        eventUrl: "http://127.0.0.1:42517/api/events",
      },
      fetch: fetchMock,
    });
    const onChunk = vi.fn();

    await expect(
      ipc.chatStream.start(
        { chatId: 42, prompt: "hello" },
        { onChunk, onEnd: vi.fn(), onError: vi.fn() },
      ),
    ).resolves.toBe(42);

    expect(onChunk).toHaveBeenCalledWith({
      chatId: 42,
      messages: [{ id: 1, role: "assistant", content: "hello" }],
    });
  });

  it("shares one SSE connection across local Web event listeners", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            controller = nextController;
          },
        }),
        { status: 200, statusText: "OK" },
      ),
    );
    const ipc = createRuntimeIpc({
      globalConfig: {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
        eventUrl: "http://127.0.0.1:42517/api/events",
      },
      fetch: fetchMock,
    });

    const unsubscribeTodos = ipc.events.agent.onTodosUpdate(vi.fn());
    const unsubscribeErrors = ipc.events.misc.onErrorToast(vi.fn());
    await waitFor(() => controller !== undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:42517/api/events?channel=*",
    );
    unsubscribeTodos();
    unsubscribeErrors();
  });

  it("throws a visible local Web configuration error instead of falling back", () => {
    expect(() =>
      getRuntimeMode({
        env: { VITE_DYAD_RUNTIME_MODE: "local-web" },
        globalConfig: undefined,
      }),
    ).toThrow(LocalWebTransportConfigError);
  });
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

function createAppListResponse() {
  return {
    apps: [
      {
        id: 1,
        name: "Test App",
        path: "test-app",
        createdAt: new Date("2026-06-11T00:00:00.000Z"),
        updatedAt: new Date("2026-06-11T00:00:00.000Z"),
        isFavorite: false,
        collectionId: null,
        frameworkType: "vite",
      },
    ],
  };
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}
