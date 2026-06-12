import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createHttpInvokeTransport } from "@/ipc/contracts/core";
import { defineContract } from "@/ipc/contracts/core";
import { createLocalRpcServer, type LocalRpcServer } from "./local_rpc_server";

const echoContract = defineContract({
  channel: "test:echo",
  input: z.object({ message: z.string() }),
  output: z.object({ reply: z.string() }),
});

describe("LocalRpcServer", () => {
  let server: LocalRpcServer | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: ["http://localhost:5173"],
    });
    server.register(echoContract, async (input) => ({
      reply: `echo:${input.message}`,
    }));
    const listening = await server.listen();
    baseUrl = listening.url;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("handles contract RPC requests over POST /api/rpc/:channel", async () => {
    const transport = createHttpInvokeTransport({
      baseUrl,
      token: "local-token",
      fetch: nodeFetch,
      headers: { origin: "http://localhost:5173" },
    });

    await expect(
      transport.invoke("test:echo", { message: "hi" }),
    ).resolves.toEqual({ reply: "echo:hi" });
  });

  it("rejects requests without the bearer token", async () => {
    const response = await nodeFetch(`${baseUrl}/api/rpc/test%3Aecho`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ message: "hi" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid local RPC token",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("rejects disallowed origins", async () => {
    const response = await nodeFetch(`${baseUrl}/api/rpc/test%3Aecho`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-token",
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ message: "hi" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Origin is not allowed",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("rejects requests without an Origin header", async () => {
    const response = await nodeFetch(`${baseUrl}/api/rpc/test%3Aecho`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: "hi" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Origin header is required",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("rejects invalid input through the contract schema", async () => {
    const response = await nodeFetch(`${baseUrl}/api/rpc/test%3Aecho`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-token",
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ message: 123 }),
    });

    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(400);
    expect(body.error).toContain("[test:echo] Invalid input");
  });

  it("rejects invalid handler output through the contract schema", async () => {
    server?.register(echoContract, async () => ({ reply: 123 }) as never);

    const response = await nodeFetch(`${baseUrl}/api/rpc/test%3Aecho`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-token",
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ message: "hi" }),
    });

    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(500);
    expect(body.error).toContain("[test:echo] Invalid output");
  });

  it("rejects non-loopback bind hosts", () => {
    expect(() =>
      createLocalRpcServer({
        token: "local-token",
        allowedOrigins: ["http://localhost:5173"],
        host: "0.0.0.0",
      }),
    ).toThrow("loopback");
  });

  it("routes prefix-matched auxiliary GET handlers", async () => {
    await server?.close();
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: ["http://localhost:5173"],
      routes: [
        {
          method: "GET",
          path: "/api/preview",
          matchPrefix: true,
          requireOrigin: false,
          handle: ({ request, response }) => {
            response.writeHead(200, { "content-type": "text/plain" });
            response.end(request.url);
          },
        },
      ],
    });
    const listening = await server.listen();
    baseUrl = listening.url;

    const response = await nodeFetch(
      `${baseUrl}/api/preview/17/src/main.tsx?x=1`,
    );

    await expect(response.text()).resolves.toBe(
      "/api/preview/17/src/main.tsx?x=1",
    );
  });
});

async function nodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  const body =
    typeof init?.body === "string" || init?.body instanceof Buffer
      ? init.body
      : undefined;

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: init?.headers as http.OutgoingHttpHeaders | undefined,
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
    if (body) {
      request.write(body);
    }
    request.end();
  });
}
