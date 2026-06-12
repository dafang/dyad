import { z } from "zod";

// =============================================================================
// Transport Definitions
// =============================================================================

export interface IpcTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on?(
    channel: string,
    listener: (payload: unknown) => void,
    options?: { connect?: boolean },
  ): () => void;
  ready?(): Promise<void>;
  emit?(channel: string, payload: unknown): void;
  supportsStreamingInvoke?: boolean;
}

export class HttpInvokeAbortError extends Error {
  constructor(
    public readonly channel: string,
    cause: unknown,
  ) {
    super(`HTTP invoke aborted for ${channel}`, { cause });
    this.name = "HttpInvokeAbortError";
  }
}

export interface HttpInvokeTransportOptions {
  baseUrl: string;
  token?: string;
  path?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  onStreamEvent?: (event: {
    channel: string;
    payload: unknown;
  }) => void | undefined;
  supportsStreamingInvoke?: boolean;
}

type HttpInvokeSuccessEnvelope = {
  ok: true;
  data: unknown;
};

type HttpInvokeErrorEnvelope = {
  ok: false;
  error?: string;
  message?: string;
};

type HttpInvokeEnvelope = HttpInvokeSuccessEnvelope | HttpInvokeErrorEnvelope;

const getIpcRenderer = () => (window as any).electron?.ipcRenderer;

const unsupportedTransportOperation = (
  operation: "events" | "streams",
): Error =>
  new Error(
    `The configured IPC transport does not support ${operation}. Use the Electron IPC transport or add ${operation} support to this transport.`,
  );

export function createElectronIpcTransport(): IpcTransport {
  return {
    async invoke(channel: string, input: unknown): Promise<unknown> {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        throw new Error(
          `[${channel}] IPC renderer not available. Make sure this is called from the renderer process.`,
        );
      }
      return ipcRenderer.invoke(channel, input);
    },
    on(channel: string, listener: (payload: unknown) => void): () => void {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        throw new Error(
          `[${channel}] IPC renderer not available. Make sure this is called from the renderer process.`,
        );
      }
      return ipcRenderer.on(channel, listener);
    },
  };
}

export function createHttpInvokeTransport(
  options: HttpInvokeTransportOptions,
): IpcTransport {
  const invokePath = options.path ?? "/api/rpc/:channel";
  const fetchImpl = options.fetch ?? getDefaultFetch();

  return {
    supportsStreamingInvoke: options.supportsStreamingInvoke,
    async invoke(channel: string, input: unknown): Promise<unknown> {
      const url = new URL(
        invokePath.includes(":channel")
          ? invokePath.replace(":channel", encodeURIComponent(channel))
          : invokePath,
        options.baseUrl,
      );
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            ...(options.token
              ? { authorization: `Bearer ${options.token}` }
              : {}),
            ...options.headers,
          },
          body: JSON.stringify(
            invokePath.includes(":channel") ? input : { channel, input },
          ),
        });
      } catch (error) {
        if (isFetchAbortError(error)) {
          throw new HttpInvokeAbortError(channel, error);
        }
        throw error;
      }

      if (isJsonlStreamResponse(response)) {
        return readJsonlInvokeStream(response, options.onStreamEvent);
      }

      const text = await response.text();
      const body = parseHttpInvokeBody(text, channel, response.ok);

      if (!response.ok) {
        const message =
          getHttpEnvelopeErrorMessage(body) ??
          `HTTP invoke failed for ${channel}: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      if (isHttpInvokeEnvelope(body)) {
        if (body.ok) {
          return body.data;
        }
        throw new Error(body.error ?? body.message ?? "HTTP invoke failed");
      }

      return body;
    },
  };
}

function getDefaultFetch(): typeof fetch {
  return globalThis.fetch.bind(globalThis) as typeof fetch;
}

function isJsonlStreamResponse(response: Response): boolean {
  return (
    response.ok &&
    response.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/x-ndjson") === true
  );
}

async function readJsonlInvokeStream(
  response: Response,
  onStreamEvent: HttpInvokeTransportOptions["onStreamEvent"],
): Promise<unknown> {
  if (!response.body) {
    throw new Error("HTTP invoke stream response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: unknown;
  let sawResult = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const item = JSON.parse(line) as
          | { type: "event"; channel: string; payload: unknown }
          | { type: "result"; data: unknown }
          | { type: "error"; error: string }
          | { type: "ready" };
        if (item.type === "event") {
          onStreamEvent?.({ channel: item.channel, payload: item.payload });
        } else if (item.type === "result") {
          sawResult = true;
          result = item.data;
        } else if (item.type === "error") {
          throw new Error(item.error);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!sawResult) {
    throw new Error("HTTP invoke stream ended without a result");
  }
  return result;
}

function isFetchAbortError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.message === "Failed to fetch" ||
    error.message.includes("NetworkError when attempting to fetch resource")
  );
}

function getHttpEnvelopeErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") {
      return record.error;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
  }
  return undefined;
}

function parseHttpInvokeBody(
  text: string,
  channel: string,
  responseOk: boolean,
): unknown {
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!responseOk) {
      return undefined;
    }
    throw new Error(`HTTP invoke returned invalid JSON for ${channel}`, {
      cause: error,
    });
  }
}

function isHttpInvokeEnvelope(body: unknown): body is HttpInvokeEnvelope {
  return (
    body !== null &&
    typeof body === "object" &&
    "ok" in body &&
    typeof (body as { ok: unknown }).ok === "boolean"
  );
}

// =============================================================================
// Contract Type Definitions
// =============================================================================

/**
 * Standard IPC contract for invoke/response pattern.
 * Used for request-response style IPC calls.
 */
export interface IpcContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly input: TInput;
  readonly output: TOutput;
}

/**
 * Event contract for pub/sub pattern (main -> renderer).
 * Used for events pushed from main process to renderer.
 */
export interface EventContract<
  TChannel extends string,
  TPayload extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly payload: TPayload;
}

/**
 * Stream contract for invoke + multiple events pattern.
 * Used for streaming responses (e.g., chat streaming).
 */
export interface StreamContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
> {
  readonly channel: TChannel;
  readonly input: TInput;
  readonly keyField: TKey;
  readonly events: {
    readonly chunk: { channel: string; payload: TChunk };
    readonly end: { channel: string; payload: TEnd };
    readonly error: { channel: string; payload: TError };
  };
}

// =============================================================================
// Contract Factories
// =============================================================================

/**
 * Creates a typed IPC contract definition.
 * Contract = Single Source of Truth for channel name, input schema, and output schema.
 */
export function defineContract<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(contract: {
  channel: TChannel;
  input: TInput;
  output: TOutput;
}): IpcContract<TChannel, TInput, TOutput> {
  return contract;
}

/**
 * Creates a typed event contract definition.
 * Used for main -> renderer pub/sub events.
 */
export function defineEvent<
  TChannel extends string,
  TPayload extends z.ZodType,
>(event: {
  channel: TChannel;
  payload: TPayload;
}): EventContract<TChannel, TPayload> {
  return event;
}

/**
 * Creates a typed stream contract definition.
 * Used for invoke + streaming response pattern.
 */
export function defineStream<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(
  stream: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>,
): StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError> {
  return stream;
}

// =============================================================================
// Type Helpers
// =============================================================================

/** Extract the input type from a contract */
export type ContractInput<T> =
  T extends IpcContract<any, infer I, any> ? z.infer<I> : never;

/** Extract the output type from a contract */
export type ContractOutput<T> =
  T extends IpcContract<any, any, infer O> ? z.infer<O> : never;

/** Extract the channel name from a contract */
export type ContractChannel<T> =
  T extends IpcContract<infer C, any, any> ? C : never;

/** Extract the payload type from an event contract */
export type EventPayload<T> =
  T extends EventContract<any, infer P> ? z.infer<P> : never;

/** Extract the channel name from an event contract */
export type EventChannel<T> = T extends EventContract<infer C, any> ? C : never;

// =============================================================================
// Client Generators
// =============================================================================

/** Type to convert contracts object to client methods */
type ClientFromContracts<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
> = {
  [K in keyof T]: (
    input: z.infer<T[K]["input"]>,
  ) => Promise<z.infer<T[K]["output"]>>;
};

/**
 * Creates a typed client from a contracts object.
 * Each contract key becomes a method name, types are derived automatically.
 *
 * @example
 * const appContracts = {
 *   createApp: defineContract({ channel: "create-app", input: ..., output: ... }),
 *   deleteApp: defineContract({ channel: "delete-app", input: ..., output: ... }),
 * };
 * const appClient = createClient(appContracts);
 * // appClient.createApp(params) - params/result types derived automatically
 */
export function createClient<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
>(
  contracts: T,
  transport: IpcTransport = createElectronIpcTransport(),
): ClientFromContracts<T> {
  const client = {} as ClientFromContracts<T>;
  for (const [methodName, contract] of Object.entries(contracts)) {
    (client as any)[methodName] = async (input: unknown) => {
      return transport.invoke(contract.channel, input);
    };
  }
  return client;
}

// =============================================================================
// Event Client Generator
// =============================================================================

/** Capitalize first letter of a string type */
type Capitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

/** Type to convert event contracts object to event client methods */
type EventClientFromContracts<
  T extends Record<string, EventContract<string, z.ZodType>>,
> = {
  [K in keyof T as `on${Capitalize<string & K>}`]: (
    handler: (payload: z.infer<T[K]["payload"]>) => void,
  ) => () => void; // Returns unsubscribe function
};

/**
 * Creates a typed event client from an events object.
 * Each event key becomes an on<Key> method, types are derived automatically.
 *
 * @example
 * const agentEvents = {
 *   todosUpdate: defineEvent({ channel: "agent-tool:todos-update", payload: ... }),
 * };
 * const agentEventClient = createEventClient(agentEvents);
 * // agentEventClient.onTodosUpdate(handler) -> unsubscribe fn
 */
export function createEventClient<
  T extends Record<string, EventContract<string, z.ZodType>>,
>(
  events: T,
  transport: IpcTransport = createElectronIpcTransport(),
): EventClientFromContracts<T> {
  const client = {} as EventClientFromContracts<T>;

  for (const [key, event] of Object.entries(events)) {
    const methodName = `on${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    (client as any)[methodName] = (handler: (payload: unknown) => void) => {
      if (!transport.on) {
        throw unsupportedTransportOperation("events");
      }

      const listener = (data: unknown) => {
        const parsed = event.payload.safeParse(data);
        if (parsed.success) {
          handler(parsed.data);
        } else {
          console.error(
            `[${event.channel}] Invalid payload:`,
            parsed.error.format(),
          );
        }
      };

      const unsubscribe = transport.on(event.channel, listener);
      return unsubscribe;
    };
  }

  return client;
}

// =============================================================================
// Stream Client Generator
// =============================================================================

/**
 * Creates a typed stream client from a stream contract.
 * Manages callbacks internally and routes events by key field.
 *
 * @example
 * const chatStreamContract = defineStream({
 *   channel: "chat:stream",
 *   input: ChatStreamParamsSchema,
 *   keyField: "chatId",
 *   events: { chunk: ..., end: ..., error: ... },
 * });
 * const chatStreamClient = createStreamClient(chatStreamContract);
 * void chatStreamClient.start({ chatId: 123, prompt: "Hello" }, { onChunk, onEnd, onError });
 */
export function createStreamClient<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(
  contract: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>,
  transport: IpcTransport = createElectronIpcTransport(),
) {
  type Input = z.infer<TInput>;
  // Use string | number for KeyValue to support common key types while
  // maintaining better type safety than unknown. TypeScript cannot infer
  // the exact key type from TInput[TKey] due to Zod v4 type system limitations.
  type KeyValue = string | number;

  const streams = new Map<
    KeyValue,
    {
      onChunk: (data: z.infer<TChunk>) => void;
      onEnd: (data: z.infer<TEnd>) => void;
      onError: (data: z.infer<TError>) => void;
    }
  >();

  let listenersSetUp = false;

  const setupListeners = () => {
    if (listenersSetUp) return;

    if (!transport.on) {
      throw unsupportedTransportOperation("streams");
    }

    const eventSubscriptionOptions = transport.supportsStreamingInvoke
      ? { connect: false }
      : undefined;

    transport.on(
      contract.events.chunk.channel,
      (data: unknown) => {
        const parsed = contract.events.chunk.payload.safeParse(data);
        if (parsed.success) {
          const key = (parsed.data as Record<string, unknown>)[
            contract.keyField
          ] as KeyValue;
          streams.get(key)?.onChunk(parsed.data);
        }
      },
      eventSubscriptionOptions,
    );

    transport.on(
      contract.events.end.channel,
      (data: unknown) => {
        const parsed = contract.events.end.payload.safeParse(data);
        if (parsed.success) {
          const key = (parsed.data as Record<string, unknown>)[
            contract.keyField
          ] as KeyValue;
          streams.get(key)?.onEnd(parsed.data);
          streams.delete(key);
        }
      },
      eventSubscriptionOptions,
    );

    transport.on(
      contract.events.error.channel,
      (data: unknown) => {
        const parsed = contract.events.error.payload.safeParse(data);
        if (parsed.success) {
          const key = (parsed.data as Record<string, unknown>)[
            contract.keyField
          ] as KeyValue;
          streams.get(key)?.onError(parsed.data);
          streams.delete(key);
        }
      },
      eventSubscriptionOptions,
    );

    listenersSetUp = true;
  };

  return {
    /**
     * Start a stream with the given input and callbacks.
     */
    start(
      input: Input,
      callbacks: {
        onChunk: (data: z.infer<TChunk>) => void;
        onEnd: (data: z.infer<TEnd>) => void;
        onError: (data: z.infer<TError>) => void;
      },
    ): Promise<unknown> {
      const key = (input as Record<string, unknown>)[
        contract.keyField
      ] as KeyValue;
      streams.set(key, callbacks);
      setupListeners();

      const waitForTransport = transport.supportsStreamingInvoke
        ? Promise.resolve()
        : (transport.ready?.() ?? Promise.resolve());

      return waitForTransport
        .then(() => transport.invoke(contract.channel, input))
        .catch((err: Error) => {
          if (streams.has(key)) {
            callbacks.onError({
              [contract.keyField]: key,
              error: err.message,
            } as any);
            streams.delete(key);
          }
          return "error";
        });
    },

    /**
     * Cancel a stream by its key value.
     */
    cancel(key: KeyValue): void {
      streams.delete(key);
    },

    /**
     * Check if a stream is active for a given key.
     */
    isActive(key: KeyValue): boolean {
      return streams.has(key);
    },
  };
}

// =============================================================================
// Channel Extraction Helpers
// =============================================================================

/**
 * Extract all invoke channels from a contracts object.
 * Used for building the preload whitelist.
 */
export function getInvokeChannels<
  T extends Record<string, { channel: string }>,
>(contracts: T): T[keyof T]["channel"][] {
  return Object.values(contracts).map((c) => c.channel);
}

/**
 * Extract all receive (event) channels from an events object.
 * Used for building the preload whitelist.
 */
export function getReceiveChannels<
  T extends Record<string, { channel: string }>,
>(events: T): T[keyof T]["channel"][] {
  return Object.values(events).map((e) => e.channel);
}

/**
 * Extract all channels from a stream contract (invoke + events).
 */
export function getStreamChannels<
  TChannel extends string,
  TInput extends z.ZodType,
  TKey extends string,
  TChunk extends z.ZodType,
  TEnd extends z.ZodType,
  TError extends z.ZodType,
>(
  stream: StreamContract<TChannel, TInput, TKey, TChunk, TEnd, TError>,
): { invoke: TChannel; receive: string[] } {
  return {
    invoke: stream.channel,
    receive: [
      stream.events.chunk.channel,
      stream.events.end.channel,
      stream.events.error.channel,
    ],
  };
}
