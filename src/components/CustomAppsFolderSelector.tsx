import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { FolderOpen, RotateCcw } from "lucide-react";
import { webHostCapabilities } from "@/lib/web_host_capabilities";
import { useTranslation } from "react-i18next";
import { HttpInvokeAbortError } from "@/ipc/contracts/core";

export function CustomAppsFolderSelector() {
  const { t } = useTranslation("settings");
  const [isSelectingPath, setIsSelectingPath] = useState(false);
  const [customAppsFolder, setCustomAppsFolder] = useState<string>("");
  const [isPathAvailable, setIsPathAvailable] = useState(true);
  const [isPathDefault, setIsPathDefault] = useState(true);

  useEffect(() => {
    // Fetch path on mount
    fetchCustomAppsFolder();
  }, []);

  const handleSelectCustomAppsFolder = async () => {
    setIsSelectingPath(true);
    try {
      if (webHostCapabilities.isLocalWeb) {
        showError(t("general.customAppsFolder.webModeSelectionUnavailable"));
        return;
      }
      // Call the IPC method to select folder
      const result = await ipc.system.selectCustomAppsFolder();
      if (result.path) {
        // Save the custom path to settings
        await ipc.system.setCustomAppsFolder(result.path);
        await fetchCustomAppsFolder();
        showSuccess(t("general.customAppsFolder.updated"));
      } else if (result.path === null && result.canceled === false) {
        showError(t("general.customAppsFolder.invalidSelection"));
      }
    } catch (error: unknown) {
      if (isTransientInvokeAbort(error)) return;
      showError(
        t("general.customAppsFolder.setFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsSelectingPath(false);
    }
  };

  const handleResetToDefault = async () => {
    try {
      // Clear the custom path
      await ipc.system.setCustomAppsFolder(null);
      // Update UI to show default directory
      await fetchCustomAppsFolder();
      showSuccess(t("general.customAppsFolder.resetSuccess"));
    } catch (error: unknown) {
      if (isTransientInvokeAbort(error)) return;
      showError(
        t("general.customAppsFolder.resetFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const fetchCustomAppsFolder = async () => {
    try {
      const { path, isPathAvailable, isPathDefault } =
        await ipc.system.getCustomAppsFolder();
      setCustomAppsFolder(path);
      setIsPathAvailable(isPathAvailable);
      setIsPathDefault(isPathDefault);
    } catch (error: unknown) {
      if (isTransientInvokeAbort(error)) return;
      showError(
        t("general.customAppsFolder.fetchFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Label className="text-sm font-medium">
            {t("general.customAppsFolder.label")}
          </Label>

          <Button
            onClick={handleSelectCustomAppsFolder}
            disabled={isSelectingPath}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            data-testid="customize-apps-folder-button"
          >
            <FolderOpen className="w-4 h-4" />
            {isSelectingPath
              ? t("general.selecting")
              : t("general.customAppsFolder.selectFolder")}
          </Button>

          {!isPathDefault && (
            <Button
              onClick={handleResetToDefault}
              variant="ghost"
              size="sm"
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              {t("general.resetToDefault")}
            </Button>
          )}
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {isPathDefault
                    ? t("general.customAppsFolder.defaultFolder")
                    : t("general.customAppsFolder.customFolder")}
                </span>
              </div>
              <p
                className={`text-sm font-mono ${isPathAvailable ? "text-gray-700 dark:text-gray-300" : "text-red-800 dark:text-red-400"} break-all max-h-32 overflow-y-auto`}
              >
                {customAppsFolder || t("general.customAppsFolder.loading")}
              </p>
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <p>
            {webHostCapabilities.isLocalWeb
              ? t("general.customAppsFolder.webModeDescription")
              : isPathAvailable
                ? t("general.customAppsFolder.availableDescription")
                : t("general.customAppsFolder.unavailableDescription")}
          </p>
        </div>
      </div>
    </div>
  );
}

function isTransientInvokeAbort(error: unknown): boolean {
  if (error instanceof HttpInvokeAbortError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    error.message === "Failed to fetch" ||
    error.message.includes("HTTP invoke aborted")
  );
}
