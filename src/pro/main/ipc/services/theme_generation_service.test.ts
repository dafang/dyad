import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";
import {
  createThemeGenerationService,
  LOCAL_WEB_SELECTED_THEME_MODEL_ID,
  type ThemeGenerationServiceDeps,
} from "./theme_generation_service";

const testModel = {} as any;

describe("theme generation service", () => {
  let tempRoot: string;
  let tempDir: string;
  let deps: ThemeGenerationServiceDeps;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-theme-generation-service-"),
    );
    tempDir = path.join(tempRoot, "theme-images");
    deps = {
      tempDir,
      readSettings: vi.fn(() => createSettings()),
      resolveModelAlias: vi.fn(async (aliasId: string) =>
        aliasId === "theme-model"
          ? { providerId: "openai", apiName: "gpt-theme" }
          : null,
      ),
      getModelClient: vi.fn(async () => ({
        modelClient: {
          model: testModel,
        },
      })),
      streamText: vi.fn(() => ({
        textStream: streamChunks(["<theme>", "generated", "</theme>"]),
      })),
      cancelOrphanedBaseStream: vi.fn(),
      prompts: {
        inspired: "inspired prompt",
        "high-fidelity": "high fidelity prompt",
      },
      now: () => 1234567890,
      random: () => 0.123456789,
    };
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("saves accepted image extensions under the service temp directory", async () => {
    const service = createThemeGenerationService(deps);

    const result = await service.saveThemeImage({
      data: Buffer.from("image-bytes").toString("base64"),
      filename: "reference.PNG",
    });

    expect(result.path).toMatch(
      new RegExp(`${escapeRegExp(tempDir)}.*\\.png$`),
    );
    await expect(fs.promises.readFile(result.path, "utf-8")).resolves.toBe(
      "image-bytes",
    );
  });

  it("rejects unsupported image extensions", async () => {
    const service = createThemeGenerationService(deps);

    await expect(
      service.saveThemeImage({
        data: Buffer.from("image-bytes").toString("base64"),
        filename: "reference.svg",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("Invalid image extension"),
    });
  });

  it("rejects image data above the 10MB limit", async () => {
    const service = createThemeGenerationService(deps);

    await expect(
      service.saveThemeImage({
        data: "a".repeat(Math.ceil((10 * 1024 * 1024 * 4) / 3) + 4),
        filename: "huge.png",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Image size exceeds 10MB limit",
    });
  });

  it("refuses to cleanup paths outside the service temp directory", async () => {
    const service = createThemeGenerationService(deps);

    await expect(
      service.cleanupThemeImages({
        paths: [path.join(tempRoot, "outside.png")],
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Invalid path: cannot delete files outside temp directory",
    });
  });

  it("cleans up files under the service temp directory", async () => {
    const service = createThemeGenerationService(deps);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "reference.png");
    await fs.promises.writeFile(imagePath, "image-bytes", "utf-8");

    await service.cleanupThemeImages({ paths: [imagePath] });

    expect(fs.existsSync(imagePath)).toBe(false);
  });

  it("validates prompt generation inputs before resolving a model", async () => {
    const service = createThemeGenerationService(deps);

    await expect(
      service.generateThemePrompt({
        imagePaths: [],
        keywords: "",
        generationMode: "inspired",
        model: "theme-model",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Please upload at least one image to generate a theme",
    });

    await expect(
      service.generateThemePrompt({
        imagePaths: Array.from({ length: 6 }, (_, index) =>
          path.join(tempDir, `${index}.png`),
        ),
        keywords: "",
        generationMode: "inspired",
        model: "theme-model",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Maximum 5 images allowed",
    });

    await expect(
      service.generateThemePrompt({
        imagePaths: [path.join(tempDir, "reference.png")],
        keywords: "",
        generationMode: "unsupported" as any,
        model: "theme-model",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: "Invalid generation mode",
    });

    expect(deps.resolveModelAlias).not.toHaveBeenCalled();
  });

  it("streams a theme prompt from uploaded images and a resolved model", async () => {
    const service = createThemeGenerationService(deps);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "reference.webp");
    await fs.promises.writeFile(imagePath, "image-bytes", "utf-8");

    await expect(
      service.generateThemePrompt({
        imagePaths: [imagePath],
        keywords: "<b>dashboard</b> ```clone```",
        generationMode: "high-fidelity",
        model: "theme-model",
      }),
    ).resolves.toEqual({ prompt: "<theme>generated</theme>" });

    expect(deps.resolveModelAlias).toHaveBeenCalledWith("theme-model");
    expect(deps.getModelClient).toHaveBeenCalledWith(
      { provider: "openai", name: "gpt-theme" },
      expect.objectContaining({ enableDyadPro: true }),
    );
    expect(deps.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: testModel,
        system: "high fidelity prompt",
        maxRetries: 1,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "inspired by: dashboard clone\nimages: 1 image(s) attached",
              },
              {
                type: "image",
                image: Buffer.from("image-bytes").toString("base64"),
                mimeType: "image/webp",
              },
            ],
          },
        ],
      }),
    );
    expect(deps.cancelOrphanedBaseStream).toHaveBeenCalledTimes(1);
  });

  it("uses the current selected model for the Local Web selected-model option", async () => {
    deps.readSettings = vi.fn(() => ({
      ...createSettings(),
      selectedModel: {
        provider: "custom::sub2api",
        name: "gpt-5.5",
        customModelId: 2,
      },
    }));
    const service = createThemeGenerationService(deps);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "reference.png");
    await fs.promises.writeFile(imagePath, "image-bytes", "utf-8");

    await expect(
      service.generateThemePrompt({
        imagePaths: [imagePath],
        keywords: "",
        generationMode: "inspired",
        model: LOCAL_WEB_SELECTED_THEME_MODEL_ID,
      }),
    ).resolves.toEqual({ prompt: "<theme>generated</theme>" });

    expect(deps.resolveModelAlias).not.toHaveBeenCalled();
    expect(deps.getModelClient).toHaveBeenCalledWith(
      {
        provider: "custom::sub2api",
        name: "gpt-5.5",
        customModelId: 2,
      },
      expect.any(Object),
    );
  });

  it("rejects empty provider streams instead of returning an empty prompt", async () => {
    deps.streamText = vi.fn(() => ({
      textStream: streamChunks([]),
    }));
    const service = createThemeGenerationService(deps);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const imagePath = path.join(tempDir, "reference.png");
    await fs.promises.writeFile(imagePath, "image-bytes", "utf-8");

    await expect(
      service.generateThemePrompt({
        imagePaths: [imagePath],
        keywords: "",
        generationMode: "inspired",
        model: "theme-model",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: "Theme generation returned an empty prompt",
    });
  });
});

async function* streamChunks(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createSettings(): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    enableDyadPro: true,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
