import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type FreeAgentQuotaStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "./useSettings";
import { isDyadProEnabled } from "@/lib/schemas";
import { FREE_AGENT_QUOTA_LIMIT } from "@/lib/free_agent_quota_limit";
import { isLocalWebRuntime } from "@/lib/runtime_client";

const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;
// In test mode, use very short staleTime for faster E2E tests
const STALE_TIME_MS = 30_000;
const TEST_STALE_TIME_MS = 500;

/**
 * Hook to get the free agent quota status for non-Pro users.
 *
 * - Only fetches for non-Pro users (Pro users have unlimited access)
 * - Refetches every 30 minutes to update the UI when quota resets
 * - Returns quota status including messages used, limit, and time until reset
 */
export function useFreeAgentQuota() {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const isPro = settings ? isDyadProEnabled(settings) : false;
  const quotaDisabled = isPro || isLocalWebRuntime();
  const isTestMode = settings?.isTestMode ?? false;

  const {
    data: quotaStatus,
    isLoading,
    error,
  } = useQuery<FreeAgentQuotaStatus, Error, FreeAgentQuotaStatus>({
    queryKey: queryKeys.freeAgentQuota.status,
    queryFn: () => ipc.freeAgentQuota.getFreeAgentQuotaStatus(),
    // Only fetch for non-Pro Electron users. Local Web runs against the
    // user's own local provider settings and is not part of the Basic Agent
    // free quota.
    enabled: !quotaDisabled && !!settings,
    // Refetch periodically to check for quota reset
    refetchInterval: THIRTY_MINUTES_IN_MS,
    // Consider stale after 30 seconds (500ms in test mode for faster E2E tests)
    staleTime: isTestMode ? TEST_STALE_TIME_MS : STALE_TIME_MS,
    // Don't retry on error (e.g., if there's an issue with the DB)
    retry: false,
  });

  const invalidateQuota = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.freeAgentQuota.status,
    });
  };

  return {
    quotaStatus: quotaDisabled ? undefined : quotaStatus,
    isLoading: quotaDisabled ? false : isLoading,
    error: quotaDisabled ? null : error,
    invalidateQuota,
    // Convenience properties for easier consumption
    isQuotaExceeded: quotaDisabled
      ? false
      : (quotaStatus?.isQuotaExceeded ?? false),
    messagesUsed: quotaDisabled ? 0 : (quotaStatus?.messagesUsed ?? 0),
    messagesLimit: quotaDisabled
      ? FREE_AGENT_QUOTA_LIMIT
      : (quotaStatus?.messagesLimit ?? FREE_AGENT_QUOTA_LIMIT),
    messagesRemaining:
      !quotaDisabled && quotaStatus
        ? Math.max(0, quotaStatus.messagesLimit - quotaStatus.messagesUsed)
        : FREE_AGENT_QUOTA_LIMIT,
    hoursUntilReset: quotaDisabled
      ? null
      : (quotaStatus?.hoursUntilReset ?? null),
    resetTime: quotaDisabled ? null : (quotaStatus?.resetTime ?? null),
  };
}
