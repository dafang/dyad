import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showInfo } from "@/lib/toast";
import { useTranslation } from "react-i18next";

export function AutoApproveSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = !!settings?.autoApproveChanges;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-approve"
        aria-label={t("workflow.autoApprove")}
        checked={isEnabled}
        onCheckedChange={() => {
          updateSettings({ autoApproveChanges: !isEnabled });
          if (!isEnabled && showToast) {
            showInfo(t("workflow.autoApproveDisableHint"));
          }
        }}
      />
      <Label htmlFor="auto-approve">{t("workflow.autoApprove")}</Label>
    </div>
  );
}
