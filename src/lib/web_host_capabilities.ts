import { isLocalWebRuntime } from "./runtime_client";

export type WebHostCapability =
  | "open-external-url"
  | "select-directory"
  | "show-item-in-folder"
  | "open-file-path"
  | "screenshot"
  | "restart"
  | "reset"
  | "clipboard";

export interface WebHostCapabilityResult {
  capability: WebHostCapability;
  supported: boolean;
  reason?: string;
  path?: string;
  name?: string;
  canceled?: boolean;
}

export interface WebHostCapabilities {
  readonly isLocalWeb: boolean;
  openExternalUrl(url: string): Promise<WebHostCapabilityResult>;
  selectDirectory(): Promise<WebHostCapabilityResult>;
  showItemInFolder(path: string): Promise<WebHostCapabilityResult>;
  openFilePath(path: string): Promise<WebHostCapabilityResult>;
  takeScreenshot(): Promise<WebHostCapabilityResult>;
  restartApp(): Promise<WebHostCapabilityResult>;
  resetAll(): Promise<WebHostCapabilityResult>;
  writeClipboard(text: string): Promise<WebHostCapabilityResult>;
  readClipboard(): Promise<WebHostCapabilityResult & { text?: string }>;
}

export interface WebHostCapabilitiesOptions {
  localWeb?: boolean;
  window?: Pick<Window, "open">;
  document?: Pick<Document, "createElement" | "body">;
  navigator?: {
    clipboard?: {
      writeText?: (text: string) => Promise<void>;
      readText?: () => Promise<string>;
    };
  };
}

export function createWebHostCapabilities(
  options: WebHostCapabilitiesOptions = {},
): WebHostCapabilities {
  const localWeb = options.localWeb ?? isLocalWebRuntime();
  const browserWindow =
    options.window ?? (typeof window === "undefined" ? undefined : window);
  const browserDocument =
    options.document ??
    (typeof document === "undefined" ? undefined : document);
  const browserNavigator =
    options.navigator ??
    (typeof navigator === "undefined" ? undefined : navigator);

  return {
    isLocalWeb: localWeb,
    async openExternalUrl(url) {
      validateHttpUrl(url);
      if (!browserWindow?.open) {
        return unsupported(
          "open-external-url",
          "External links require a browser window.",
        );
      }
      browserWindow.open(url, "_blank", "noopener,noreferrer");
      return { capability: "open-external-url", supported: true };
    },
    async selectDirectory() {
      if (!localWeb) {
        return unsupported(
          "select-directory",
          "Native folder selection is handled by the desktop app.",
        );
      }
      if (!browserDocument?.createElement || !browserDocument.body) {
        return unsupported(
          "select-directory",
          "Folder selection requires a browser document.",
        );
      }
      return selectDirectoryWithInput(browserDocument);
    },
    async showItemInFolder() {
      return unsupported(
        "show-item-in-folder",
        "Browsers cannot reveal local files in the system file manager.",
      );
    },
    async openFilePath() {
      return unsupported(
        "open-file-path",
        "Browsers cannot open arbitrary local files by path.",
      );
    },
    async takeScreenshot() {
      return unsupported(
        "screenshot",
        "Browser screenshot capture is not available from this Web UI.",
      );
    },
    async restartApp() {
      return unsupported(
        "restart",
        "Restart the local Web server from the terminal where it is running.",
      );
    },
    async resetAll() {
      return unsupported(
        "reset",
        "Reset everything is only available in the desktop app for now.",
      );
    },
    async writeClipboard(text) {
      if (!browserNavigator?.clipboard?.writeText) {
        return unsupported(
          "clipboard",
          "Clipboard write permission is unavailable in this browser.",
        );
      }
      await browserNavigator.clipboard.writeText(text);
      return { capability: "clipboard", supported: true };
    },
    async readClipboard() {
      if (!browserNavigator?.clipboard?.readText) {
        return unsupported(
          "clipboard",
          "Clipboard read permission is unavailable in this browser.",
        );
      }
      return {
        capability: "clipboard",
        supported: true,
        text: await browserNavigator.clipboard.readText(),
      };
    },
  };
}

export const webHostCapabilities = createWebHostCapabilities();

export function getWebHostUnsupportedMessage(
  result: WebHostCapabilityResult,
): string {
  return result.reason ?? "This action is unavailable in Web mode.";
}

function unsupported(
  capability: WebHostCapability,
  reason: string,
): WebHostCapabilityResult {
  return { capability, supported: false, reason };
}

function validateHttpUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("External URL must be http(s)");
  }
}

function selectDirectoryWithInput(
  browserDocument: Pick<Document, "createElement" | "body">,
): Promise<WebHostCapabilityResult> {
  return new Promise((resolve) => {
    const input = browserDocument.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.addEventListener(
      "change",
      () => {
        const firstFile = input.files?.[0];
        input.remove();
        if (!firstFile) {
          resolve({
            capability: "select-directory",
            supported: true,
            canceled: true,
          });
          return;
        }
        const selectedFile = firstFile as File & {
          webkitRelativePath?: string;
        };
        const relativePath =
          selectedFile.webkitRelativePath || selectedFile.name;
        const name =
          relativePath.split("/").filter(Boolean)[0] ?? selectedFile.name;
        resolve({
          capability: "select-directory",
          supported: true,
          path: relativePath,
          name,
          canceled: false,
        });
      },
      { once: true },
    );
    browserDocument.body.append(input);
    input.click();
  });
}
