import http from "node:http";
import { describe, expect, it, vi } from "vitest";

import { createLocalRpcServer } from "./local_rpc_server";
import { createLocalWebStreamRoutes } from "./local_web_stream_routes";

const origin = "http://localhost:5173";

describe("local web stream routes", () => {
  it("marks chat stream responses as unbuffered ndjson", async () => {
    let rpcServer: ReturnType<typeof createLocalRpcServer> | undefined;
    const service = {
      startChatStream: vi.fn(async () => 7),
    };
    rpcServer = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
      routes: createLocalWebStreamRoutes({
        events: { publish: vi.fn() },
        getRpcServer: () => rpcServer,
        getService: () => service as any,
      }),
    });
    const listening = await rpcServer.listen();

    try {
      const response = await postJson(
        `${listening.url}/api/rpc/chat%3Astream`,
        {
          chatId: 1,
          prompt: "hi",
          redo: false,
          selectedComponents: [],
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain(
        "application/x-ndjson",
      );
      expect(response.headers["x-accel-buffering"]).toBe("no");
      expect(response.body.split("\n").filter(Boolean)).toEqual([
        '{"type":"ready"}',
        '{"type":"result","data":7}',
      ]);
    } finally {
      await rpcServer.close();
    }
  });

  it("flushes the ready event before the chat handler finishes", async () => {
    let rpcServer: ReturnType<typeof createLocalRpcServer> | undefined;
    let finishStream: ((value: number) => void) | undefined;
    const service = {
      startChatStream: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            finishStream = resolve;
          }),
      ),
    };
    rpcServer = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
      routes: createLocalWebStreamRoutes({
        events: { publish: vi.fn() },
        getRpcServer: () => rpcServer,
        getService: () => service as any,
      }),
    });
    const listening = await rpcServer.listen();

    try {
      const stream = await postJsonStream(
        `${listening.url}/api/rpc/chat%3Astream`,
        {
          chatId: 1,
          prompt: "hi",
          redo: false,
          selectedComponents: [],
        },
      );

      const firstChunk = await stream.nextChunk;
      expect(firstChunk).toContain('{"type":"ready"}\n');

      finishStream?.(7);
      const body = await stream.body;
      expect(body).toContain('{"type":"result","data":7}');
    } finally {
      await rpcServer.close();
    }
  });

  it("cancels the backend chat stream when the HTTP client disconnects", async () => {
    let rpcServer: ReturnType<typeof createLocalRpcServer> | undefined;
    let finishStream: ((value: number) => void) | undefined;
    const service = {
      startChatStream: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            finishStream = resolve;
          }),
      ),
      cancelChatStream: vi.fn(async () => true),
    };
    rpcServer = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
      routes: createLocalWebStreamRoutes({
        events: { publish: vi.fn() },
        getRpcServer: () => rpcServer,
        getService: () => service as any,
      }),
    });
    const listening = await rpcServer.listen();

    try {
      const request = postJsonAbortOnFirstChunk(
        `${listening.url}/api/rpc/chat%3Astream`,
        {
          chatId: 12,
          prompt: "hi",
          redo: false,
          selectedComponents: [],
        },
      );
      await request.firstChunk;
      await waitForExpect(() => {
        expect(service.cancelChatStream).toHaveBeenCalledWith(
          expect.anything(),
          12,
        );
      });
      finishStream?.(7);
    } finally {
      await rpcServer.close();
    }
  });
});

function postJson(
  url: string,
  body: unknown,
): Promise<{
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          authorization: "Bearer local-token",
          "content-type": "application/json",
          origin,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}

function postJsonAbortOnFirstChunk(
  url: string,
  body: unknown,
): {
  firstChunk: Promise<string>;
} {
  let resolveFirstChunk: ((chunk: string) => void) | undefined;
  const firstChunk = new Promise<string>((resolve) => {
    resolveFirstChunk = resolve;
  });
  const request = http.request(
    url,
    {
      method: "POST",
      headers: {
        authorization: "Bearer local-token",
        "content-type": "application/json",
        origin,
      },
    },
    (response) => {
      response.on("data", (chunk) => {
        resolveFirstChunk?.(
          (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString(
            "utf8",
          ),
        );
        resolveFirstChunk = undefined;
        request.destroy();
      });
      response.resume();
    },
  );
  request.on("error", () => undefined);
  request.end(JSON.stringify(body));
  return { firstChunk };
}

async function waitForExpect(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function postJsonStream(
  url: string,
  body: unknown,
): Promise<{
  nextChunk: Promise<string>;
  body: Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let resolveFirstChunk: ((chunk: string) => void) | undefined;
    const firstChunk = new Promise<string>((resolveChunk) => {
      resolveFirstChunk = resolveChunk;
    });

    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          authorization: "Bearer local-token",
          "content-type": "application/json",
          origin,
        },
      },
      (response) => {
        const fullBody = new Promise<string>((resolveBody) => {
          response.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            chunks.push(buffer);
            resolveFirstChunk?.(buffer.toString("utf8"));
            resolveFirstChunk = undefined;
          });
          response.on("end", () => {
            resolveBody(Buffer.concat(chunks).toString("utf8"));
          });
        });
        resolve({
          nextChunk: firstChunk,
          body: fullBody,
        });
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
