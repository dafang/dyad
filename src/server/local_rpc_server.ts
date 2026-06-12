import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { z } from "zod";

import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { IpcContract } from "@/ipc/contracts/core";
import {
  createTypedBackendRegistry,
  type TypedBackendRegistry,
} from "./local_backend_host";

export interface LocalRpcServerOptions {
  token: string;
  allowedOrigins: readonly string[];
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  routes?: readonly LocalRpcAuxiliaryRoute[];
}

export interface LocalRpcRequestContext {
  channel: string;
  request: IncomingMessage;
}

export interface LocalRpcRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  origin?: string;
}

export interface LocalRpcAuxiliaryRoute {
  method: "GET" | "POST";
  path: string;
  matchPrefix?: boolean;
  matches?: (request: IncomingMessage) => boolean;
  skipOriginCheck?: boolean;
  requireOrigin?: boolean;
  requireBearerToken?: boolean;
  handle: (context: LocalRpcRouteContext) => Promise<void> | void;
  handleUpgrade?: (context: {
    request: IncomingMessage;
    socket: Duplex;
    head: Buffer;
    origin?: string;
  }) => Promise<void> | void;
}

export type LocalRpcHandler<TInput, TOutput> = (
  input: TInput,
  context: LocalRpcRequestContext,
) => Promise<TOutput> | TOutput;

export class LocalRpcServer {
  private readonly registry: TypedBackendRegistry;
  private readonly server: Server;
  private readonly options: Required<
    Pick<LocalRpcServerOptions, "host" | "port" | "maxBodyBytes">
  > &
    Omit<LocalRpcServerOptions, "host" | "port" | "maxBodyBytes" | "routes"> & {
      routes: readonly LocalRpcAuxiliaryRoute[];
    };

  constructor(options: LocalRpcServerOptions) {
    if (!options.token) {
      throw new DyadError("Local RPC token is required", DyadErrorKind.Auth);
    }
    if (options.allowedOrigins.length === 0) {
      throw new DyadError(
        "At least one allowed Origin is required",
        DyadErrorKind.Validation,
      );
    }

    const host = options.host ?? "127.0.0.1";
    if (!isLoopbackHost(host)) {
      throw new DyadError(
        "Local RPC server must bind to a loopback host",
        DyadErrorKind.Precondition,
      );
    }

    this.options = {
      ...options,
      host,
      port: options.port ?? 0,
      maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
      routes: options.routes ?? [],
    };
    this.registry = createTypedBackendRegistry({ outputValidation: "throw" });
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.sendError(response, error);
      });
    });
    this.server.on("upgrade", (request, socket, head) => {
      this.handleUpgrade(request, socket, head).catch(() => {
        socket.destroy();
      });
    });
  }

  register<
    TChannel extends string,
    TInput extends z.ZodType,
    TOutput extends z.ZodType,
  >(
    contract: IpcContract<TChannel, TInput, TOutput>,
    handler: LocalRpcHandler<z.infer<TInput>, z.infer<TOutput>>,
  ): void {
    this.registry.register(contract, ({ native }, input) => {
      if (!native) {
        throw new DyadError(
          "Local RPC request context is required",
          DyadErrorKind.Internal,
        );
      }
      return handler(input, native as LocalRpcRequestContext);
    });
  }

  readJsonRequestBody(request: IncomingMessage): Promise<unknown> {
    return readJsonBody(request, this.options.maxBodyBytes);
  }

  listen(): Promise<{ host: string; port: number; url: string }> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(
            new DyadError(
              "Local RPC server did not expose a TCP address",
              DyadErrorKind.Internal,
            ),
          );
          return;
        }
        resolve({
          host: this.options.host,
          port: address.port,
          url: `http://${this.options.host}:${address.port}`,
        });
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.options.port, this.options.host);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  get nodeServer(): Server {
    return this.server;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const auxiliaryRoute = this.findAuxiliaryRoute(request);
    if (auxiliaryRoute) {
      const origin = auxiliaryRoute.skipOriginCheck
        ? undefined
        : auxiliaryRoute.requireOrigin === false && request.method !== "OPTIONS"
          ? this.getAllowedOriginIfPresent(request)
          : this.requireAllowedOrigin(request);
      if (origin) {
        this.setCorsHeaders(response, origin);
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (!routeAcceptsMethod(auxiliaryRoute, request.method)) {
        throw new DyadError("Method not allowed", DyadErrorKind.Validation);
      }
      if (auxiliaryRoute.requireBearerToken) {
        this.requireBearerToken(request);
      }

      await auxiliaryRoute.handle({ request, response, origin });
      return;
    }

    const origin = this.requireAllowedOrigin(request);
    this.setCorsHeaders(response, origin);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== "POST") {
      throw new DyadError("Method not allowed", DyadErrorKind.Validation);
    }

    this.requireBearerToken(request);

    const channel = getChannelFromUrl(request.url);
    const rawBody = await readJsonBody(request, this.options.maxBodyBytes);
    const result = await this.registry
      .invoke(channel, rawBody, {
        channel,
        transport: "local-http",
        native: {
          channel,
          request,
        },
      })
      .catch((error) => {
        if (
          error instanceof DyadError &&
          error.kind === DyadErrorKind.NotFound &&
          error.message === `No typed backend handler registered for ${channel}`
        ) {
          throw new DyadError(
            `No local RPC handler registered for ${channel}`,
            DyadErrorKind.NotFound,
          );
        }
        throw error;
      });

    sendJson(response, 200, { ok: true, data: result }, origin);
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const auxiliaryRoute = this.findAuxiliaryRoute(request);
    if (!auxiliaryRoute?.handleUpgrade) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const origin = auxiliaryRoute.skipOriginCheck
      ? undefined
      : auxiliaryRoute.requireOrigin === false
        ? this.getAllowedOriginIfPresent(request)
        : this.requireAllowedOrigin(request);
    if (auxiliaryRoute.requireBearerToken) {
      this.requireBearerToken(request);
    }

    await auxiliaryRoute.handleUpgrade({ request, socket, head, origin });
  }

  private requireAllowedOrigin(request: IncomingMessage): string {
    const origin = request.headers.origin;
    if (typeof origin !== "string") {
      throw new DyadError("Origin header is required", DyadErrorKind.Auth);
    }
    if (!this.options.allowedOrigins.includes(origin)) {
      throw new DyadError("Origin is not allowed", DyadErrorKind.Auth);
    }
    return origin;
  }

  private getAllowedOriginIfPresent(
    request: IncomingMessage,
  ): string | undefined {
    const origin = request.headers.origin;
    if (origin === undefined) {
      return undefined;
    }
    if (typeof origin !== "string") {
      throw new DyadError("Origin header must be a string", DyadErrorKind.Auth);
    }
    if (!this.options.allowedOrigins.includes(origin)) {
      throw new DyadError("Origin is not allowed", DyadErrorKind.Auth);
    }
    return origin;
  }

  private findAuxiliaryRoute(
    request: IncomingMessage,
  ): LocalRpcAuxiliaryRoute | undefined {
    const parsed = new URL(request.url ?? "/", "http://127.0.0.1");
    const matches = this.options.routes.filter((route) =>
      routeMatchesPath(route, request, parsed),
    );
    if (request.method === "OPTIONS") {
      return matches[0];
    }
    return (
      matches.find((route) => routeAcceptsMethod(route, request.method)) ??
      matches[0]
    );
  }

  private requireBearerToken(request: IncomingMessage): void {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${this.options.token}`) {
      throw new DyadError("Invalid local RPC token", DyadErrorKind.Auth);
    }
  }

  private setCorsHeaders(response: ServerResponse, origin: string): void {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    response.setHeader(
      "access-control-allow-headers",
      "authorization, content-type",
    );
  }

  private sendError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }

    const status = getStatusCode(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(response, status, {
      ok: false,
      error: message,
      kind: isDyadError(error) ? error.kind : DyadErrorKind.Unknown,
    });
  }
}

function routeMatchesPath(
  route: LocalRpcAuxiliaryRoute,
  request: IncomingMessage,
  parsed: URL,
): boolean {
  return route.matches
    ? route.matches(request)
    : route.matchPrefix
      ? parsed.pathname === route.path ||
        parsed.pathname.startsWith(`${route.path}/`)
      : route.path === parsed.pathname;
}

function routeAcceptsMethod(
  route: LocalRpcAuxiliaryRoute,
  method: string | undefined,
): boolean {
  return (
    route.method === method || (route.method === "GET" && method === "HEAD")
  );
}

export function createLocalRpcServer(
  options: LocalRpcServerOptions,
): LocalRpcServer {
  return new LocalRpcServer(options);
}

function getChannelFromUrl(url: string | undefined): string {
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  const prefix = "/api/rpc/";
  if (!parsed.pathname.startsWith(prefix)) {
    throw new DyadError("Unknown local RPC route", DyadErrorKind.NotFound);
  }
  const encodedChannel = parsed.pathname.slice(prefix.length);
  if (!encodedChannel) {
    throw new DyadError("RPC channel is required", DyadErrorKind.Validation);
  }
  return decodeURIComponent(encodedChannel);
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "localhost" ||
    host.startsWith("127.")
  );
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new DyadError(
        "Request body is too large",
        DyadErrorKind.Validation,
      );
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DyadError(
      "Request body must be valid JSON",
      DyadErrorKind.Validation,
      {
        cause: error,
      },
    );
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  if (origin) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function getStatusCode(error: unknown): number {
  if (!isDyadError(error)) {
    return 500;
  }
  switch (error.kind) {
    case DyadErrorKind.Auth:
      return 401;
    case DyadErrorKind.NotFound:
      return 404;
    case DyadErrorKind.Validation:
      return 400;
    case DyadErrorKind.Precondition:
    case DyadErrorKind.Conflict:
      return 409;
    case DyadErrorKind.RateLimited:
      return 429;
    case DyadErrorKind.UserCancelled:
      return 400;
    case DyadErrorKind.External:
    case DyadErrorKind.Internal:
    case DyadErrorKind.Unknown:
      return 500;
  }
}
