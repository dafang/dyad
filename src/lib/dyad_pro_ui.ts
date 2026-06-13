import { isLocalWebRuntime } from "@/lib/runtime_client";

export function shouldHideDyadProUi(): boolean {
  return isLocalWebRuntime();
}
