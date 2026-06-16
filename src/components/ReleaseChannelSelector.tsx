import { useSettings } from "@/hooks/useSettings";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import type { ReleaseChannel } from "@/lib/schemas";
import { useTranslation } from "react-i18next";
import {
  getWebHostUnsupportedMessage,
  webHostCapabilities,
} from "@/lib/web_host_capabilities";

export function ReleaseChannelSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  const handleReleaseChannelChange = (value: ReleaseChannel) => {
    updateSettings({ releaseChannel: value });
    if (value === "stable") {
      toast(t("general.releaseChannelStableToast"), {
        description: t("general.releaseChannelStableToastDescription"),
        action: {
          label: t("general.downloadStable"),
          onClick: () => {
            if (webHostCapabilities.isLocalWeb) {
              void webHostCapabilities.openExternalUrl(
                "https://dyad.sh/download",
              );
              return;
            }
            void ipc.system.openExternalUrl("https://dyad.sh/download");
          },
        },
      });
    } else {
      toast(t("general.releaseChannelBetaToast"), {
        description: t("general.restartRequiredDescription"),
        action: {
          label: t("general.restartBzyai"),
          onClick: async () => {
            if (webHostCapabilities.isLocalWeb) {
              const result = await webHostCapabilities.restartApp();
              toast(t("general.restartFromTerminal"), {
                description: getWebHostUnsupportedMessage(result),
              });
              return;
            }
            await ipc.system.restartDyad();
          },
        },
      });
    }
  };
  const currentReleaseChannelLabel =
    settings.releaseChannel === "beta"
      ? t("general.beta")
      : t("general.stable");

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <label
          htmlFor="release-channel"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("general.releaseChannel")}
        </label>
        <Select
          value={settings.releaseChannel}
          onValueChange={(v) => v && handleReleaseChannelChange(v)}
        >
          <SelectTrigger className="w-32" id="release-channel">
            <SelectValue>{currentReleaseChannelLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">{t("general.stable")}</SelectItem>
            <SelectItem value="beta">{t("general.beta")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        <p>{t("general.releaseChannelDescription")}</p>
      </div>
    </div>
  );
}
