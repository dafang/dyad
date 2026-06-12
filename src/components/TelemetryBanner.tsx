import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import React from "react";
import { Button } from "./ui/button";
import { atom, useAtom } from "jotai";
import { useSettings } from "@/hooks/useSettings";

const hideBannerAtom = atom(false);

export function PrivacyBanner() {
  const [hideBanner, setHideBanner] = useAtom(hideBannerAtom);
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  // TODO: Implement state management for banner visibility and user choice
  // TODO: Implement functionality for Accept, Reject, Ask me later buttons
  // TODO: Add state to hide/show banner based on user choice
  if (hideBanner) {
    return null;
  }
  if (settings?.telemetryConsent !== "unset") {
    return null;
  }
  return (
    <div className="fixed bottom-4 left-16 right-3 z-30 max-w-md rounded-lg border border-gray-200 bg-(--background)/90 p-4 shadow-lg backdrop-blur-md sm:left-auto sm:right-4 sm:z-50 dark:border-gray-700">
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Share anonymous data?
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t("telemetry.privacyNotice")}
            <br />
            <a
              onClick={() => {
                ipc.system.openExternalUrl(
                  "https://dyad.sh/docs/policies/privacy-policy",
                );
              }}
              className="cursor-pointer text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="default"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_in" });
            }}
            data-testid="telemetry-accept-button"
          >
            {t("telemetry.acceptAndContinue")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_out" });
            }}
            data-testid="telemetry-reject-button"
          >
            Reject
          </Button>
          <Button
            variant="ghost"
            onClick={() => setHideBanner(true)}
            data-testid="telemetry-later-button"
          >
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}
