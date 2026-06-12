import { z } from "zod";
import type { IpcMainInvokeEvent } from "electron";
import { DyadError } from "@/errors/dyad_error";
import type { IpcContract } from "../contracts/core";
import { sendTelemetryException } from "../utils/telemetry";
import { createTypedBackendRegistry } from "@/server/local_backend_host";
import { registerElectronBackendHandlers } from "./electron_backend_adapter";
import { getElectronModule } from "../utils/electron_module";

/**
 * Creates a typed IPC handler from a contract.
 * Provides runtime validation of inputs and type-safe handler implementation.
 *
 * @example
 * createTypedHandler(appContracts.createApp, async (_event, params) => {
 *   // params is typed as z.infer<CreateAppParamsSchema>
 *   // return type is enforced as z.infer<CreateAppResultSchema>
 *   const [app] = await db.insert(apps).values({ name: params.name }).returning();
 *   return { app, chatId: chat.id };
 * });
 */
export function createTypedHandler<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  contract: IpcContract<TChannel, TInput, TOutput>,
  handler: (
    event: IpcMainInvokeEvent,
    input: z.infer<TInput>,
  ) => Promise<z.infer<TOutput>>,
): void {
  registerSingleElectronTypedHandler(contract, handler, {
    onHandlerError: (err) => {
      sendTelemetryException(err, { ipc_channel: contract.channel });
    },
  });
}

/**
 * Creates a typed IPC handler with logging support.
 * Combines typed handling with the existing logging infrastructure.
 *
 * @example
 * const handle = createLoggedTypedHandler(logger);
 * handle(appContracts.createApp, async (_event, params) => {
 *   return { app, chatId: chat.id };
 * });
 */
export function createLoggedTypedHandler(logger: {
  info: (msg: string) => void;
  error: (msg: string, err?: any) => void;
}) {
  return function <
    TChannel extends string,
    TInput extends z.ZodType,
    TOutput extends z.ZodType,
  >(
    contract: IpcContract<TChannel, TInput, TOutput>,
    handler: (
      event: IpcMainInvokeEvent,
      input: z.infer<TInput>,
    ) => Promise<z.infer<TOutput>>,
  ): void {
    registerSingleElectronTypedHandler(
      contract,
      async (event, input) => {
        logger.info(`[${contract.channel}] Handling request`);
        return handler(event, input);
      },
      {
        onHandlerError: (err) => {
          logger.error(`[${contract.channel}] Handler error`, err);
          sendTelemetryException(err, { ipc_channel: contract.channel });
        },
        onValidationError: (err) => {
          logger.error(`[${contract.channel}] Invalid input`, err);
        },
      },
    );
  };
}

function registerSingleElectronTypedHandler<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  contract: IpcContract<TChannel, TInput, TOutput>,
  handler: (
    event: IpcMainInvokeEvent,
    input: z.infer<TInput>,
  ) => Promise<z.infer<TOutput>>,
  options: {
    onHandlerError: (error: unknown) => void;
    onValidationError?: (error: DyadError) => void;
  },
): void {
  const ipcMain = getElectronModule<typeof import("electron")>()?.ipcMain;
  if (!ipcMain) {
    throw new Error("Electron ipcMain is not available");
  }
  const registry = createTypedBackendRegistry({
    outputValidation: "development-warn",
    warn: (message) => {
      process.stderr.write(`${message}\n`);
    },
  });
  registry.register(contract, ({ native }, input) =>
    handler(native as IpcMainInvokeEvent, input),
  );
  registerElectronBackendHandlers(registry, {
    ipcMain,
    onHandlerError: options.onHandlerError,
    onValidationError: options.onValidationError,
  });
}

/**
 * Helper to register multiple typed handlers at once.
 *
 * @example
 * registerTypedHandlers({
 *   [appContracts.createApp]: async (_event, params) => { ... },
 *   [appContracts.deleteApp]: async (_event, params) => { ... },
 * });
 */
export function registerTypedHandlers<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
>(
  handlers: {
    [K in keyof T]: (
      event: IpcMainInvokeEvent,
      input: z.infer<T[K]["input"]>,
    ) => Promise<z.infer<T[K]["output"]>>;
  },
  contracts: T,
): void {
  for (const [key, contract] of Object.entries(contracts)) {
    const handler = handlers[key as keyof typeof handlers];
    if (handler) {
      // @ts-expect-error zod v4 type inference is not working correctly
      createTypedHandler(contract, handler);
    }
  }
}
