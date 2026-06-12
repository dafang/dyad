import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type TypedBackendRegistry,
  type TypedBackendRegistryOptions,
} from "@/server/local_backend_host";

export interface ElectronBackendAdapterOptions extends Pick<
  TypedBackendRegistryOptions,
  "onHandlerError" | "onValidationError"
> {
  ipcMain: Pick<IpcMain, "handle">;
}

export function registerElectronBackendHandlers(
  registry: TypedBackendRegistry,
  options: ElectronBackendAdapterOptions,
): void {
  for (const contract of registry.entries()) {
    options.ipcMain.handle(
      contract.channel,
      (event: IpcMainInvokeEvent, rawInput: unknown) =>
        registry.invoke(
          contract.channel,
          rawInput,
          {
            channel: contract.channel,
            transport: "electron",
            native: event,
          },
          {
            onHandlerError: options.onHandlerError,
            onValidationError: options.onValidationError,
          },
        ),
    );
  }
}
