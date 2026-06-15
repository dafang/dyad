import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ipc } from "@/ipc/types";
import { useTranslation } from "react-i18next";
import {
  getWebHostUnsupportedMessage,
  webHostCapabilities,
} from "@/lib/web_host_capabilities";

export function AutoUpdateSwitch() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-auto-update"
        aria-label={t("general.autoUpdate")}
        checked={settings.enableAutoUpdate}
        onCheckedChange={(checked) => {
          updateSettings({ enableAutoUpdate: checked });
          toast(t("general.autoUpdateChanged"), {
            description: t("general.restartRequiredDescription"),
            action: {
              label: t("general.restartDyad"),
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
        }}
      />
      <Label htmlFor="enable-auto-update">{t("general.autoUpdate")}</Label>
    </div>
  );
}
