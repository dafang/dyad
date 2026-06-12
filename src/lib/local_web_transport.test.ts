import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredLocalWebClients,
  createLocalWebClients,
  createLocalWebInvokeTransport,
  createSseEventTransport,
  LocalWebTransportConfigError,
  readLocalWebTransportConfig,
  smokeLocalWebConnection,
  toLocalWebPreviewPublicUrl,
  toLocalWebPublicUrl,
  type LocalWebTransportEnv,
} from "./local_web_transport";

const localWebEnv = {
  VITE_DYAD_RUNTIME_MODE: "local-web",
  VITE_DYAD_LOCAL_WEB_BASE_URL: "http://127.0.0.1:42517",
  VITE_DYAD_LOCAL_WEB_TOKEN: "local-token",
  VITE_DYAD_LOCAL_WEB_EVENT_URL: "http://127.0.0.1:42517/api/events",
} satisfies LocalWebTransportEnv;

describe("local web transport", () => {
  it("returns null for the desktop IPC default mode", () => {
    expect(readLocalWebTransportConfig({}, undefined)).toBeNull();
    expect(createConfiguredLocalWebClients({ env: {} })).toBeNull();
  });

  it("uses HTTP transport with a bearer token in local web mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: createApp(),
        }),
      ),
    );
    const clients = createLocalWebClients(
      {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
      },
      fetchMock,
    );

    await expect(clients.app.getApp(1)).resolves.toMatchObject({
      id: 1,
      name: "Test App",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:42517/api/rpc/get-app",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer local-token",
          "content-type": "application/json",
        }),
        body: JSON.stringify(1),
      }),
    );
  });

  it("marks HTTP invoke transport as streaming-capable for NDJSON stream RPCs", () => {
    const transport = createLocalWebInvokeTransport(
      {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
      },
      vi.fn(),
    );

    expect(transport.supportsStreamingInvoke).toBe(true);
  });

  it("rejects when an NDJSON invoke stream ends without a result envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"type":"ready"}\n', {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/x-ndjson" },
      }),
    );
    const transport = createLocalWebInvokeTransport(
      {
        mode: "local-web",
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
      },
      fetchMock,
    );

    await expect(
      transport.invoke("chat:stream", { chatId: 1 }),
    ).rejects.toThrow("HTTP invoke stream ended without a result");
  });

  it("reads local web config from environment or global config", () => {
    expect(readLocalWebTransportConfig(localWebEnv, undefined)).toEqual({
      mode: "local-web",
      baseUrl: "http://127.0.0.1:42517",
      token: "local-token",
      eventUrl: "http://127.0.0.1:42517/api/events",
    });
    expect(
      readLocalWebTransportConfig(
        {},
        {
          mode: "local-web",
          baseUrl: "http://127.0.0.1:3000",
          token: "global-token",
        },
      ),
    ).toEqual({
      mode: "local-web",
      baseUrl: "http://127.0.0.1:3000",
      token: "global-token",
      eventUrl: "http://127.0.0.1:3000/api/events",
    });
  });

  it("throws explicit config errors without silently falling back to IPC", () => {
    expect(() =>
      readLocalWebTransportConfig(
        { VITE_DYAD_RUNTIME_MODE: "local-web" },
        undefined,
      ),
    ).toThrow(LocalWebTransportConfigError);
    expect(() =>
      createConfiguredLocalWebClients({
        env: {
          VITE_DYAD_RUNTIME_MODE: "local-web",
          VITE_DYAD_LOCAL_WEB_BASE_URL: "http://127.0.0.1:42517",
        },
      }),
    ).toThrow("missing token");
  });

  it("rewrites local runtime URLs to the configured public base URL", () => {
    expect(
      toLocalWebPublicUrl("http://127.0.0.1:51975/api/preview/7/", {
        mode: "local-web",
        baseUrl: "https://dyad.example.test",
        token: "local-token",
        eventUrl: "https://dyad.example.test/api/events",
      }),
    ).toBe("https://dyad.example.test/api/preview/7/");
    expect(
      toLocalWebPublicUrl(
        "http://127.0.0.1:51975/api/media/test-app/.dyad/screenshot/abc.png",
        {
          mode: "local-web",
          baseUrl: "https://dyad.example.test",
          token: "local-token",
          eventUrl: "https://dyad.example.test/api/events",
        },
      ),
    ).toBe(
      "https://dyad.example.test/api/media/test-app/.dyad/screenshot/abc.png",
    );
    expect(
      toLocalWebPublicUrl("http://localhost:3000/", {
        mode: "local-web",
        baseUrl: "https://dyad.example.test",
        token: "local-token",
        eventUrl: "https://dyad.example.test/api/events",
      }),
    ).toBe("http://localhost:3000/");
  });

  it("rewrites local preview server URLs to the configured preview route", () => {
    const config = {
      mode: "local-web" as const,
      baseUrl: "https://dyad.example.test",
      token: "local-token",
      eventUrl: "https://dyad.example.test/api/events",
    };

    expect(
      toLocalWebPreviewPublicUrl("http://localhost:42144/", 44, config),
    ).toBe("https://dyad.example.test/api/preview/44/");
    expect(
      toLocalWebPreviewPublicUrl(
        "http://127.0.0.1:42144/settings?x=1#top",
        44,
        config,
      ),
    ).toBe("https://dyad.example.test/api/preview/44/settings?x=1#top");
    expect(
      toLocalWebPreviewPublicUrl(
        "https://dyad.example.test/api/preview/44/about",
        44,
        config,
      ),
    ).toBe("https://dyad.example.test/api/preview/44/about");
    expect(
      toLocalWebPreviewPublicUrl("https://external.example.test/", 44, config),
    ).toBe("https://external.example.test/");
  });

  it("binds the default fetch implementation for SSE event streams", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: test:event\ndata: {"ok":true}\n\n',
            ),
          );
        },
        cancel() {},
      });
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    try {
      const transport = createSseEventTransport({
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
      });
      const listener = vi.fn();
      const unsubscribe = transport.on!("test:event", listener);

      await expect(transport.ready?.()).resolves.toBeUndefined();
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith({ ok: true }),
      );
      unsubscribe();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("smokes health and one migrated RPC endpoint over HTTP", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "local" }), {
          status: 200,
          statusText: "OK",
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: createApp(),
          }),
          { status: 200, statusText: "OK" },
        ),
      );

    await expect(
      smokeLocalWebConnection({
        baseUrl: "http://127.0.0.1:42517",
        token: "local-token",
        appId: 1,
        fetch: fetchMock,
      }),
    ).resolves.toEqual({
      health: { ok: true, mode: "local" },
      appName: "Test App",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("/api/health", "http://127.0.0.1:42517"),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:42517/api/rpc/get-app",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer local-token",
        }),
      }),
    );
  });
});

function createApp() {
  return {
    id: 1,
    name: "Test App",
    path: "test-app",
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: new Date("2026-06-11T00:00:00.000Z"),
    githubOrg: null,
    githubRepo: null,
    githubBranch: null,
    supabaseProjectId: null,
    supabaseParentProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonDevelopmentBranchId: null,
    neonPreviewBranchId: null,
    neonActiveBranchId: null,
    selectedDatabaseBranchType: null,
    vercelProjectId: null,
    vercelProjectName: null,
    vercelDeploymentUrl: null,
    vercelTeamId: null,
    installCommand: null,
    startCommand: null,
    isFavorite: false,
    collectionId: null,
    files: ["src/App.tsx"],
    frameworkType: "vite",
    resolvedPath: "/apps/test-app",
    supabaseProjectName: null,
    vercelTeamSlug: null,
  };
}
