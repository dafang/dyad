import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import {
  generateLocalServerToken,
  startLocalServer,
  type LocalServerInstance,
} from "./local_server";

describe("local Web Portal server lifecycle", () => {
  const servers: LocalServerInstance[] = [];

  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  });

  it("starts on a loopback host with an injected token", async () => {
    const server = await startTestServer({ token: "test-token" });

    expect(server.info.host).toBe("127.0.0.1");
    expect(server.info.baseUrl).toBe(`http://127.0.0.1:${server.info.port}`);
    expect(server.info.token).toBe("test-token");
    expect(server.info.config).toMatchObject({
      baseUrl: server.info.baseUrl,
      rpcPath: "/api/rpc/:channel",
      healthPath: "/api/health",
      mode: "local",
      requiresToken: true,
    });
  });

  it("generates high-entropy process tokens by default", async () => {
    const first = await startTestServer();
    const second = await startTestServer();

    expect(first.info.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(second.info.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(first.info.token).not.toBe(second.info.token);
    expect(generateLocalServerToken()).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it("rejects token generation with too little entropy", () => {
    expect(() => generateLocalServerToken(16)).toThrow(
      "at least 32 random bytes",
    );
  });

  it("returns health and config metadata without leaking the raw token", async () => {
    const server = await startTestServer({
      token: "secret-token",
      version: "test-version",
    });

    const health = await fetchJson(`${server.info.baseUrl}/api/health`, {
      headers: { origin: "http://localhost:5173" },
    });
    const config = await fetchJson(`${server.info.baseUrl}/api/config`, {
      headers: { origin: "http://localhost:5173" },
    });

    expect(health.response.status).toBe(200);
    expect(health.response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(health.body).toEqual({
      ok: true,
      mode: "local",
      version: "test-version",
    });
    expect(config.response.status).toBe(200);
    expect(config.body).toEqual({
      ok: true,
      config: {
        baseUrl: server.info.baseUrl,
        rpcPath: "/api/rpc/:channel",
        healthPath: "/api/health",
        mode: "local",
        version: "test-version",
        requiresToken: true,
      },
    });
    expect(JSON.stringify(health.body)).not.toContain("secret-token");
    expect(JSON.stringify(config.body)).not.toContain("secret-token");
  });

  it("mounts additional local runtime routes", async () => {
    const server = await startTestServer({
      routes: [
        {
          method: "GET",
          path: "/api/runtime-ping",
          requireOrigin: true,
          requireBearerToken: true,
          handle: ({ response, origin }) => {
            response.setHeader("access-control-allow-origin", origin ?? "");
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: true }));
          },
        },
      ],
      token: "route-token",
    });

    const response = await nodeFetch(
      `${server.info.baseUrl}/api/runtime-ping`,
      {
        headers: {
          authorization: "Bearer route-token",
          origin: "http://localhost:5173",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("allows bootstrap CORS preflight for configured origins", async () => {
    const server = await startTestServer();

    const response = await nodeFetch(`${server.info.baseUrl}/api/config`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "GET",
    );
  });

  it("rejects disallowed origins on bootstrap endpoints", async () => {
    const server = await startTestServer();

    const response = await nodeFetch(`${server.info.baseUrl}/api/config`, {
      headers: { origin: "https://example.com" },
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Origin is not allowed",
    });
    expect(response.status).toBe(401);
  });

  it("closes the listener and releases the port", async () => {
    const first = await startTestServer();
    const port = first.info.port;

    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await startTestServer({ port });
    expect(second.info.port).toBe(port);
  });

  it("classifies port conflicts as user/environment errors", async () => {
    const first = await startTestServer();

    await expect(
      startTestServer({ port: first.info.port }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Conflict,
      message: "Local server port is already in use",
    });
  });

  it("rejects non-loopback hosts", async () => {
    await expect(startTestServer({ host: "0.0.0.0" })).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Precondition,
    });
  });

  async function startTestServer(
    options: Partial<Parameters<typeof startLocalServer>[0]> = {},
  ): Promise<LocalServerInstance> {
    const server = await startLocalServer({
      allowedOrigins: ["http://localhost:5173"],
      ...options,
    });
    servers.push(server);
    return server;
  }
});

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await nodeFetch(url, init);
  return {
    response,
    body: await response.json(),
  };
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
    request.end();
  });
}
