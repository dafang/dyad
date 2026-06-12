import { createRequire } from "node:module";

const runtimeRequire = createRequire(import.meta.url);
const ELECTRON_MODULE_NAME = "elect" + "ron";

let electronModuleForTest: unknown | undefined;

export function setElectronModuleForTest(module: unknown | undefined): void {
  electronModuleForTest = module;
}

export function getElectronModule<T = unknown>(): T | undefined {
  if (electronModuleForTest) {
    return electronModuleForTest as T;
  }

  if (!process.versions.electron) {
    return undefined;
  }

  try {
    return runtimeRequire(ELECTRON_MODULE_NAME) as T;
  } catch {
    return undefined;
  }
}
