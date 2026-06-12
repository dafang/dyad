import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  configureDatabaseUserDataPath,
  initializeDatabase,
} from "@/db";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "@/ipc/shared/language_model_helpers";
import { createDefaultLocalWebIntegrationService } from "./default_local_web_integration_service";

describe("default Local Web integration service", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-local-web-integration-"),
    );
    configureDatabaseUserDataPath(tempDir);
    initializeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists custom OpenAI-compatible providers and models", async () => {
    const service = createDefaultLocalWebIntegrationService();

    expect(
      service.createCustomLanguageModelProvider?.({
        id: "ark-openai",
        name: "Ark OpenAI Compatible",
        apiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      }),
    ).toMatchObject({
      id: "custom::ark-openai",
      name: "Ark OpenAI Compatible",
      type: "custom",
      isCustom: true,
    });
    expect(
      service.createCustomLanguageModel?.({
        providerId: "custom::ark-openai",
        apiName: "MiniMax-M3",
        displayName: "MiniMax M3",
        contextWindow: 100000,
        maxOutputTokens: 8192,
      }),
    ).toBeUndefined();

    await expect(getLanguageModelProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "custom::ark-openai",
          apiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
        }),
      ]),
    );
    await expect(
      getLanguageModels({ providerId: "custom::ark-openai" }),
    ).resolves.toEqual([
      expect.objectContaining({
        apiName: "MiniMax-M3",
        displayName: "MiniMax M3",
        type: "custom",
      }),
    ]);

    expect(
      service.editCustomLanguageModelProvider?.({
        id: "ark-openai",
        name: "Ark Edited",
        apiBaseUrl: "https://ark.example.test/v1",
        envVarName: "ARK_API_KEY",
      }),
    ).toMatchObject({
      id: "custom::ark-openai",
      name: "Ark Edited",
      envVarName: "ARK_API_KEY",
    });
    expect(
      service.deleteCustomModel?.({
        providerId: "custom::ark-openai",
        modelApiName: "MiniMax-M3",
      }),
    ).toBeUndefined();
    await expect(
      getLanguageModels({ providerId: "custom::ark-openai" }),
    ).resolves.toEqual([]);
    expect(
      service.deleteCustomLanguageModelProvider?.({
        providerId: "custom::ark-openai",
      }),
    ).toBeUndefined();
    await expect(getLanguageModelProviders()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "custom::ark-openai" }),
      ]),
    );
  });
});
