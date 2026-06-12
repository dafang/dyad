import { describe, expect, it } from "vitest";

import { getProviderOptions } from "./provider_options";
import type { UserSettings } from "@/lib/schemas";

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: {
      provider: "openai",
      name: "gpt-5.5",
    },
    providerSettings: {},
    telemetryConsent: "unset",
    telemetryUserId: "test-user",
    hasRunBefore: true,
    experiments: {},
    enableProLazyEditsMode: true,
    enableProSmartFilesContextMode: true,
    selectedChatMode: "local-agent",
    enableAutoFixProblems: false,
    enableAppBlueprint: true,
    enableAutoUpdate: true,
    releaseChannel: "stable",
    selectedTemplateId: "vite-react",
    selectedThemeId: "default",
    isRunning: false,
    enableNativeGit: true,
    enableSandboxScriptExecution: true,
    autoExpandPreviewPanel: true,
    enableContextCompaction: true,
    enablePnpmMinimumReleaseAgeWarning: false,
    previewIdleTimeoutPolicy: "default",
    ...overrides,
  } as UserSettings;
}

describe("getProviderOptions", () => {
  it("disables OpenAI response storage by default", () => {
    const options = getProviderOptions({
      dyadAppId: 1,
      files: [],
      mentionedAppsCodebases: [],
      builtinProviderId: "openai",
      settings: buildSettings(),
    });

    expect(options.openai).toMatchObject({
      store: false,
    });
  });

  it("passes store=false through custom OpenAI-compatible provider options", () => {
    const options = getProviderOptions({
      dyadAppId: 1,
      files: [],
      mentionedAppsCodebases: [],
      builtinProviderId: undefined,
      settings: buildSettings({
        selectedModel: {
          provider: "custom::sub2api",
          name: "gpt-5.5",
          customModelId: 2,
        },
      }),
    });

    expect(options.openaiCompatible).toMatchObject({
      store: false,
    });
    expect(options["custom::sub2api"]).toMatchObject({
      store: false,
    });
  });
});
