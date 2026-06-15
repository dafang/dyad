import { Bell } from "lucide-react";
import { SkippableBanner } from "./SkippableBanner";
import { MacNotificationGuideDialog } from "../MacNotificationGuideDialog";
import { useEnableNotifications } from "@/hooks/useEnableNotifications";
import { useSettings } from "@/hooks/useSettings";
import { useTranslation } from "react-i18next";

export function NotificationBanner() {
  const { t } = useTranslation("chat");
  const { settings, updateSettings } = useSettings();
  const { enable, showMacGuide, setShowMacGuide } = useEnableNotifications();

  const showBanner =
    settings &&
    settings.enableChatEventNotifications !== true &&
    settings.skipNotificationBanner !== true;

  const handleSkip = () => {
    updateSettings({ skipNotificationBanner: true });
  };

  return (
    <>
      {showBanner && (
        <SkippableBanner
          icon={Bell}
          message={t("notification.message")}
          enableLabel={t("notification.enable")}
          dismissLabel={t("notification.dismiss")}
          onEnable={enable}
          onSkip={handleSkip}
          data-testid="notification-tip-banner"
        />
      )}
      <MacNotificationGuideDialog
        open={showMacGuide}
        onClose={() => setShowMacGuide(false)}
      />
    </>
  );
}
