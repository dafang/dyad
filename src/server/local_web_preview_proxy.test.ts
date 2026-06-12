import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { runningApps } from "@/ipc/utils/process_manager";
import { createLocalRpcServer } from "./local_rpc_server";
import {
  createLocalWebPreviewProxyRoutes,
  rewriteLocalWebPreviewResponseText,
} from "./local_web_preview_proxy";

describe("local Web preview proxy response rewriting", () => {
  afterEach(() => {
    runningApps.delete(30);
  });

  it("rewrites absolute Vite and Next asset paths through the preview route", () => {
    const input = [
      '<script type="module" src="/src/App.tsx"></script>',
      'import "/@vite/client";',
      'import value from "/node_modules/.vite/deps/react.js?v=1";',
      '<link rel="stylesheet" href="/_next/static/app.css">',
      '<link rel="preload" href="/__nextjs_font/geist-latin.woff2">',
      "body { background: url('/assets/bg.png'); }",
    ].join("\n");

    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      'src="/api/preview/30/src/App.tsx"',
    );
    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      '"/api/preview/30/@vite/client"',
    );
    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      '"/api/preview/30/node_modules/.vite/deps/react.js?v=1"',
    );
    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      'href="/api/preview/30/_next/static/app.css"',
    );
    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      'href="/api/preview/30/__nextjs_font/geist-latin.woff2"',
    );
    expect(rewriteLocalWebPreviewResponseText(input, 30)).toContain(
      "url('/api/preview/30/assets/bg.png')",
    );
  });

  it("injects a path shim before app scripts run", () => {
    const output = rewriteLocalWebPreviewResponseText(
      '<html><head><script type="module" src="/src/App.tsx"></script></head></html>',
      42,
    );

    expect(output).toContain("data-dyad-local-web-preview-shim");
    expect(output.indexOf("data-dyad-local-web-preview-shim")).toBeLessThan(
      output.indexOf('src="/api/preview/42/src/App.tsx"'),
    );
    expect(output).toContain('var prefix = "/api/preview/42"');
    expect(output).toContain(
      "window.__DYAD_LOCAL_WEB_PREVIEW_PREFIX__ = prefix",
    );
    expect(output).toContain(
      "window.history.replaceState(window.history.state",
    );
  });

  it("rewrites dependency module imports without touching ordinary strings", () => {
    const input = [
      'import { a } from "/node_modules/.vite/deps/react.js?v=1";',
      'import "/@vite/client";',
      'const lazy = import("/src/lazy.tsx");',
      'throw Error("React expected a <head> element");',
      'const label = "/src/not-an-import.ts";',
    ].join("\n");
    const output = rewriteLocalWebPreviewResponseText(
      input,
      42,
      "text/javascript",
      "/node_modules/.vite/deps/react-dom_client.js",
    );

    expect(output).toContain(
      'from "/api/preview/42/node_modules/.vite/deps/react.js?v=1"',
    );
    expect(output).toContain('import "/api/preview/42/@vite/client"');
    expect(output).toContain('import("/api/preview/42/src/lazy.tsx")');
    expect(output).toContain('throw Error("React expected a <head> element")');
    expect(output).toContain('const label = "/src/not-an-import.ts"');
  });

  it("rewrites app source modules without injecting the path shim", () => {
    const output = rewriteLocalWebPreviewResponseText(
      'import "/src/App.tsx"; import "/node_modules/.vite/deps/react.js";',
      42,
      "text/javascript",
      "/src/main.tsx",
    );

    expect(output).not.toContain("data-dyad-local-web-preview-shim");
    expect(output).toContain('"/api/preview/42/src/App.tsx"');
    expect(output).toContain(
      '"/api/preview/42/node_modules/.vite/deps/react.js"',
    );
  });

  it("rewrites Vite HMR websocket paths through the preview route", () => {
    const output = rewriteLocalWebPreviewResponseText(
      [
        'const socketHost = `${null || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/"}`;',
        'const directSocketHost = "localhost:32130/";',
        'const base$1 = "/" || "/";',
        'const base = "/" || "/";',
      ].join("\n"),
      42,
      "text/javascript",
      "/@vite/client",
    );

    expect(output).toContain(
      'const socketHost = `${null || importMetaUrl.hostname}:${hmrPort || importMetaUrl.port}${"/api/preview/42/"}`;',
    );
    expect(output).toContain("const directSocketHost = socketHost;");
    expect(output).toContain('const base$1 = "/api/preview/42/" || "/";');
    expect(output).toContain('const base = "/api/preview/42/" || "/";');
  });

  it("routes service worker requests back through preview when a preview referer is present", () => {
    const [route] = createLocalWebPreviewProxyRoutes();

    const request = {
      url: "/dyad-sw.js",
      headers: {
        referer: "http://127.0.0.1:51975/api/preview/30/",
      },
    };
    expect(route?.matches?.(request as any)).toBe(true);

    expect(
      route?.matches?.({
        url: "/dyad-sw.js",
        headers: {},
      } as any),
    ).toBe(false);
  });

  it("routes root-relative preview subresources with the preview app cookie", () => {
    const [route] = createLocalWebPreviewProxyRoutes();

    expect(
      route?.matches?.({
        url: "/api/preview/30/_next/static/chunks/webpack.js",
        headers: {
          cookie: "dyad_preview_app_id=30",
        },
      } as any),
    ).toBe(true);

    expect(
      route?.matches?.({
        url: "/_next/static/chunks/app/page.js",
        headers: {
          cookie: "dyad_preview_app_id=30",
        },
      } as any),
    ).toBe(true);

    expect(
      route?.matches?.({
        url: "/api/rpc/get-app",
        headers: {
          cookie: "dyad_preview_app_id=30",
        },
      } as any),
    ).toBe(false);

    expect(
      route?.matches?.({
        url: "/chat?id=48&appId=41",
        method: "GET",
        headers: {
          cookie: "dyad_preview_app_id=30",
          accept: "text/html",
        },
      } as any),
    ).toBe(false);

    expect(
      route?.matches?.({
        url: "/",
        method: "GET",
        headers: {
          cookie: "dyad_preview_app_id=30",
          accept: "text/html",
          "sec-fetch-dest": "iframe",
        },
      } as any),
    ).toBe(true);

    expect(
      route?.matches?.({
        url: "/api/user-action",
        method: "POST",
        headers: {
          cookie: "dyad_preview_app_id=30",
          accept: "application/json",
        },
      } as any),
    ).toBe(true);
  });

  it("sets a preview app cookie on rewritten HTML", async () => {
    const upstream = await startChunkedServer({
      contentType: "text/html",
      body: "<html><head></head><body>Hello</body></html>",
    });
    const proxyServer = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebPreviewProxyRoutes(),
    });
    const proxy = await proxyServer.listen();
    runningApps.set(30, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: upstream.url,
      originalUrl: upstream.url,
    });

    try {
      const response = await request(`${proxy.url}/api/preview/30/`);

      expect(response.status).toBe(200);
      expect(response.body).toContain("data-dyad-local-web-preview-shim");
      expect(response.body).toContain("document.cookie = cookie");
      expect(response.headers["set-cookie"]).toContain(
        "dyad_preview_app_id=30; Path=/; SameSite=Lax",
      );
    } finally {
      await proxyServer.close();
      await upstream.close();
    }
  });

  it("removes transfer-encoding when rewritten responses get a content-length", async () => {
    const upstream = await startChunkedServer({
      contentType: "text/javascript",
      body: 'import "/src/App.tsx";',
    });
    const proxyServer = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebPreviewProxyRoutes(),
    });
    const proxy = await proxyServer.listen();
    runningApps.set(30, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: upstream.url,
      originalUrl: upstream.url,
    });

    try {
      const response = await request(`${proxy.url}/api/preview/30/src/main.js`);

      expect(response.status).toBe(200);
      expect(response.body).toContain('import "/api/preview/30/src/App.tsx"');
      expect(response.headers["content-length"]).toBeDefined();
      expect(response.headers["transfer-encoding"]).toBeUndefined();
    } finally {
      await proxyServer.close();
      await upstream.close();
    }
  });

  it("proxies preview subresources selected by cookie back to the running app", async () => {
    const upstream = await startChunkedServer({
      contentType: "text/javascript",
      body: "window.__next_chunk = true;",
    });
    const proxyServer = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebPreviewProxyRoutes(),
    });
    const proxy = await proxyServer.listen();
    runningApps.set(30, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: upstream.url,
      originalUrl: upstream.url,
    });

    try {
      const response = await request(`${proxy.url}/_next/static/chunk.js`, {
        headers: { cookie: "dyad_preview_app_id=30" },
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain("window.__next_chunk = true");
    } finally {
      await proxyServer.close();
      await upstream.close();
    }
  });

  it("proxies preview app POST requests selected by cookie", async () => {
    const upstream = await startEchoServer();
    const proxyServer = createLocalRpcServer({
      token: "token",
      allowedOrigins: ["http://127.0.0.1:5173"],
      routes: createLocalWebPreviewProxyRoutes(),
    });
    const proxy = await proxyServer.listen();
    runningApps.set(30, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
      proxyUrl: upstream.url,
      originalUrl: upstream.url,
    });

    try {
      const response = await request(`${proxy.url}/api/user-action`, {
        method: "POST",
        headers: {
          cookie: "dyad_preview_app_id=30",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ok: true }),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        method: "POST",
        url: "/api/user-action",
        body: '{"ok":true}',
      });
    } finally {
      await proxyServer.close();
      await upstream.close();
    }
  });
});

function startChunkedServer({
  contentType,
  body,
}: {
  contentType: string;
  body: string;
}): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": contentType });
    response.write(body);
    response.end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP server did not expose a TCP address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

function startEchoServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP server did not expose a TCP address"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

function request(
  url: string,
  options: http.RequestOptions & { body?: string } = {},
): Promise<{
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const clientRequest = http.request(
      {
        ...options,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? "GET",
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
    clientRequest.on("error", reject);
    if (options.body) {
      clientRequest.write(options.body);
    }
    clientRequest.end();
  });
}
