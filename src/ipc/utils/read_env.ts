import { shellEnvSync } from "shell-env";
import { isLocalWebRuntimeContext } from "@/runtime/local_web_runtime_context";

// Need to look up run-time env vars this way
// otherwise it doesn't work as expected in MacOs apps:
// https://github.com/sindresorhus/shell-env

let _env: Record<string, string> | null = null;

export function getEnvVar(key: string) {
  const processValue = process.env[key];
  if (processValue !== undefined) {
    return processValue;
  }

  if (isLocalWebRuntimeContext()) {
    return undefined;
  }

  // Cache it
  if (!_env) {
    _env = shellEnvSync();
  }
  return _env[key];
}
