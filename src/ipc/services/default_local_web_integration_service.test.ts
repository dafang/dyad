import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  configureDatabaseUserDataPath,
  initializeDatabase,
  db,
} from "@/db";
import { apps } from "@/db/schema";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "@/ipc/shared/language_model_helpers";
import { createDefaultLocalWebIntegrationService } from "./default_local_web_integration_service";
import { createLocalWebPathResolver } from "@/server/local_web_paths";
import { createLocalWebSettingsStore } from "@/server/local_web_settings";

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

  it("applies visual editing changes to local app files", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("visual-app");
    await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <div className="p-[4px]">Old copy</div>;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const appId = Number(
      db.insert(apps).values({ name: "Visual App", path: "visual-app" }).run()
        .lastInsertRowid,
    );
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    });

    await service.applyVisualEditingChanges?.({
      appId,
      changes: [
        {
          componentId: "src/App.tsx:2",
          componentName: "div",
          relativePath: "src/App.tsx",
          lineNumber: 2,
          styles: {
            padding: { left: "12px", right: "12px" },
          },
          textContent: "Local Web copy",
        },
      ],
    });

    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toContain("Local Web copy");
    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toContain("px-[12px]");
  });

  it("analyzes components from local app files", async () => {
    const settingsStore = createLocalWebSettingsStore({
      userDataPath: tempDir,
    });
    const pathResolver = createLocalWebPathResolver({
      userDataPath: tempDir,
      settingsStore,
    });
    const appPath = pathResolver.getDyadAppPath("analysis-app");
    await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <section className="hero">Static heading</section>;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const appId = Number(
      db
        .insert(apps)
        .values({ name: "Analysis App", path: "analysis-app" })
        .run().lastInsertRowid,
    );
    const service = createDefaultLocalWebIntegrationService({
      settingsStore,
      pathResolver,
    });

    await expect(
      service.analyzeComponent?.({
        appId,
        componentId: "src/App.tsx:2",
      }),
    ).resolves.toMatchObject({
      isDynamic: false,
      hasStaticText: true,
      hasImage: false,
    });
  });
});
