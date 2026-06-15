import { useSettings } from "@/hooks/useSettings";
import { useFreeAgentQuota } from "@/hooks/useFreeAgentQuota";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChatMode } from "@/lib/schemas";
import { isDyadProEnabled, getEffectiveDefaultChatMode } from "@/lib/schemas";
import { useTranslation } from "react-i18next";
import { isLocalWebRuntime } from "@/lib/runtime_client";

export function DefaultChatModeSelector() {
  const { settings, updateSettings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();
  const { t: tSettings } = useTranslation("settings");
  const { t: tChat } = useTranslation("chat");

  if (!settings) {
    return null;
  }

  const isProEnabled = isDyadProEnabled(settings);
  const isLocalWeb = isLocalWebRuntime();
  // Wait for quota status to load before determining effective default
  const freeAgentQuotaAvailable = !isQuotaLoading && !isQuotaExceeded;
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
    {
      localAgentQuotaRequired: !isLocalWeb,
      localAgentProviderRestrictionRequired: !isLocalWeb,
    },
  );
  // Show Basic Agent option if user is Pro OR if they have free quota available
  const showBasicAgentOption =
    isProEnabled || isLocalWeb || freeAgentQuotaAvailable;

  const handleDefaultChatModeChange = (value: ChatMode) => {
    updateSettings({ defaultChatMode: value });
  };

  const getModeDisplayName = (mode: ChatMode) => {
    switch (mode) {
      case "build":
        return tChat("chatMode.build");
      case "local-agent":
        return isProEnabled || isLocalWeb
          ? tChat("chatMode.agent")
          : tChat("chatMode.basicAgent");
      case "ask":
        return tChat("chatMode.ask");
      case "plan":
        return tChat("chatMode.plan");
      default:
        throw new Error(`Unknown chat mode: ${mode}`);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <label
          htmlFor="default-chat-mode"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {tSettings("workflow.defaultChatMode")}
        </label>
        <Select
          value={effectiveDefault}
          onValueChange={(v) => v && handleDefaultChatModeChange(v)}
        >
          <SelectTrigger className="w-40" id="default-chat-mode">
            <SelectValue>{getModeDisplayName(effectiveDefault)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {showBasicAgentOption && (
              <SelectItem value="local-agent">
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {isProEnabled || isLocalWeb
                      ? tChat("chatMode.agent")
                      : tChat("chatMode.basicAgent")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isProEnabled
                      ? tChat("chatMode.betterAtBiggerTasks")
                      : isLocalWeb
                        ? tChat("chatMode.localProviderDescription")
                        : tChat("chatMode.freeTier")}
                  </span>
                </div>
              </SelectItem>
            )}
            <SelectItem value="build">
              <div className="flex flex-col items-start">
                <span className="font-medium">{tChat("chatMode.build")}</span>
                <span className="text-xs text-muted-foreground">
                  {tChat("chatMode.buildDescription")}
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {tSettings("workflow.defaultChatModeDescription")}
      </div>
    </div>
  );
}
