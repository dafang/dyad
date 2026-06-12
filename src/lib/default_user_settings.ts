import { v4 as uuidv4 } from "uuid";

import type { UserSettings } from "./schemas";
import { DEFAULT_TEMPLATE_ID } from "@/shared/templates";
import { DEFAULT_THEME_ID } from "@/shared/themes";

export const DEFAULT_SETTINGS: UserSettings = {
  selectedModel: {
    name: "auto",
    provider: "auto",
  },
  providerSettings: {},
  telemetryConsent: "unset",
  telemetryUserId: uuidv4(),
  hasRunBefore: false,
  experiments: {},
  enableProLazyEditsMode: true,
  enableProSmartFilesContextMode: true,
  selectedChatMode: "build",
  enableAutoFixProblems: false,
  enableAppBlueprint: true,
  enableAutoUpdate: true,
  releaseChannel: "stable",
  selectedTemplateId: DEFAULT_TEMPLATE_ID,
  selectedThemeId: DEFAULT_THEME_ID,
  isRunning: false,
  lastKnownPerformance: undefined,
  enableNativeGit: true,
  enableSandboxScriptExecution: true,
  autoExpandPreviewPanel: true,
  enableContextCompaction: true,
  enablePnpmMinimumReleaseAgeWarning: false,
  previewIdleTimeoutPolicy: "default",
};
