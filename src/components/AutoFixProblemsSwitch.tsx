import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

import { showInfo } from "@/lib/toast";

export function AutoFixProblemsSwitch({
  showToast = false,
}: {
  showToast?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const isEnabled = !!settings?.enableAutoFixProblems;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="auto-fix-problems"
        aria-label="Auto-fix problems"
        checked={isEnabled}
        onCheckedChange={() => {
          updateSettings({
            enableAutoFixProblems: !isEnabled,
          });
          if (!isEnabled && showToast) {
            showInfo("You can disable Auto-fix problems in the Settings page.");
          }
        }}
      />
      <Label htmlFor="auto-fix-problems">{t("workflow.autoFixProblems")}</Label>
    </div>
  );
}
