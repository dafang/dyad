import { vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

export const app = {
  getPath: vi.fn((name: string) => {
    if (name === "userData") return `${process.cwd()}/userData`;
    if (name === "sessionData") return `${process.cwd()}/userData/session`;
    return process.cwd();
  }),
  on: vi.fn(),
  whenReady: vi.fn(async () => undefined),
};

export const BrowserWindow = {
  getAllWindows: vi.fn(() => []),
  fromWebContents: vi.fn(() => null),
};

export const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    handlers.delete(channel);
  }),
};

export const ipcRenderer = {
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeListener: vi.fn(),
};

export const safeStorage = {
  isEncryptionAvailable: vi.fn(() => false),
  encryptString: vi.fn((value: string) => Buffer.from(value, "utf8")),
  decryptString: vi.fn((value: Buffer) => value.toString("utf8")),
};

export const shell = {
  openExternal: vi.fn(async () => undefined),
};

export const dialog = {
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
};

export const session = {
  defaultSession: {
    clearStorageData: vi.fn(async () => undefined),
  },
};

export const clipboard = {
  readText: vi.fn(() => ""),
  writeText: vi.fn(),
};

export const webFrame = {
  setZoomFactor: vi.fn(),
};

export default {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  safeStorage,
  shell,
  dialog,
  session,
  clipboard,
  webFrame,
};
