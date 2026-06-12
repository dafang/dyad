import log from "electron-log";
import type { IpcMainInvokeEvent } from "electron";
import { DyadError } from "@/errors/dyad_error";
import { sendTelemetryException } from "../utils/telemetry";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { getElectronModule } from "../utils/electron_module";

export function createLoggedHandler(logger: log.LogFunctions) {
  return (
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>,
  ) => {
    const ipcMain = getElectronModule<typeof import("electron")>()?.ipcMain;
    if (!ipcMain) {
      throw new Error("Electron ipcMain is not available");
    }
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: any[]) => {
        logger.log(`IPC: ${channel} called with args: ${JSON.stringify(args)}`);
        try {
          const result = await fn(event, ...args);
          logger.log(
            `IPC: ${channel} returned: ${JSON.stringify(result)?.slice(0, 100)}...`,
          );
          return result;
        } catch (error) {
          logger.error(
            `Error in ${fn.name}: args: ${JSON.stringify(args)}`,
            error,
          );
          sendTelemetryException(error, { ipc_channel: channel });
          // Preserve DyadError so telemetry classification stay consistent.
          if (error instanceof DyadError) {
            throw error;
          }
          throw new Error(`[${channel}] ${error}`);
        }
      },
    );
  };
}

export function createTestOnlyLoggedHandler(logger: log.LogFunctions) {
  if (!IS_TEST_BUILD) {
    // Returns a no-op function for non-e2e test builds.
    return () => {};
  }
  return createLoggedHandler(logger);
}
