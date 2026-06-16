import fs from "node:fs/promises";
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";

import { createServer as createViteServer, type ViteDevServer } from "vite";

import {
  startLocalWebRuntime,
  type LocalWebRuntime,
} from "@/server/local_web_runtime";

const pageHost = process.env.DYAD_LOCAL_WEB_PAGE_HOST ?? "127.0.0.1";
const preferredPagePort = Number.parseInt(
  process.env.DYAD_LOCAL_WEB_PAGE_PORT ?? "5173",
  10,
);
const apiHost = process.env.DYAD_LOCAL_WEB_API_HOST ?? "127.0.0.1";
const apiPort = process.env.DYAD_LOCAL_WEB_API_PORT
  ? Number.parseInt(process.env.DYAD_LOCAL_WEB_API_PORT, 10)
  : undefined;
const localWebToken = process.env.DYAD_LOCAL_WEB_TOKEN;
const configOutputPath =
  process.env.DYAD_LOCAL_WEB_CONFIG_PATH ??
  path.join(os.tmpdir(), "dyad-local-web-config.json");
const userDataPath = process.env.DYAD_LOCAL_WEB_USER_DATA_PATH;
const publicBaseUrl = normalizeOptionalUrl(
  process.env.DYAD_LOCAL_WEB_PUBLIC_BASE_URL,
);

let runtime: LocalWebRuntime | undefined;
let vite: ViteDevServer | undefined;
let pageServer: Server | undefined;
let stopping = false;

async function main(): Promise<void> {
  const page = await reservePageServer(pageHost, preferredPagePort);
  pageServer = page.server;

  runtime = await startLocalWebRuntime({
    allowedOrigins: getAllowedOrigins(page.origin),
    host: apiHost,
    port: apiPort,
    publicBaseUrl,
    token: localWebToken || undefined,
    userDataPath,
    version: "dev-local-web",
  });

  vite = await createViteServer({
    configFile: path.resolve(process.cwd(), "vite.web.config.mts"),
    server: {
      middlewareMode: true,
      allowedHosts: getViteAllowedHosts(),
      hmr: {
        server: page.server,
      },
    },
    appType: "custom",
  });

  page.server.on("request", handlePageRequest);
  await writeLocalWebConfigFile(page.url, runtime);

  console.info("Bzyai Web UI is running");
  console.info(`Web UI: ${page.url}`);
  console.info(`API:    ${runtime.server.info.baseUrl}`);
  console.info(`Config: ${configOutputPath}`);
  console.info("Token:  generated for this local session");
  console.info("Press Ctrl+C to stop.");
}

async function reservePageServer(
  host: string,
  preferredPort: number,
): Promise<{
  server: Server;
  host: string;
  port: number;
  origin: string;
  url: string;
}> {
  try {
    return await createAndListenPageServer(host, preferredPort);
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    return createAndListenPageServer(host, 0);
  }
}

async function createAndListenPageServer(
  host: string,
  port: number,
): Promise<{
  server: Server;
  host: string;
  port: number;
  origin: string;
  url: string;
}> {
  const server = http.createServer();
  const listening = await listen(server, host, port);
  const origin = `http://${listening.host}:${listening.port}`;
  return {
    server,
    host: listening.host,
    port: listening.port,
    origin,
    url: origin,
  };
}

async function handlePageRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!vite || !runtime) {
    sendText(response, 503, "Bzyai Web is still starting");
    return;
  }

  try {
    const originalUrl = request.url ?? "/";
    if (shouldForwardPreviewSubresource(request)) {
      proxyToLocalWebApi(request, response, runtime.server.info.baseUrl);
      return;
    }

    if (isHtmlRequest(originalUrl, request.headers.accept)) {
      await sendWebHtml(originalUrl, response, runtime);
      return;
    }

    await runViteMiddleware(request, response);
    if (!response.writableEnded && !response.destroyed) {
      if (isSpaNavigationRequest(request)) {
        await sendWebHtml(originalUrl, response, runtime);
        return;
      }
      sendText(response, 404, "Not found");
    }
  } catch (error) {
    vite.ssrFixStacktrace(error as Error);
    response.statusCode = 500;
    response.end(error instanceof Error ? error.stack : String(error));
  }
}

function runViteMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      response.off("finish", onFinished);
      response.off("close", onClosed);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onFinished = () => settle();
    const onClosed = () => settle();

    response.once("finish", onFinished);
    response.once("close", onClosed);
    vite!.middlewares(request, response, (error?: unknown) => {
      if (error) {
        fail(error);
        return;
      }
      settle();
    });
  });
}

async function sendWebHtml(
  url: string,
  response: ServerResponse,
  localRuntime: LocalWebRuntime,
): Promise<void> {
  const template = await fs.readFile(
    path.resolve(process.cwd(), "web.html"),
    "utf8",
  );
  const transformed = await vite!.transformIndexHtml(url, template);
  sendHtml(response, injectLocalWebConfig(transformed, localRuntime));
}

function shouldForwardPreviewSubresource(request: IncomingMessage): boolean {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  if (publicBaseUrl && parsed.pathname.startsWith("/api/")) {
    return true;
  }
  if (
    parsed.pathname.startsWith("/api/preview/") ||
    parsed.pathname.startsWith("/api/media/")
  ) {
    return true;
  }
  if (parsed.pathname.startsWith("/api/")) {
    return false;
  }

  if (isPreviewIframeDocumentRequest(parsed.pathname, request)) {
    return true;
  }

  const referer = request.headers.referer;
  if (typeof referer !== "string") {
    return false;
  }

  try {
    return new URL(referer).pathname.startsWith("/api/preview/");
  } catch {
    return false;
  }
}

function isPreviewIframeDocumentRequest(
  pathname: string,
  request: IncomingMessage,
): boolean {
  if (
    pathname !== "/" ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    return false;
  }
  if (!hasPreviewAppCookie(request.headers.cookie)) {
    return false;
  }
  const fetchDest = request.headers["sec-fetch-dest"];
  return typeof fetchDest === "string" && fetchDest.toLowerCase() === "iframe";
}

function hasPreviewAppCookie(
  cookieHeader: string | string[] | undefined,
): boolean {
  const values = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
  return values.some(
    (value) =>
      typeof value === "string" &&
      value
        .split(";")
        .some((part) => part.trim().startsWith("dyad_preview_app_id=")),
  );
}

function proxyToLocalWebApi(
  request: IncomingMessage,
  response: ServerResponse,
  apiBaseUrl: string,
): void {
  const apiUrl = new URL(apiBaseUrl);
  const headers = { ...request.headers, host: apiUrl.host };
  const upstream = http.request(
    {
      protocol: apiUrl.protocol,
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    sendText(response, 502, `Local Web API proxy error: ${error.message}`);
  });

  request.pipe(upstream);
}

function isHtmlRequest(
  url: string,
  acceptHeader: string | string[] | undefined,
): boolean {
  const parsed = new URL(url, "http://127.0.0.1");
  const acceptsHtml = Array.isArray(acceptHeader)
    ? acceptHeader.some((value) => value.includes("text/html"))
    : acceptHeader?.includes("text/html") === true;
  return (
    parsed.pathname === "/web.html" ||
    parsed.pathname === "/" ||
    (acceptsHtml && path.extname(parsed.pathname) === "")
  );
}

function isSpaNavigationRequest(request: IncomingMessage): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  return !parsed.pathname.startsWith("/api/") && !path.extname(parsed.pathname);
}

function injectLocalWebConfig(html: string, localRuntime: LocalWebRuntime) {
  const baseUrl = publicBaseUrl ?? localRuntime.server.info.baseUrl;
  const config = {
    mode: "local-web",
    baseUrl,
    token: localRuntime.server.info.token,
    eventUrl: new URL("/api/events", baseUrl).toString(),
  };
  const script = `<script>globalThis.__DYAD_LOCAL_WEB_CONFIG__=${JSON.stringify(
    config,
  )};</script>`;
  if (html.includes("__DYAD_LOCAL_WEB_CONFIG__")) {
    return html;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }
  return `${script}${html}`;
}

async function writeLocalWebConfigFile(
  webUrl: string,
  localRuntime: LocalWebRuntime,
): Promise<void> {
  const baseUrl = publicBaseUrl ?? localRuntime.server.info.baseUrl;
  const pageUrl = publicBaseUrl ?? webUrl;
  const config = {
    mode: "local-web",
    webUrl: pageUrl,
    pageUrl,
    apiBaseUrl: baseUrl,
    apiUrl: baseUrl,
    baseUrl,
    token: localRuntime.server.info.token,
    eventUrl: new URL("/api/events", baseUrl).toString(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(configOutputPath, JSON.stringify(config, null, 2));
}

function getAllowedOrigins(pageOrigin: string): string[] {
  const origins = new Set([pageOrigin]);
  if (publicBaseUrl) {
    origins.add(new URL(publicBaseUrl).origin);
  }
  return Array.from(origins);
}

function getViteAllowedHosts(): string[] | undefined {
  if (!publicBaseUrl) {
    return undefined;
  }
  return [new URL(publicBaseUrl).host];
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

function listen(
  server: Server,
  host: string,
  port: number,
): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("HTTP server did not expose a TCP address"));
        return;
      }
      resolve({ host, port: address.port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  text: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

function isAddressInUse(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  await Promise.allSettled([
    vite?.close(),
    new Promise<void>((resolve) => {
      if (!pageServer) {
        resolve();
        return;
      }
      pageServer.close(() => resolve());
    }),
    runtime?.close(),
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown()
      .catch((error) => {
        writeError(error);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  });
}

main().catch((error) => {
  writeError(error);
  shutdown()
    .catch((shutdownError) => writeError(shutdownError))
    .finally(() => process.exit(1));
});

function writeError(error: unknown): void {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
}
