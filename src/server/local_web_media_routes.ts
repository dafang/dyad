import fs from "node:fs";
import path from "node:path";
import { type IncomingMessage } from "node:http";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getMimeType } from "@/ipc/utils/mime_utils";
import {
  DYAD_MEDIA_DIR_NAME,
  DYAD_SCREENSHOT_DIR_NAME,
} from "@/ipc/utils/media_path_utils";
import type { LocalWebPathResolver } from "./local_web_paths";
import type { LocalRpcAuxiliaryRoute } from "./local_rpc_server";

const MEDIA_ROUTE_PREFIX = "/api/media";
const ALLOWED_DYAD_SUBDIRS = [
  DYAD_MEDIA_DIR_NAME,
  DYAD_SCREENSHOT_DIR_NAME,
] as const;

export function createLocalWebMediaRoutes({
  pathResolver,
}: {
  pathResolver: LocalWebPathResolver;
}): LocalRpcAuxiliaryRoute[] {
  return [
    {
      method: "GET",
      path: MEDIA_ROUTE_PREFIX,
      matchPrefix: true,
      requireOrigin: false,
      requireBearerToken: false,
      handle: async ({ request, response, origin }) => {
        const filePath = resolveLocalWebMediaFilePath({
          request,
          pathResolver,
        });
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
          throw new DyadError("Media file not found", DyadErrorKind.NotFound);
        }

        response.writeHead(200, {
          "content-type": getMimeType(path.extname(filePath)),
          "cache-control": "private, max-age=3600",
          ...(origin ? { "access-control-allow-origin": origin } : {}),
        });
        fs.createReadStream(filePath).pipe(response);
      },
    },
  ];
}

export function getLocalWebMediaUrl({
  appPath,
  dyadRelativePath,
  baseUrl,
}: {
  appPath: string;
  dyadRelativePath: string;
  baseUrl: string;
}): string {
  assertAllowedDyadRelativePath(dyadRelativePath);
  const normalized = normalizeRoutePath(dyadRelativePath);
  return new URL(
    `${MEDIA_ROUTE_PREFIX}/${encodeURIComponent(appPath)}/${normalized
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    baseUrl,
  ).toString();
}

function resolveLocalWebMediaFilePath({
  request,
  pathResolver,
}: {
  request: IncomingMessage;
  pathResolver: LocalWebPathResolver;
}): string {
  const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
  const prefix = `${MEDIA_ROUTE_PREFIX}/`;
  if (!parsed.pathname.startsWith(prefix)) {
    throw new DyadError("Media route not found", DyadErrorKind.NotFound);
  }

  const routeParts = parsed.pathname.slice(prefix.length).split("/");
  const appPath = decodeURIComponent(routeParts.shift() ?? "");
  if (!appPath) {
    throw new DyadError("Media app path is required", DyadErrorKind.Validation);
  }

  const dyadRelativePath = routeParts.map(decodeURIComponent).join("/");
  assertAllowedDyadRelativePath(dyadRelativePath);

  const appRoot = pathResolver.getDyadAppPath(appPath);
  const filePath = path.resolve(appRoot, dyadRelativePath);
  const relativeToApp = path.relative(path.resolve(appRoot), filePath);
  if (relativeToApp.startsWith("..") || path.isAbsolute(relativeToApp)) {
    throw new DyadError("Media path escapes app root", DyadErrorKind.Auth);
  }
  return filePath;
}

function assertAllowedDyadRelativePath(dyadRelativePath: string): void {
  const normalized = normalizeRoutePath(dyadRelativePath);
  const isAllowed = ALLOWED_DYAD_SUBDIRS.some((allowedSubdir) => {
    const allowed = normalizeRoutePath(allowedSubdir);
    return normalized === allowed || normalized.startsWith(`${allowed}/`);
  });
  if (!isAllowed) {
    throw new DyadError(
      "Media path must be inside a Dyad media directory",
      DyadErrorKind.Auth,
    );
  }
}

function normalizeRoutePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new DyadError("Invalid media path", DyadErrorKind.Validation);
  }
  return normalized;
}
