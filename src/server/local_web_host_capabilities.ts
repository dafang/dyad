import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export type LocalWebHostCapabilityName =
  | "select-directory"
  | "open-external-url"
  | "show-item-in-folder"
  | "window-control"
  | "clipboard"
  | "screenshot";

export interface LocalWebHostCapabilityResult {
  capability: LocalWebHostCapabilityName;
  supported: boolean;
  reason?: string;
}

export interface LocalWebHostCapabilities {
  selectDirectory(): Promise<LocalWebHostCapabilityResult>;
  openExternalUrl(url: string): Promise<LocalWebHostCapabilityResult>;
  showItemInFolder(path: string): Promise<LocalWebHostCapabilityResult>;
  controlWindow(
    action: "minimize" | "maximize" | "close" | "focus",
  ): Promise<LocalWebHostCapabilityResult>;
  readClipboard(): Promise<LocalWebHostCapabilityResult>;
  captureScreenshot(): Promise<LocalWebHostCapabilityResult>;
}

export function createLocalWebHostCapabilities(): LocalWebHostCapabilities {
  return {
    selectDirectory: async () => unsupported("select-directory"),
    openExternalUrl: async (url) => {
      validateUrl(url);
      return unsupported("open-external-url");
    },
    showItemInFolder: async () => unsupported("show-item-in-folder"),
    controlWindow: async () => unsupported("window-control"),
    readClipboard: async () => unsupported("clipboard"),
    captureScreenshot: async () => unsupported("screenshot"),
  };
}

function unsupported(
  capability: LocalWebHostCapabilityName,
): LocalWebHostCapabilityResult {
  return {
    capability,
    supported: false,
    reason:
      "This action is owned by the browser or operating system and requires an explicit Web replacement.",
  };
}

function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch (error) {
    throw new DyadError(
      "External URL must be http(s)",
      DyadErrorKind.Validation,
      {
        cause: error,
      },
    );
  }
}
