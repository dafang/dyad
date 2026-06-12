import {
  createClient,
  createHttpInvokeTransport,
  type IpcTransport,
} from "@/ipc/contracts/core";
import { appContracts } from "@/ipc/types/app";
import { chatContracts } from "@/ipc/types/chat";

export interface LocalWebTransportConfig {
  mode: "local-web";
  baseUrl: string;
  token: string;
  eventUrl?: string;
}

export interface LocalWebTransportEnv {
  VITE_DYAD_RUNTIME_MODE?: string;
  VITE_DYAD_LOCAL_WEB_BASE_URL?: string;
  VITE_DYAD_LOCAL_WEB_TOKEN?: string;
  VITE_DYAD_LOCAL_WEB_EVENT_URL?: string;
}

export interface LocalWebClients {
  app: ReturnType<typeof createClient<typeof appContracts>>;
  chat: ReturnType<typeof createClient<typeof chatContracts>>;
}

export class LocalWebTransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalWebTransportConfigError";
  }
}

declare global {
  var __DYAD_LOCAL_WEB_CONFIG__: Partial<LocalWebTransportConfig> | undefined;
}

export function readLocalWebTransportConfig(
  env: LocalWebTransportEnv = getImportMetaEnv(),
  globalConfig:
    | Partial<LocalWebTransportConfig>
    | undefined = globalThis.__DYAD_LOCAL_WEB_CONFIG__,
): LocalWebTransportConfig | null {
  const mode = globalConfig?.mode ?? env.VITE_DYAD_RUNTIME_MODE;
  if (mode !== "local-web") {
    return null;
  }

  const baseUrl = globalConfig?.baseUrl ?? env.VITE_DYAD_LOCAL_WEB_BASE_URL;
  const token = globalConfig?.token ?? env.VITE_DYAD_LOCAL_WEB_TOKEN;
  const eventUrl =
    globalConfig?.eventUrl ??
    env.VITE_DYAD_LOCAL_WEB_EVENT_URL ??
    (baseUrl ? new URL("/api/events", baseUrl).toString() : undefined);
  if (!baseUrl) {
    throw new LocalWebTransportConfigError(
      "Local Web Portal configuration is missing baseUrl",
    );
  }
  if (!token) {
    throw new LocalWebTransportConfigError(
      "Local Web Portal configuration is missing token",
    );
  }

  return {
    mode: "local-web",
    baseUrl,
    token,
    eventUrl,
  };
}

export function createLocalWebClients(
  config: LocalWebTransportConfig,
  fetchImpl: typeof fetch = fetch,
): LocalWebClients {
  const transport = createLocalWebInvokeTransport(config, fetchImpl);
  return {
    app: createClient(appContracts, transport),
    chat: createClient(chatContracts, transport),
  };
}

export function createLocalWebInvokeTransport(
  config: LocalWebTransportConfig,
  fetchImpl: typeof fetch = fetch,
  onStreamEvent?: (event: { channel: string; payload: unknown }) => void,
): IpcTransport {
  return createHttpInvokeTransport({
    baseUrl: config.baseUrl,
    token: config.token,
    fetch: fetchImpl,
    onStreamEvent,
    supportsStreamingInvoke: true,
  });
}

export interface SseEventTransportOptions {
  baseUrl: string;
  token: string;
  eventUrl?: string;
  fetch?: typeof fetch;
  webSocket?: typeof WebSocket | null;
  preferWebSocket?: boolean;
}

export function createLocalWebEventTransport(
  options: SseEventTransportOptions,
): IpcTransport {
  const WebSocketCtor =
    options.webSocket === undefined ? globalThis.WebSocket : options.webSocket;
  if (options.preferWebSocket !== false && WebSocketCtor) {
    return createWebSocketEventTransport({
      ...options,
      webSocket: WebSocketCtor,
    });
  }
  return createSseOnlyEventTransport(options);
}

function createSseOnlyEventTransport(
  options: SseEventTransportOptions,
): IpcTransport {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const listenersByChannel = new Map<string, Set<(payload: unknown) => void>>();
  let controller: AbortController | undefined;
  let connectionReady: Promise<void> | undefined;
  const emit = (channel: string, payload: unknown) => {
    const listeners = listenersByChannel.get(channel);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  };

  const ensureConnected = () => {
    if (controller && !controller.signal.aborted) {
      return;
    }
    controller = new AbortController();
    const url = new URL(options.eventUrl ?? "/api/events", options.baseUrl);
    url.searchParams.set("channel", "*");
    const activeController = controller;
    connectionReady = new Promise<void>((resolve, reject) => {
      readSseStream({
        fetchImpl,
        url,
        token: options.token,
        signal: activeController.signal,
        onOpen: resolve,
        onEvent: (event) => emit(event.event, event.data),
      }).catch((error) => {
        if (!activeController.signal.aborted) {
          reject(error);
        }
      });
    });
  };

  return {
    async invoke(channel: string): Promise<unknown> {
      throw new Error(
        `The configured SSE transport does not support invoke for ${channel}`,
      );
    },
    async ready(): Promise<void> {
      ensureConnected();
      await connectionReady;
    },
    on(
      channel: string,
      listener: (payload: unknown) => void,
      options?: { connect?: boolean },
    ): () => void {
      let listeners = listenersByChannel.get(channel);
      if (!listeners) {
        listeners = new Set();
        listenersByChannel.set(channel, listeners);
      }
      listeners.add(listener);
      if (options?.connect !== false) {
        ensureConnected();
      }
      return () => {
        const currentListeners = listenersByChannel.get(channel);
        if (!currentListeners) {
          return;
        }
        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
          listenersByChannel.delete(channel);
        }
        if (listenersByChannel.size === 0) {
          controller?.abort();
          controller = undefined;
          connectionReady = undefined;
        }
      };
    },
    emit,
  };
}

export function createSseEventTransport(
  options: SseEventTransportOptions,
): IpcTransport {
  return createSseOnlyEventTransport(options);
}

function createWebSocketEventTransport(
  options: SseEventTransportOptions & { webSocket: typeof WebSocket },
): IpcTransport {
  const listenersByChannel = new Map<string, Set<(payload: unknown) => void>>();
  let socket: WebSocket | undefined;
  let sseController: AbortController | undefined;
  let connectionReady: Promise<void> | undefined;

  const emit = (channel: string, payload: unknown) => {
    const listeners = listenersByChannel.get(channel);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  };

  const closeConnection = () => {
    socket?.close();
    socket = undefined;
    sseController?.abort();
    sseController = undefined;
    connectionReady = undefined;
  };

  const startSseFallback = (
    resolve: () => void,
    reject: (error: unknown) => void,
  ) => {
    socket = undefined;
    sseController = new AbortController();
    const activeController = sseController;
    const url = new URL(options.eventUrl ?? "/api/events", options.baseUrl);
    url.searchParams.set("channel", "*");
    readSseStream({
      fetchImpl: options.fetch ?? getDefaultFetch(),
      url,
      token: options.token,
      signal: activeController.signal,
      onOpen: resolve,
      onEvent: (event) => emit(event.event, event.data),
    }).catch((error) => {
      if (!activeController.signal.aborted) {
        reject(error);
      }
    });
  };

  const ensureConnected = () => {
    if (
      (socket &&
        (socket.readyState === options.webSocket.CONNECTING ||
          socket.readyState === options.webSocket.OPEN)) ||
      (sseController && !sseController.signal.aborted)
    ) {
      return;
    }

    connectionReady = new Promise<void>((resolve, reject) => {
      const url = createWebSocketEventUrl(options);
      const activeSocket = new options.webSocket(url);
      socket = activeSocket;
      let opened = false;
      let fallbackStarted = false;
      const fallback = () => {
        if (opened || fallbackStarted) {
          return;
        }
        fallbackStarted = true;
        activeSocket.close();
        startSseFallback(resolve, reject);
      };

      activeSocket.onopen = () => {
        opened = true;
        resolve();
      };
      activeSocket.onmessage = (message) => {
        const parsed = parseWebSocketEvent(message.data);
        if (parsed) {
          emit(parsed.event, parsed.data);
        }
      };
      activeSocket.onerror = fallback;
      activeSocket.onclose = () => {
        if (!opened) {
          fallback();
          return;
        }
        if (socket === activeSocket) {
          socket = undefined;
          connectionReady = undefined;
        }
      };
    });
  };

  return {
    async invoke(channel: string): Promise<unknown> {
      throw new Error(
        `The configured event transport does not support invoke for ${channel}`,
      );
    },
    async ready(): Promise<void> {
      ensureConnected();
      await connectionReady;
    },
    on(
      channel: string,
      listener: (payload: unknown) => void,
      options?: { connect?: boolean },
    ): () => void {
      let listeners = listenersByChannel.get(channel);
      if (!listeners) {
        listeners = new Set();
        listenersByChannel.set(channel, listeners);
      }
      listeners.add(listener);
      if (options?.connect !== false) {
        ensureConnected();
      }
      return () => {
        const currentListeners = listenersByChannel.get(channel);
        if (!currentListeners) {
          return;
        }
        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
          listenersByChannel.delete(channel);
        }
        if (listenersByChannel.size === 0) {
          closeConnection();
        }
      };
    },
    emit,
  };
}

async function readSseStream(input: {
  fetchImpl: typeof fetch;
  url: URL;
  token: string;
  signal: AbortSignal;
  onOpen?(): void;
  onEvent(event: { event: string; data: unknown }): void;
}): Promise<void> {
  try {
    const response = await input.fetchImpl(input.url, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${input.token}`,
      },
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Local event stream failed: ${response.status} ${response.statusText}`,
      );
    }
    if (!response.body) {
      throw new Error("Local event stream response had no body");
    }
    input.onOpen?.();
    await parseSseResponse(response.body, input.onEvent, input.signal);
  } catch (error) {
    if (!input.signal.aborted) {
      throw error;
    }
  }
}

function createWebSocketEventUrl(options: {
  baseUrl: string;
  eventUrl?: string;
  token: string;
}): string {
  const url = new URL(options.eventUrl ?? "/api/events", options.baseUrl);
  if (!url.pathname.endsWith("/ws")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("channel", "*");
  url.searchParams.set("token", options.token);
  return url.toString();
}

function parseWebSocketEvent(
  data: MessageEvent["data"],
): { event: string; data: unknown } | undefined {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(data) as {
      event?: unknown;
      data?: unknown;
    };
    if (typeof parsed.event !== "string") {
      return undefined;
    }
    return {
      event: parsed.event,
      data: parsed.data,
    };
  } catch {
    return undefined;
  }
}

async function parseSseResponse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: { event: string; data: unknown }) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const event = parseSseEvent(part);
        if (event) {
          onEvent(event);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(
  raw: string,
): { event: string; data: unknown } | undefined {
  let event = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!event || dataLines.length === 0) {
    return undefined;
  }
  return {
    event,
    data: JSON.parse(dataLines.join("\n")) as unknown,
  };
}

export function createConfiguredLocalWebClients(
  options: {
    env?: LocalWebTransportEnv;
    globalConfig?: Partial<LocalWebTransportConfig>;
    fetch?: typeof fetch;
  } = {},
): LocalWebClients | null {
  const config = readLocalWebTransportConfig(options.env, options.globalConfig);
  if (!config) {
    return null;
  }
  return createLocalWebClients(config, options.fetch);
}

export function toLocalWebPublicUrl(
  url: string,
  config: LocalWebTransportConfig | null = readLocalWebTransportConfig(),
): string {
  if (!config) {
    return url;
  }

  const parsed = new URL(url);
  const configuredBase = new URL(config.baseUrl);
  if (
    parsed.origin !== configuredBase.origin &&
    (!isLoopbackHost(parsed.hostname) ||
      !isLocalWebPublicRoute(parsed.pathname))
  ) {
    return url;
  }

  return new URL(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
    config.baseUrl,
  ).toString();
}

export function toLocalWebPreviewPublicUrl(
  url: string,
  appId: number,
  config: LocalWebTransportConfig | null = readLocalWebTransportConfig(),
): string {
  if (!config) {
    return url;
  }

  const publicUrl = toLocalWebPublicUrl(url, config);
  const parsed = new URL(publicUrl);
  const configuredBase = new URL(config.baseUrl);
  if (isLocalWebPreviewRouteForApp(parsed.pathname, appId)) {
    return publicUrl;
  }

  if (
    parsed.origin !== configuredBase.origin &&
    !isLoopbackHost(parsed.hostname)
  ) {
    return publicUrl;
  }

  return new URL(
    `/api/preview/${appId}${parsed.pathname}${parsed.search}${parsed.hash}`,
    config.baseUrl,
  ).toString();
}

function isLocalWebPublicRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/preview/") || pathname.startsWith("/api/media/")
  );
}

function isLocalWebPreviewRouteForApp(
  pathname: string,
  appId: number,
): boolean {
  const prefix = `/api/preview/${appId}`;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}

function getImportMetaEnv(): LocalWebTransportEnv {
  return (import.meta as ImportMeta & { env?: LocalWebTransportEnv }).env ?? {};
}

export async function smokeLocalWebConnection(options: {
  baseUrl: string;
  token: string;
  appId: number;
  fetch?: typeof fetch;
}): Promise<{ health: unknown; appName: string }> {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const healthResponse = await fetchImpl(
    new URL("/api/health", options.baseUrl),
  );
  if (!healthResponse.ok) {
    throw new Error(
      `Local Web Portal health check failed: ${healthResponse.status} ${healthResponse.statusText}`,
    );
  }
  const clients = createLocalWebClients(
    {
      mode: "local-web",
      baseUrl: options.baseUrl,
      token: options.token,
    },
    fetchImpl,
  );
  const app = await clients.app.getApp(options.appId);
  return {
    health: await healthResponse.json(),
    appName: app.name,
  };
}

function getDefaultFetch(): typeof fetch {
  return globalThis.fetch.bind(globalThis) as typeof fetch;
}
