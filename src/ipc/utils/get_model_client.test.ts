import { beforeEach, describe, expect, test, vi } from "vitest";

import type { UserSettings } from "../../lib/schemas";
import { getModelClient } from "./get_model_client";

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn((options?: unknown) => ({
    responses: (modelId: string) => ({
      modelId,
      providerOptions: options,
    }),
  })),
  createOpenAICompatible: vi.fn((options?: unknown) => (modelId: string) => ({
    modelId,
    providerOptions: options,
  })),
  envVars: {} as Record<string, string | undefined>,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
  OpenAICompatibleChatLanguageModel: class {
    modelId: string;

    constructor(modelId: string) {
      this.modelId = modelId;
    }
  },
}));

vi.mock("./read_env", () => ({
  getEnvVar: vi.fn((key: string) => mocks.envVars[key]),
}));

vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModelProviders: vi.fn(async () => [
    {
      id: "auto",
      name: "Dyad",
      gatewayPrefix: "dyad/",
      type: "cloud",
    },
    {
      id: "openai",
      name: "OpenAI",
      gatewayPrefix: "",
      envVarName: "OPENAI_API_KEY",
      type: "cloud",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      gatewayPrefix: "anthropic/",
      type: "cloud",
    },
    {
      id: "google",
      name: "Google",
      gatewayPrefix: "gemini/",
      type: "cloud",
    },
    {
      id: "custom::sub2api",
      name: "sub2api",
      apiBaseUrl: "https://sub2global.bzy.ai",
      type: "custom",
    },
    {
      id: "custom::ark-openai",
      name: "Ark OpenAI Compatible",
      apiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      type: "custom",
    },
  ]),
}));

vi.mock("../shared/remote_language_model_catalog", () => ({
  resolveBuiltinModelAlias: vi.fn(async (aliasId: string) => {
    switch (aliasId) {
      case "dyad/auto/openai":
        return {
          providerId: "openai",
          apiName: "gpt-5.5",
        };
      case "dyad/auto/anthropic":
        return {
          providerId: "anthropic",
          apiName: "claude-sonnet-4-20250514",
        };
      case "dyad/auto/google":
        return {
          providerId: "google",
          apiName: "gemini-3-flash-preview",
        };
      default:
        return null;
    }
  }),
}));

describe("getModelClient", () => {
  beforeEach(() => {
    mocks.createOpenAI.mockClear();
    mocks.createOpenAICompatible.mockClear();
    for (const key of Object.keys(mocks.envVars)) {
      delete mocks.envVars[key];
    }
  });

  test("keeps the Anthropic gateway prefix for Dyad Engine models", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "anthropic",
        name: "claude-sonnet-4-20250514",
      },
      {
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  test("keeps the Anthropic gateway prefix for Dyad Engine auto-mode fallback models", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "auto",
        name: "auto",
      },
      {
        enableDyadPro: true,
        selectedChatMode: "local-agent",
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    const fallbackModels = (
      modelClient.model as unknown as {
        settings: { models: Array<{ modelId: string }> };
      }
    ).settings.models;

    expect(fallbackModels.map((model) => model.modelId)).toEqual([
      "gpt-5.5",
      "anthropic/claude-sonnet-4-20250514",
      "gemini/gemini-3-flash-preview",
    ]);
  });

  test("passes OPENAI_BASE_URL to the built-in OpenAI provider", async () => {
    mocks.envVars.OPENAI_BASE_URL = "https://sub2global.bzy.ai";

    const { modelClient } = await getModelClient(
      {
        provider: "openai",
        name: "gpt-5.5",
      },
      {
        providerSettings: {
          openai: {
            apiKey: {
              value: "openai-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://sub2global.bzy.ai",
    });
    expect((modelClient.model as { modelId: string }).modelId).toBe("gpt-5.5");
  });

  test("treats the legacy __env__ placeholder as environment-backed", async () => {
    mocks.envVars.OPENAI_API_KEY = "openai-env-key";

    await getModelClient(
      {
        provider: "openai",
        name: "gpt-5.5",
      },
      {
        providerSettings: {
          openai: {
            apiKey: {
              value: "__env__",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "openai-env-key",
    });
  });

  test("normalizes custom OpenAI-compatible provider origin URLs to /v1", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "custom::sub2api",
        name: "gpt-5.5",
      },
      {
        providerSettings: {
          "custom::sub2api": {
            apiKey: {
              value: "sub2-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "custom::sub2api",
      baseURL: "https://sub2global.bzy.ai/v1",
      apiKey: "sub2-key",
    });
    expect((modelClient.model as { modelId: string }).modelId).toBe("gpt-5.5");
  });

  test("preserves custom OpenAI-compatible provider URLs that already include a path", async () => {
    await getModelClient(
      {
        provider: "custom::ark-openai",
        name: "MiniMax-M3",
      },
      {
        providerSettings: {
          "custom::ark-openai": {
            apiKey: {
              value: "ark-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "custom::ark-openai",
      baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
      apiKey: "ark-key",
    });
  });
});
