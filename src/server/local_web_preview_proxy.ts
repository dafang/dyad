import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getRunningAppPreview } from "@/ipc/services/app_runtime_service";
import type { RunningAppPreview } from "@/ipc/types/app";
import type { LocalRpcAuxiliaryRoute } from "./local_rpc_server";

const PREVIEW_ROUTE_PREFIX = "/api/preview";
const PREVIEW_APP_COOKIE = "dyad_preview_app_id";
const HOST_API_PATH_PREFIXES = [
  "/api/rpc",
  "/api/events",
  "/api/health",
  "/api/config",
  "/api/media",
  PREVIEW_ROUTE_PREFIX,
] as const;
const REWRITABLE_CONTENT_TYPES = [
  "text/html",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/css",
] as const;

interface PreviewUpstreamTarget {
  appId: number;
  upstream: URL;
}

export function createLocalWebPreviewProxyRoutes(): LocalRpcAuxiliaryRoute[] {
  const createRoute = (
    method: LocalRpcAuxiliaryRoute["method"],
  ): LocalRpcAuxiliaryRoute => ({
    method,
    path: PREVIEW_ROUTE_PREFIX,
    matches: isPreviewRequest,
    skipOriginCheck: true,
    requireBearerToken: false,
    handle: ({ request, response }) => {
      const target = getPreviewUpstream(request);
      proxyPreviewHttp(request, response, target);
    },
    handleUpgrade: ({ request, socket, head }) => {
      const target = getPreviewUpstream(request);
      proxyPreviewUpgrade(request, socket, head, target.upstream);
    },
  });
  return [createRoute("GET"), createRoute("POST")];
}

export function getLocalWebPreviewUrl({
  appId,
  baseUrl,
}: {
  appId: number;
  baseUrl: string;
}): string {
  return new URL(`${PREVIEW_ROUTE_PREFIX}/${appId}/`, baseUrl).toString();
}

export function toLocalWebRunningAppPreview(
  preview: RunningAppPreview | null,
  baseUrl: string,
): RunningAppPreview | null {
  if (!preview) {
    return null;
  }
  return {
    ...preview,
    appUrl: getLocalWebPreviewUrl({ appId: preview.appId, baseUrl }),
  };
}

function getPreviewUpstream(request: IncomingMessage): PreviewUpstreamTarget {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  const explicitMatch = parsed.pathname.match(
    /^\/api\/preview\/(\d+)(?:\/(.*))?$/,
  );
  const cookieAppId = getPreviewCookieAppId(request);
  const refererMatch =
    explicitMatch ??
    getPreviewRefererPath(parsed, request)?.match(
      /^\/api\/preview\/(\d+)(?:\/(.*))?$/,
    ) ??
    (cookieAppId !== undefined ? [undefined, String(cookieAppId)] : undefined);
  if (!refererMatch) {
    throw new DyadError("Preview route not found", DyadErrorKind.NotFound);
  }

  const appId = Number.parseInt(refererMatch[1], 10);
  const preview = getRunningAppPreview(appId);
  if (!preview) {
    throw new DyadError(
      `App ${appId} is not running`,
      DyadErrorKind.Precondition,
    );
  }

  const previewUrl = new URL(preview.appUrl);
  const pathSuffix = explicitMatch
    ? (explicitMatch[2] ?? "")
    : parsed.pathname === "/"
      ? ""
      : parsed.pathname.slice(1);
  previewUrl.pathname = `/${pathSuffix}`;
  previewUrl.search = parsed.search;
  return {
    appId,
    upstream: previewUrl,
  };
}

function isPreviewRequest(request: IncomingMessage): boolean {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  if (
    parsed.pathname === "/dyad-sw.js" &&
    getPreviewRefererPath(parsed, request)
  ) {
    return true;
  }

  if (
    parsed.pathname === PREVIEW_ROUTE_PREFIX ||
    parsed.pathname.startsWith(`${PREVIEW_ROUTE_PREFIX}/`)
  ) {
    return true;
  }

  if (getPreviewCookieAppId(request) !== undefined) {
    return isCookieScopedPreviewRequest(parsed, request);
  }

  const refererPath = getPreviewRefererPath(parsed, request);
  return Boolean(refererPath?.startsWith(`${PREVIEW_ROUTE_PREFIX}/`));
}

function isHostApiPath(pathname: string): boolean {
  return HOST_API_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isCookieScopedPreviewRequest(
  parsed: URL,
  request: IncomingMessage,
): boolean {
  if (isHostApiPath(parsed.pathname)) {
    return false;
  }

  const refererPath = getPreviewRefererPath(parsed, request);
  if (
    refererPath === "/" ||
    refererPath?.startsWith(`${PREVIEW_ROUTE_PREFIX}/`)
  ) {
    return true;
  }

  if (isPreviewIframeDocumentRequest(parsed.pathname, request)) {
    return true;
  }

  return isLikelyPreviewSubresource(parsed.pathname, request);
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
  const fetchDest = request.headers["sec-fetch-dest"];
  return typeof fetchDest === "string" && fetchDest.toLowerCase() === "iframe";
}

function isLikelyPreviewSubresource(
  pathname: string,
  request: IncomingMessage,
): boolean {
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/__nextjs_font/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@react-refresh") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/assets/") ||
    pathname === "/dyad-sw.js" ||
    pathname === "/favicon.ico"
  ) {
    return true;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return true;
  }

  const accept = request.headers.accept;
  return typeof accept === "string" && !accept.includes("text/html");
}

function getPreviewCookieAppId(request: IncomingMessage): number | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, rawValue] = part.trim().split("=");
    if (rawName !== PREVIEW_APP_COOKIE || !rawValue) {
      continue;
    }
    const value = Number.parseInt(decodeURIComponent(rawValue), 10);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  return undefined;
}

function getPreviewRefererPath(
  parsed: URL,
  request?: IncomingMessage,
): string | undefined {
  const referer = request?.headers.referer;
  if (typeof referer !== "string") {
    return undefined;
  }
  try {
    return new URL(referer, parsed.origin).pathname;
  } catch {
    return undefined;
  }
}

function proxyPreviewHttp(
  request: IncomingMessage,
  response: ServerResponse,
  target: PreviewUpstreamTarget,
): void {
  const { upstream } = target;
  const upstreamRequest = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: `${upstream.pathname}${upstream.search}`,
      headers: rewritePreviewRequestHeaders(request, upstream),
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["content-length"];
      if (shouldRewritePreviewResponse(headers)) {
        const chunks: Buffer[] = [];
        upstreamResponse.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        upstreamResponse.on("end", () => {
          const rewritten = rewriteLocalWebPreviewResponseText(
            Buffer.concat(chunks).toString("utf8"),
            target.appId,
            getContentType(headers),
            upstream.pathname,
          );
          delete headers["transfer-encoding"];
          headers["content-length"] = Buffer.byteLength(rewritten).toString();
          addPreviewCookie(headers, target.appId);
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          response.end(rewritten);
        });
        upstreamResponse.on("error", (error) => {
          response.writeHead(502, {
            "content-type": "text/plain; charset=utf-8",
          });
          response.end(`Preview proxy upstream error: ${error.message}`);
        });
        return;
      }
      addPreviewCookie(headers, target.appId);
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Preview proxy upstream error: ${error.message}`);
  });

  request.pipe(upstreamRequest);
}

export function rewriteLocalWebPreviewResponseText(
  text: string,
  appId: number,
  contentType = "text/html",
  upstreamPath = "/",
): string {
  const previewPrefix = `${PREVIEW_ROUTE_PREFIX}/${appId}`;
  const absolutePathPrefixes =
    "@vite/|@react-refresh|@id/|@fs/|src/|node_modules/|assets/|_next/|__nextjs_font/|favicon\\.ico|vite\\.svg|__vite";
  const quotedAbsolutePath = new RegExp(
    `(["'\`])/(?=(${absolutePathPrefixes}))`,
    "g",
  );
  const cssUrlAbsolutePath = new RegExp(
    `url\\((["']?)/(?=(${absolutePathPrefixes}))`,
    "g",
  );
  const withShim = contentType.includes("text/html")
    ? injectPreviewPathShim(text, appId)
    : text;

  if (upstreamPath.includes("/node_modules/")) {
    return rewriteDependencyModuleImports(withShim, previewPrefix);
  }

  const withPreviewHmr = isViteClientPath(upstreamPath)
    ? rewriteViteClientHmrPaths(withShim, previewPrefix)
    : withShim;

  return rewritePreviewAbsolutePaths({
    text: withPreviewHmr,
    quotedAbsolutePath,
    cssUrlAbsolutePath,
    previewPrefix,
  });
}

function injectPreviewPathShim(text: string, appId: number): string {
  const headMatch = text.match(/<head(\s[^>]*)?>/i);
  if (!headMatch?.[0] || text.includes("data-dyad-local-web-preview-shim")) {
    return text;
  }

  const previewPrefix = `${PREVIEW_ROUTE_PREFIX}/${appId}`;
  const script = `<script data-dyad-local-web-preview-shim>
(function () {
  try {
    var prefix = ${JSON.stringify(previewPrefix)};
    var cookie = ${JSON.stringify(PREVIEW_APP_COOKIE)} + "=" + ${JSON.stringify(
      String(appId),
    )} + "; Path=/; SameSite=Lax";
    window.__DYAD_LOCAL_WEB_PREVIEW_PREFIX__ = prefix;
    document.cookie = cookie;
    if (window.location.pathname === prefix || window.location.pathname.startsWith(prefix + "/")) {
      var appPath = window.location.pathname.slice(prefix.length) || "/";
      window.history.replaceState(window.history.state, "", appPath + window.location.search + window.location.hash);
    }
  } catch (_) {}
})();
</script>`;
  return text.replace(headMatch[0], `${headMatch[0]}${script}`);
}

function addPreviewCookie(
  headers: http.IncomingHttpHeaders,
  appId: number,
): void {
  const previewCookie = `${PREVIEW_APP_COOKIE}=${appId}; Path=/; SameSite=Lax`;
  const setCookie = headers["set-cookie"];
  if (!setCookie) {
    headers["set-cookie"] = [previewCookie];
    return;
  }
  headers["set-cookie"] = Array.isArray(setCookie)
    ? [...setCookie, previewCookie]
    : [setCookie, previewCookie];
}

function rewritePreviewAbsolutePaths({
  text,
  quotedAbsolutePath,
  cssUrlAbsolutePath,
  previewPrefix,
}: {
  text: string;
  quotedAbsolutePath: RegExp;
  cssUrlAbsolutePath: RegExp;
  previewPrefix: string;
}): string {
  return text
    .replace(quotedAbsolutePath, `$1${previewPrefix}/`)
    .replace(cssUrlAbsolutePath, `url($1${previewPrefix}/`);
}

function rewriteDependencyModuleImports(
  text: string,
  previewPrefix: string,
): string {
  return text
    .replace(
      /(\bfrom\s*["'])\/(?=(@vite\/|@react-refresh|@id\/|@fs\/|src\/|node_modules\/|assets\/|_next\/|__vite))/g,
      `$1${previewPrefix}/`,
    )
    .replace(
      /(\bimport\s*["'])\/(?=(@vite\/|@react-refresh|@id\/|@fs\/|src\/|node_modules\/|assets\/|_next\/|__vite))/g,
      `$1${previewPrefix}/`,
    )
    .replace(
      /(\bimport\s*\(\s*["'`])\/(?=(@vite\/|@react-refresh|@id\/|@fs\/|src\/|node_modules\/|assets\/|_next\/|__vite))/g,
      `$1${previewPrefix}/`,
    );
}

function isViteClientPath(upstreamPath: string): boolean {
  return upstreamPath === "/@vite/client";
}

function rewriteViteClientHmrPaths(
  text: string,
  previewPrefix: string,
): string {
  const previewSocketPath = `${previewPrefix}/`;
  return text
    .replace(
      /\bconst socketHost = `\$\{null \|\| importMetaUrl\.hostname\}:\$\{hmrPort \|\| importMetaUrl\.port\}\$\{"\/"\}`;/,
      () =>
        `const socketHost = \`\${null || importMetaUrl.hostname}:\${hmrPort || importMetaUrl.port}\${${JSON.stringify(
          previewSocketPath,
        )}}\`;`,
    )
    .replace(/\bconst directSocketHost = "[^"]*";/, () => {
      return "const directSocketHost = socketHost;";
    })
    .replace(/\bconst (base(?:\$\d+)?) = "\/" \|\| "\/";/g, (_match, name) => {
      return `const ${name} = ${JSON.stringify(previewSocketPath)} || "/";`;
    });
}

function shouldRewritePreviewResponse(
  headers: http.IncomingHttpHeaders,
): boolean {
  if (headers["content-encoding"]) {
    return false;
  }
  const value = getContentType(headers);
  return REWRITABLE_CONTENT_TYPES.some((type) => value.includes(type));
}

function getContentType(headers: http.IncomingHttpHeaders): string {
  const contentType = headers["content-type"];
  return Array.isArray(contentType)
    ? contentType.join(",")
    : (contentType ?? "");
}

function proxyPreviewUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  upstream: URL,
): void {
  const upstreamSocket = net.connect(
    Number(upstream.port || 80),
    upstream.hostname,
    () => {
      upstreamSocket.write(
        `${request.method} ${upstream.pathname}${upstream.search} HTTP/${request.httpVersion}\r\n`,
      );
      const headers = rewritePreviewRequestHeaders(request, upstream);
      for (const [name, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            upstreamSocket.write(`${name}: ${item}\r\n`);
          }
        } else if (value !== undefined) {
          upstreamSocket.write(`${name}: ${value}\r\n`);
        }
      }
      upstreamSocket.write("\r\n");
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    },
  );

  upstreamSocket.on("error", () => {
    socket.destroy();
  });
}

function rewritePreviewRequestHeaders(
  request: IncomingMessage,
  upstream: URL,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {
    ...request.headers,
    host: upstream.host,
  };
  if (typeof headers.origin === "string") {
    headers.origin = upstream.origin;
  }
  if (typeof headers.referer === "string") {
    headers.referer = upstream.origin + upstream.pathname + upstream.search;
  }
  return headers;
}
