import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { defineContract } from "@/ipc/contracts/core";
import { registerElectronBackendHandlers } from "@/ipc/handlers/electron_backend_adapter";
import {
  createTypedBackendRegistry,
  registerTypedBackendHandler,
} from "./local_backend_host";
import { registerLocalHttpBackendHandlers } from "./local_http_backend_adapter";
import { createLocalRpcServer, type LocalRpcServer } from "./local_rpc_server";

const origin = "http://localhost:5173";

const readContract = defineContract({
  channel: "test:read",
  input: z.object({ id: z.number() }),
  output: z.object({ id: z.number(), name: z.string() }),
});

const mutationContract = defineContract({
  channel: "test:mutate",
  input: z.object({ name: z.string().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

const integrationContract = defineContract({
  channel: "test:integration",
  input: z.object({ mode: z.enum(["ok", "auth", "not-found", "conflict"]) }),
  output: z.object({ provider: z.string() }),
});

describe("typed backend host adapters", () => {
  let server: LocalRpcServer | undefined;
  let baseUrl = "";

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    vi.restoreAllMocks();
  });

  it("registers representative contracts once and exposes them through Electron IPC", async () => {
    const registry = createRepresentativeRegistry();
    const handlers = new Map<
      string,
      (event: unknown, input: unknown) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn((channel, handler) => {
        handlers.set(channel, handler);
      }),
    };

    registerElectronBackendHandlers(registry, { ipcMain });

    expect(ipcMain.handle).toHaveBeenCalledTimes(3);
    await expect(
      handlers.get("test:read")?.({ sender: "electron" }, { id: 1 }),
    ).resolves.toEqual({ id: 1, name: "App 1" });
    await expect(
      handlers.get("test:mutate")?.({}, { name: "Renamed" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.get("test:integration")?.({}, { mode: "ok" }),
    ).resolves.toEqual({ provider: "github" });
  });

  it("validates Electron adapter input and warns for invalid development output", async () => {
    const warn = vi.fn();
    const registry = createTypedBackendRegistry({
      outputValidation: "development-warn",
      warn,
    });
    registry.register(
      readContract,
      async () => ({ id: "bad", name: "Bad" }) as never,
    );
    const handlers = new Map<
      string,
      (event: unknown, input: unknown) => Promise<unknown>
    >();
    registerElectronBackendHandlers(registry, {
      ipcMain: {
        handle: vi.fn((channel, handler) => {
          handlers.set(channel, handler);
        }),
      },
    });
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    await expect(
      handlers.get("test:read")?.({}, { id: "bad" }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("[test:read] Invalid input"),
    });
    await expect(handlers.get("test:read")?.({}, { id: 1 })).resolves.toEqual({
      id: "bad",
      name: "Bad",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[test:read] Output validation warning"),
    );

    process.env.NODE_ENV = previousNodeEnv;
  });

  it("serves the same registry through local HTTP with structured envelopes", async () => {
    await startHttpServer(createRepresentativeRegistry());

    await expect(rpc("test:read", { id: 2 })).resolves.toEqual({
      status: 200,
      body: { ok: true, data: { id: 2, name: "App 2" } },
    });
    await expect(rpc("test:mutate", { name: "Web" })).resolves.toEqual({
      status: 200,
      body: { ok: true, data: { ok: true } },
    });
    await expect(rpc("test:integration", { mode: "ok" })).resolves.toEqual({
      status: 200,
      body: { ok: true, data: { provider: "github" } },
    });
  });

  it("maps local HTTP validation, auth, not-found, conflict, and internal failures", async () => {
    const registry = createRepresentativeRegistry();
    registerTypedBackendHandler(
      registry,
      invalidOutputContract,
      async () =>
        ({
          ok: "no",
        }) as never,
    );
    await startHttpServer(registry);

    await expect(rpc("test:read", { id: "bad" })).resolves.toMatchObject({
      status: 400,
      body: {
        ok: false,
        error: expect.stringContaining("[test:read] Invalid input"),
        kind: "validation",
      },
    });
    await expect(rpc("test:integration", { mode: "auth" })).resolves.toEqual({
      status: 401,
      body: { ok: false, error: "Missing provider token", kind: "auth" },
    });
    await expect(
      rpc("test:integration", { mode: "not-found" }),
    ).resolves.toEqual({
      status: 404,
      body: {
        ok: false,
        error: "Repository not found",
        kind: "not_found",
      },
    });
    await expect(
      rpc("test:integration", { mode: "conflict" }),
    ).resolves.toEqual({
      status: 409,
      body: { ok: false, error: "Merge conflict", kind: "conflict" },
    });
    await expect(rpc("test:invalid-output", {})).resolves.toMatchObject({
      status: 500,
      body: {
        ok: false,
        error: expect.stringContaining("[test:invalid-output] Invalid output"),
        kind: "internal",
      },
    });

    const noToken = await nodeFetch(`${baseUrl}/api/rpc/test%3Aread`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({ id: 1 }),
    });
    expect(noToken.status).toBe(401);
    await expect(noToken.json()).resolves.toEqual({
      ok: false,
      error: "Invalid local RPC token",
      kind: "auth",
    });
  });

  async function startHttpServer(
    registry: ReturnType<typeof createTypedBackendRegistry>,
  ) {
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
    });
    registerLocalHttpBackendHandlers(server, registry);
    const listening = await server.listen();
    baseUrl = listening.url;
  }

  async function rpc(
    channel: string,
    input: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const response = await nodeFetch(
      `${baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer local-token",
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify(input),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  }
});

const invalidOutputContract = defineContract({
  channel: "test:invalid-output",
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
});

function createRepresentativeRegistry() {
  const registry = createTypedBackendRegistry({ outputValidation: "throw" });
  registerTypedBackendHandler(
    registry,
    readContract,
    async (_context, input) => ({
      id: input.id,
      name: `App ${input.id}`,
    }),
  );
  registerTypedBackendHandler(registry, mutationContract, async () => ({
    ok: true as const,
  }));
  registerTypedBackendHandler(
    registry,
    integrationContract,
    async (_context, input) => {
      switch (input.mode) {
        case "auth":
          throw new DyadError("Missing provider token", DyadErrorKind.Auth);
        case "not-found":
          throw new DyadError("Repository not found", DyadErrorKind.NotFound);
        case "conflict":
          throw new DyadError("Merge conflict", DyadErrorKind.Conflict);
        case "ok":
          return { provider: "github" };
      }
    },
  );
  return registry;
}

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
