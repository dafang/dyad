import { useMemo } from "react";

import { getEffectiveDefaultChatMode, type ChatMode } from "@/lib/schemas";
import { isLocalWebRuntime } from "@/lib/runtime_client";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { useSettings } from "./useSettings";

export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const isLocalWeb = isLocalWebRuntime();

  return useMemo(() => {
    if (!settings) {
      return undefined;
    }

    if (settings.selectedChatMode) {
      return settings.selectedChatMode;
    }

    if (isQuotaLoading) {
      return undefined;
    }

    return getEffectiveDefaultChatMode(settings, envVars, !isQuotaExceeded, {
      localAgentQuotaRequired: !isLocalWeb,
      localAgentProviderRestrictionRequired: !isLocalWeb,
    });
  }, [envVars, isLocalWeb, isQuotaExceeded, isQuotaLoading, settings]);
}
