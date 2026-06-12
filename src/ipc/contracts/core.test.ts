import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createClient,
  createEventClient,
  createHttpInvokeTransport,
  createStreamClient,
  defineContract,
  defineEvent,
  defineStream,
  HttpInvokeAbortError,
  type IpcTransport,
} from "./core";

const testContracts = {
  ping: defineContract({
    channel: "test:ping",
    input: z.object({ message: z.string() }),
    output: z.object({ reply: z.string() }),
  }),
};

afterEach(() => {
  delete (window as any).electron;
  vi.restoreAllMocks();
});

describe("IPC contract transports", () => {
  it("uses the Electron IPC transport by default", async () => {
    const invoke = vi.fn().mockResolvedValue({ reply: "pong" });
    (window as any).electron = { ipcRenderer: { invoke } };

    const client = createClient(testContracts);

    await expect(client.ping({ message: "hello" })).resolves.toEqual({
      reply: "pong",
    });
    expect(invoke).toHaveBeenCalledWith("test:ping", { message: "hello" });
  });

  it("uses an injected invoke transport", async () => {
    const transport: IpcTransport = {
      invoke: vi.fn().mockResolvedValue({ reply: "from transport" }),
    };

    const client = createClient(testContracts, transport);

    await expect(client.ping({ message: "hello" })).resolves.toEqual({
      reply: "from transport",
    });
    expect(transport.invoke).toHaveBeenCalledWith("test:ping", {
      message: "hello",
    });
  });

  it("uses an injected event transport", () => {
    const events = {
      changed: defineEvent({
        channel: "test:changed",
        payload: z.object({ id: z.number() }),
      }),
    };
    const unsubscribe = vi.fn();
    const transport: IpcTransport = {
      invoke: vi.fn(),
      on: vi.fn((_channel, listener) => {
        listener({ id: 42 });
        return unsubscribe;
      }),
    };
    const handler = vi.fn();

    const eventClient = createEventClient(events, transport);
    const result = eventClient.onChanged(handler);

    expect(transport.on).toHaveBeenCalledWith(
      "test:changed",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({ id: 42 });
    expect(result).toBe(unsubscribe);
  });

  it("reports unsupported streams for transports without event support", () => {
    const stream = defineStream({
      channel: "test:stream",
      input: z.object({ streamId: z.string() }),
      keyField: "streamId",
      events: {
        chunk: {
          channel: "test:stream:chunk",
          payload: z.object({ streamId: z.string(), chunk: z.string() }),
        },
        end: {
          channel: "test:stream:end",
          payload: z.object({ streamId: z.string() }),
        },
        error: {
          channel: "test:stream:error",
          payload: z.object({ streamId: z.string(), error: z.string() }),
        },
      },
    });
    const transport: IpcTransport = { invoke: vi.fn() };
    const streamClient = createStreamClient(stream, transport);

    expect(() =>
      streamClient.start(
        { streamId: "s1" },
        { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() },
      ),
    ).toThrow("does not support streams");
  });

  it("resolves failed stream invokes after dispatching onError", async () => {
    const stream = defineStream({
      channel: "test:stream",
      input: z.object({ streamId: z.string() }),
      keyField: "streamId",
      events: {
        chunk: {
          channel: "test:stream:chunk",
          payload: z.object({ streamId: z.string(), chunk: z.string() }),
        },
        end: {
          channel: "test:stream:end",
          payload: z.object({ streamId: z.string() }),
        },
        error: {
          channel: "test:stream:error",
          payload: z.object({ streamId: z.string(), error: z.string() }),
        },
      },
    });
    const transport: IpcTransport = {
      invoke: vi.fn().mockRejectedValue(new Error("Provider failed")),
      on: vi.fn(() => vi.fn()),
    };
    const onError = vi.fn();

    const streamClient = createStreamClient(stream, transport);
    await expect(
      streamClient.start(
        { streamId: "s1" },
        { onChunk: vi.fn(), onEnd: vi.fn(), onError },
      ),
    ).resolves.toBe("error");

    expect(onError).toHaveBeenCalledWith({
      streamId: "s1",
      error: "Provider failed",
    });
  });

  it("sends HTTP invoke requests and unwraps success envelopes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { reply: "http" } }), {
        status: 200,
        statusText: "OK",
      }),
    );
    const transport = createHttpInvokeTransport({
      baseUrl: "http://127.0.0.1:42517",
      token: "local-token",
      fetch: fetchMock,
    });
    const client = createClient(testContracts, transport);

    await expect(client.ping({ message: "hello" })).resolves.toEqual({
      reply: "http",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:42517/api/rpc/test%3Aping",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer local-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "hello" }),
      },
    );
  });

  it("binds the default fetch implementation to globalThis", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { reply: "http" } }), {
          status: 200,
          statusText: "OK",
        }),
      );
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    try {
      const transport = createHttpInvokeTransport({
        baseUrl: "http://127.0.0.1:42517",
      });
      const client = createClient(testContracts, transport);

      await expect(client.ping({ message: "hello" })).resolves.toEqual({
        reply: "http",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("can send legacy HTTP invoke envelope requests with a custom path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { reply: "http" } }), {
        status: 200,
        statusText: "OK",
      }),
    );
    const transport = createHttpInvokeTransport({
      baseUrl: "http://127.0.0.1:42517",
      path: "/ipc/invoke",
      fetch: fetchMock,
    });
    const client = createClient(testContracts, transport);

    await expect(client.ping({ message: "hello" })).resolves.toEqual({
      reply: "http",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:42517/ipc/invoke",
      expect.objectContaining({
        body: JSON.stringify({
          channel: "test:ping",
          input: { message: "hello" },
        }),
      }),
    );
  });

  it("throws HTTP invoke envelope errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "Denied" }), {
        status: 200,
        statusText: "OK",
      }),
    );
    const transport = createHttpInvokeTransport({
      baseUrl: "http://127.0.0.1:42517",
      fetch: fetchMock,
    });
    const client = createClient(testContracts, transport);

    await expect(client.ping({ message: "hello" })).rejects.toThrow("Denied");
  });

  it("throws explicit HTTP errors for non-JSON error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>not found</html>", {
        status: 404,
        statusText: "Not Found",
      }),
    );
    const transport = createHttpInvokeTransport({
      baseUrl: "http://127.0.0.1:42517",
      fetch: fetchMock,
    });
    const client = createClient(testContracts, transport);

    await expect(client.ping({ message: "hello" })).rejects.toThrow(
      "HTTP invoke failed for test:ping: 404 Not Found",
    );
  });

  it("wraps aborted HTTP invoke requests in a typed error", async () => {
    const abortError = new Error("Failed to fetch");
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    const transport = createHttpInvokeTransport({
      baseUrl: "http://127.0.0.1:42517",
      fetch: fetchMock,
    });
    const client = createClient(testContracts, transport);

    const error = await client
      .ping({ message: "hello" })
      .catch((error) => error);

    expect(error).toBeInstanceOf(HttpInvokeAbortError);
    expect(error).toMatchObject({
      channel: "test:ping",
      cause: abortError,
    });
  });
});
