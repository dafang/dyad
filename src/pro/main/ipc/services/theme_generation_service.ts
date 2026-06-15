import { promises as fs } from "node:fs";
import path from "node:path";

import type { ImagePart, LanguageModel, TextPart } from "ai";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  GenerateThemePromptParams,
  GenerateThemePromptResult,
  SaveThemeImageParams,
  SaveThemeImageResult,
} from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";

const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const MAX_THEME_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
export const LOCAL_WEB_SELECTED_THEME_MODEL_ID = "local-web/selected-model";

export const THEME_GENERATION_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that extracts a reusable UI DESIGN SYSTEM from provided images.
- This is a visual ruleset, not a website blueprint.
- Extract constraints, scales, and principles — never layouts or compositions.
- You are NOT recreating, cloning, or reverse-engineering a specific website.
- The resulting system must be applicable to unrelated products without visual resemblance.

SCOPE & LIMITATIONS (MANDATORY)
- Do NOT reproduce:
  - Page layouts
  - Component hierarchies
  - Spatial arrangements
  - Relative positioning between elements
  - Information architecture
- Do NOT describe the original interface.
- Do NOT reference screen structure, sections, or flows.
- The output must remain abstract, systemic, and transferable.

INPUTS
- One or more UI images
- Optional reference name (popular product or known design system)
- Visual input defines stylistic constraints only (tokens, shapes, motion, density)

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Hard Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales
  - All styling must be token-driven

OUTPUT RULES
- Wrap the entire output in <theme></theme> tags.
- Output exactly ONE SYSTEM PROMPT that:
  - Names the inspiration strictly as a stylistic reference, not a target
  - Defines enforceable rules, never descriptions
  - Uses imperative language only ("must", "never", "always")
  - Never mentions images, screenshots, or visual analysis
  - Produces a system that cannot recreate the original UI even if followed precisely

REQUIRED STRUCTURE
- Visual Objective (abstract, non-descriptive)
- Layout & Spacing Rules (scales only, no patterns)
- Typography System (roles, hierarchy, constraints)
- Color & Surfaces (tokens, elevation logic)
- Components & Shape Language (geometry, affordances — no layouts)
- Motion & Interaction (timing, intent, limits)
- Forbidden Patterns (explicit anti-cloning rules)
- Self-Check (verifies abstraction & non-replication)
`;

export const HIGH_FIDELITY_META_PROMPT = `PURPOSE
- Generate a strict SYSTEM PROMPT that allows an AI to recreate a UI visual system from a provided image.
- This is a visual subsystem. Do not define roles or personas.
- Extract rules, not descriptions.

INPUTS
- One or more UI images
- Optional reference name (popular product / design system)
- Image always takes priority.

FIXED TECH STACK
- Assume React + Tailwind CSS + shadcn/ui.
- Rules:
  - Never ship default shadcn styles
  - No inline styles
  - No arbitrary values outside defined scales

OUTPUT RULES
- Wrap the entire output in <theme></theme> tags.
- Output one SYSTEM PROMPT that:
  - Explicitly names the inspiration as a guiding reference
  - Uses hard, enforceable rules only
  - Is technical and unambiguous
  - Never mentions the image 
  - Avoids vague language ("might", "appears", etc.)

REQUIRED STRUCTURE
- Visual Objective
- Layout & Spacing Rules
- Typography System
- Color & Surfaces
- Components & Shape Language
- Motion & Interaction
- Forbidden Patterns
- Self-Check
`;

type ThemeGenerationModePrompt = {
  inspired: string;
  "high-fidelity": string;
};

export interface ThemeGenerationModelResolution {
  providerId: string;
  apiName: string;
}

export interface ThemeGenerationModelClient {
  model: LanguageModel;
}

export interface ThemeGenerationStreamResult {
  textStream: AsyncIterable<string>;
}

export interface ThemeGenerationServiceDeps {
  tempDir: string;
  readSettings: () => UserSettings;
  resolveModelAlias: (
    aliasId: string,
  ) => Promise<ThemeGenerationModelResolution | null>;
  getModelClient: (
    model: { provider: string; name: string },
    settings: UserSettings,
  ) => Promise<{ modelClient: ThemeGenerationModelClient }>;
  streamText: (options: {
    model: LanguageModel;
    system: string;
    maxRetries: number;
    messages: { role: "user"; content: (TextPart | ImagePart)[] }[];
  }) => ThemeGenerationStreamResult;
  cancelOrphanedBaseStream: (stream: unknown) => void;
  prompts: ThemeGenerationModePrompt;
  isTestBuild?: () => boolean;
  requireDyadPro?: boolean;
  now?: () => number;
  random?: () => number;
  logger?: { log: (message: string) => void };
}

export function createThemeGenerationService(deps: ThemeGenerationServiceDeps) {
  return new ThemeGenerationService(deps);
}

export class ThemeGenerationService {
  constructor(private readonly deps: ThemeGenerationServiceDeps) {}

  async saveThemeImage(
    params: SaveThemeImageParams,
  ): Promise<SaveThemeImageResult> {
    const { data, filename } = params;

    if (!data || typeof data !== "string") {
      throw new DyadError("Invalid image data", DyadErrorKind.Validation);
    }

    const ext = path.extname(filename).toLowerCase();
    if (!VALID_IMAGE_EXTENSIONS.includes(ext)) {
      throw new DyadError(
        `Invalid image extension: ${ext}. Supported: ${VALID_IMAGE_EXTENSIONS.join(", ")}`,
        DyadErrorKind.Validation,
      );
    }

    const sizeInBytes = (data.length * 3) / 4;
    if (sizeInBytes > MAX_THEME_IMAGE_SIZE_BYTES) {
      throw new DyadError(
        "Image size exceeds 10MB limit",
        DyadErrorKind.Validation,
      );
    }

    await fs.mkdir(this.deps.tempDir, { recursive: true });

    const now = this.deps.now?.() ?? Date.now();
    const random = this.deps.random?.() ?? Math.random();
    const uniqueFilename = `${now}-${random.toString(36).slice(2, 11)}${ext}`;
    const filePath = path.join(this.deps.tempDir, uniqueFilename);
    await fs.writeFile(filePath, Buffer.from(data, "base64"));

    return { path: filePath };
  }

  async cleanupThemeImages(params: { paths: string[] }): Promise<void> {
    for (const filePath of params.paths) {
      this.assertInsideTempDir(
        filePath,
        "Invalid path: cannot delete files outside temp directory",
      );

      try {
        await fs.unlink(filePath);
        this.deps.logger?.log(`Cleaned up theme image: ${filePath}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new DyadError(
            "Failed to cleanup temporary image file",
            DyadErrorKind.External,
          );
        }
      }
    }
  }

  async generateThemePrompt(
    params: GenerateThemePromptParams,
  ): Promise<GenerateThemePromptResult> {
    const settings = this.deps.readSettings();

    if (this.deps.isTestBuild?.()) {
      return {
        prompt: `<theme>
# Test Mode Theme

## Visual Objective
Modern dark theme with purple accents for testing.

</theme>`,
      };
    }

    if ((this.deps.requireDyadPro ?? true) && !settings.enableDyadPro) {
      throw new DyadError(
        "Dyad Pro is required for AI theme generation. Please enable Dyad Pro in Settings.",
        DyadErrorKind.Precondition,
      );
    }

    this.validateGenerateThemePromptParams(params);

    const selectedModel =
      params.model === LOCAL_WEB_SELECTED_THEME_MODEL_ID
        ? null
        : await this.deps.resolveModelAlias(params.model);
    const requestedModel =
      params.model === LOCAL_WEB_SELECTED_THEME_MODEL_ID
        ? settings.selectedModel
        : selectedModel
          ? {
              provider: selectedModel.providerId,
              name: selectedModel.apiName,
            }
          : null;
    if (!requestedModel) {
      throw new DyadError(
        `Invalid model selection: alias "${params.model}" could not be resolved`,
        DyadErrorKind.Validation,
      );
    }

    const { modelClient } = await this.deps.getModelClient(
      requestedModel,
      settings,
    );

    const contentParts: (TextPart | ImagePart)[] = [
      { type: "text", text: this.createUserInput(params) },
    ];

    for (const imagePath of params.imagePaths) {
      this.assertInsideTempDir(
        imagePath,
        "Invalid image path: images must be uploaded through the theme dialog",
      );

      try {
        const imageBuffer = await fs.readFile(imagePath);
        const ext = path.extname(imagePath).toLowerCase();
        contentParts.push({
          type: "image",
          image: imageBuffer.toString("base64"),
          mimeType: getMimeTypeFromExtension(ext),
        } as ImagePart);
      } catch {
        throw new DyadError(
          `Failed to read image file: ${path.basename(imagePath)}`,
          DyadErrorKind.External,
        );
      }
    }

    const stream = this.deps.streamText({
      model: modelClient.model,
      system:
        params.generationMode === "high-fidelity"
          ? this.deps.prompts["high-fidelity"]
          : this.deps.prompts.inspired,
      maxRetries: 1,
      messages: [{ role: "user", content: contentParts }],
    });

    const textStream = stream.textStream;
    this.deps.cancelOrphanedBaseStream(stream);

    let result = "";
    for await (const chunk of textStream) {
      result += chunk;
    }

    if (!result.trim()) {
      throw new DyadError(
        "Theme generation returned an empty prompt",
        DyadErrorKind.External,
      );
    }

    return { prompt: result };
  }

  private validateGenerateThemePromptParams(
    params: GenerateThemePromptParams,
  ): void {
    if (params.imagePaths.length === 0) {
      throw new DyadError(
        "Please upload at least one image to generate a theme",
        DyadErrorKind.Validation,
      );
    }

    if (params.imagePaths.length > 5) {
      throw new DyadError("Maximum 5 images allowed", DyadErrorKind.Validation);
    }

    if (params.keywords.length > 500) {
      throw new DyadError(
        "Keywords must be less than 500 characters",
        DyadErrorKind.Validation,
      );
    }

    if (!["inspired", "high-fidelity"].includes(params.generationMode)) {
      throw new DyadError("Invalid generation mode", DyadErrorKind.Validation);
    }
  }

  private createUserInput(params: GenerateThemePromptParams): string {
    const keywordsPart = sanitizeKeywords(params.keywords) || "N/A";
    const imagesPart =
      params.imagePaths.length > 0
        ? `${params.imagePaths.length} image(s) attached`
        : "N/A";
    return `inspired by: ${keywordsPart}
images: ${imagesPart}`;
  }

  private assertInsideTempDir(filePath: string, message: string): void {
    const normalizedPath = path.resolve(filePath);
    const normalizedTempDir = path.resolve(this.deps.tempDir);
    if (!normalizedPath.startsWith(normalizedTempDir + path.sep)) {
      throw new DyadError(message, DyadErrorKind.Validation);
    }
  }
}

export function sanitizeKeywords(keywords: string): string {
  let sanitized = keywords.trim().slice(0, 500);
  sanitized = sanitized.replace(/<\/?[^>]+(>|$)/g, "");
  sanitized = sanitized.replace(/`{3,}/g, "");
  return sanitized;
}

export function getMimeTypeFromExtension(
  ext: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const mimeMap: Record<
    string,
    "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  > = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return mimeMap[ext.toLowerCase()] || "image/png";
}
