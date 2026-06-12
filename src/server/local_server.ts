import { randomBytes } from "node:crypto";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  createLocalRpcServer,
  type LocalRpcServer,
  type LocalRpcServerOptions,
  type LocalRpcAuxiliaryRoute,
} from "./local_rpc_server";

export interface LocalServerOptions {
  allowedOrigins: readonly string[];
  host?: string;
  port?: number;
  token?: string;
  version?: string;
  tokenBytes?: number;
  routes?: readonly LocalRpcAuxiliaryRoute[];
}

export interface LocalServerInfo {
  host: string;
  port: number;
  baseUrl: string;
  token: string;
  config: LocalServerClientConfig;
}

export interface LocalServerClientConfig {
  baseUrl: string;
  rpcPath: "/api/rpc/:channel";
  healthPath: "/api/health";
  mode: "local";
  version: string;
  requiresToken: true;
}

export interface LocalServerInstance {
  rpcServer: LocalRpcServer;
  info: LocalServerInfo;
  close(): Promise<void>;
}

export async function startLocalServer(
  options: LocalServerOptions,
): Promise<LocalServerInstance> {
  const token = options.token ?? generateLocalServerToken(options.tokenBytes);
  const rpcServer = createLocalRpcServer({
    token,
    allowedOrigins: options.allowedOrigins,
    host: options.host,
    port: options.port,
    routes: [
      ...createBootstrapRoutes(options.version ?? "dev"),
      ...(options.routes ?? []),
    ],
  });

  try {
    const listening = await rpcServer.listen();
    const config = createClientConfig(listening.url, options.version ?? "dev");
    return {
      rpcServer,
      info: {
        host: listening.host,
        port: listening.port,
        baseUrl: listening.url,
        token,
        config,
      },
      close: () => rpcServer.close(),
    };
  } catch (error) {
    throw classifyLocalServerStartupError(error);
  }
}

export function generateLocalServerToken(tokenBytes = 32): string {
  if (!Number.isInteger(tokenBytes) || tokenBytes < 32) {
    throw new DyadError(
      "Local server token must use at least 32 random bytes",
      DyadErrorKind.Validation,
    );
  }
  return randomBytes(tokenBytes).toString("base64url");
}

function createBootstrapRoutes(
  version: string,
): NonNullable<LocalRpcServerOptions["routes"]> {
  return [
    {
      method: "GET",
      path: "/api/health",
      requireOrigin: false,
      handle: ({ response, origin }) => {
        sendBootstrapJson(
          response,
          {
            ok: true,
            mode: "local",
            version,
          },
          origin,
        );
      },
    },
    {
      method: "GET",
      path: "/api/config",
      requireOrigin: false,
      handle: ({ request, response, origin }) => {
        const config = createClientConfig(getRequestBaseUrl(request), version);
        sendBootstrapJson(response, { ok: true, config }, origin);
      },
    },
  ];
}

function createClientConfig(
  baseUrl: string,
  version: string,
): LocalServerClientConfig {
  return {
    baseUrl,
    rpcPath: "/api/rpc/:channel",
    healthPath: "/api/health",
    mode: "local",
    version,
    requiresToken: true,
  };
}

function getRequestBaseUrl(request: { headers: { host?: string | string[] } }) {
  const host = request.headers.host;
  if (typeof host !== "string") {
    throw new DyadError("Host header is required", DyadErrorKind.Validation);
  }
  return `http://${host}`;
}

function sendBootstrapJson(
  response: Parameters<
    NonNullable<LocalRpcServerOptions["routes"]>[number]["handle"]
  >[0]["response"],
  body: unknown,
  origin?: string,
): void {
  if (origin) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function classifyLocalServerStartupError(error: unknown): unknown {
  if (isNodeError(error) && error.code === "EADDRINUSE") {
    return new DyadError(
      "Local server port is already in use",
      DyadErrorKind.Conflict,
      { cause: error },
    );
  }
  return error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
