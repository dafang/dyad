import { z } from "zod";
import crypto from "node:crypto";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { setAppBlueprintForChat } from "@/ipc/handlers/app_blueprint_handlers";
import type {
  AppBlueprintVisual,
  APP_BLUEPRINT_VISUAL_TYPES,
} from "@/ipc/types/app_blueprint";
import { encodeAppBlueprintData } from "@/lib/app_blueprint_data";
import { safeSend } from "@/ipc/utils/safe_sender";
import { readSettings } from "@/main/settings";
import { localTemplatesData } from "@/shared/templates";
import { themesData } from "@/shared/themes";
import type { UserSettings } from "@/lib/schemas";

// Only accept template/theme IDs the model could plausibly know about — the
// built-in catalogs. Unknown IDs (hallucinated names, API-only template IDs,
// stale custom:N IDs) silently fall back to the user's settings so the
// blueprint card never has to render "Unknown template/theme (X)".
const VALID_TEMPLATE_IDS = new Set(localTemplatesData.map((t) => t.id));
const VALID_THEME_IDS = new Set(themesData.map((t) => t.id));

const formatIdList = (ids: Iterable<string>) =>
  Array.from(ids, (id) => `"${id}"`).join(", ");
const VALID_TEMPLATE_IDS_LIST = formatIdList(VALID_TEMPLATE_IDS);
const VALID_THEME_IDS_LIST = formatIdList(VALID_THEME_IDS);

function resolveTemplateId(
  provided: string | undefined,
  settings: UserSettings,
): string {
  if (provided && VALID_TEMPLATE_IDS.has(provided)) return provided;
  return settings.selectedTemplateId;
}

function resolveThemeId(
  provided: string | undefined,
  settings: UserSettings,
): string {
  if (provided && VALID_THEME_IDS.has(provided)) return provided;
  return settings.selectedThemeId ?? "default";
}

const logger = log.scope("write_app_blueprint");

// `buildXml` runs once per streaming chunk, so reading settings (sync disk I/O)
// inside it would re-read the file dozens of times for a single blueprint.
// Cache the read for a short window — long enough to cover one streaming pass
// but short enough that toggles from Settings take effect quickly.
let cachedSettings: { value: UserSettings; expiresAt: number } | null = null;
const SETTINGS_CACHE_MS = 500;

function getCachedSettings(): UserSettings {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.value;
  }
  const value = readSettings();
  cachedSettings = { value, expiresAt: now + SETTINGS_CACHE_MS };
  return value;
}

type AppBlueprintVisualType = (typeof APP_BLUEPRINT_VISUAL_TYPES)[number];

type RawVisualEntry = z.infer<typeof VisualEntrySchema>;

const VisualEntrySchema = z
  .object({
    type: z
      .string()
      .optional()
      .describe(
        'The type of visual asset needed. Use exactly one of: "logo", "photo", "illustration", "icon", "background", "other".',
      ),
    description: z
      .string()
      .optional()
      .describe("What this visual is for and where it will be used in the app"),
    prompt: z
      .string()
      .optional()
      .describe(
        "A detailed image generation prompt for creating this visual. Be specific about style, composition, colors, and mood.",
      ),
    name: z.string().optional(),
    title: z.string().optional(),
    purpose: z.string().optional(),
    usage: z.string().optional(),
    asset_type: z.string().optional(),
    visual_type: z.string().optional(),
    image_prompt: z.string().optional(),
    generation_prompt: z.string().optional(),
    details: z.string().optional(),
    style: z.string().optional(),
  })
  .passthrough();

function firstNonEmptyString(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value && value.trim().length > 0)?.trim();
}

function normalizeVisualType(
  value: string | undefined,
): AppBlueprintVisualType {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "logo":
    case "logomark":
    case "wordmark":
      return "logo";
    case "photo":
    case "photograph":
    case "image":
    case "hero":
    case "hero_image":
    case "product_image":
    case "screenshot":
    case "portrait":
      return "photo";
    case "illustration":
    case "graphic":
    case "vector":
    case "scene":
    case "mascot":
      return "illustration";
    case "icon":
    case "icons":
    case "glyph":
    case "pictogram":
      return "icon";
    case "background":
    case "hero_background":
    case "backdrop":
    case "banner":
    case "wallpaper":
      return "background";
    default:
      return "other";
  }
}

function normalizeVisualEntry(
  visual: RawVisualEntry,
  index: number,
  args: Pick<
    WriteAppBlueprintArgs,
    "app_name" | "design_direction" | "primary_color"
  >,
): Omit<AppBlueprintVisual, "id"> {
  const type = normalizeVisualType(
    firstNonEmptyString(visual.type, visual.asset_type, visual.visual_type),
  );
  const description =
    firstNonEmptyString(
      visual.description,
      visual.purpose,
      visual.usage,
      visual.title,
      visual.name,
      visual.details,
    ) ?? `${type} visual ${index + 1} for ${args.app_name}`;
  const prompt =
    firstNonEmptyString(
      visual.prompt,
      visual.image_prompt,
      visual.generation_prompt,
      visual.details,
      visual.style,
      visual.description,
      visual.purpose,
      visual.usage,
      visual.title,
      visual.name,
    ) ??
    `Create a ${type} visual for ${args.app_name}: ${description}. Match this design direction: ${args.design_direction}. Use ${args.primary_color} as the primary accent color.`;

  return {
    type,
    description,
    prompt,
  };
}

function normalizeVisuals(
  visuals: RawVisualEntry[] | undefined,
  args: Pick<
    WriteAppBlueprintArgs,
    "app_name" | "design_direction" | "primary_color"
  >,
): Array<Omit<AppBlueprintVisual, "id">> {
  return (visuals ?? []).map((visual, index) =>
    normalizeVisualEntry(visual, index, args),
  );
}

const writeAppBlueprintSchema = z.object({
  app_name: z
    .string()
    .describe(
      "A creative, memorable app name generated based on the user's prompt",
    ),
  user_prompt: z
    .string()
    .describe(
      "The original user prompt that describes what they want to build",
    ),
  attachments: z
    .array(z.string())
    .optional()
    .default([])
    .describe("File paths of user attachments from the original prompt"),
  template_id: z
    .string()
    .optional()
    .describe(
      `The template/tech stack to use. ONLY set this when the user explicitly asks for a specific stack by name (e.g. "use Next.js" → "next"). Otherwise OMIT it and the user's default template from settings will be used. Valid values: ${VALID_TEMPLATE_IDS_LIST}.`,
    ),
  theme_id: z
    .string()
    .optional()
    .describe(
      `The theme to apply. ONLY set this when the user explicitly asks for a specific built-in theme by name. Otherwise OMIT it and the user's default theme from settings will be used. Valid values: ${VALID_THEME_IDS_LIST}.`,
    ),
  design_direction: z
    .string()
    .describe(
      "A brief description of the design direction for the app. Consider the industry, target audience, and mood. Example: 'Modern and professional with clean typography for a B2B SaaS dashboard'",
    ),
  primary_color: z
    .string()
    .regex(
      /^#[0-9a-fA-F]{6}$/,
      "primary_color must be a 6-digit hex code like '#3B82F6'",
    )
    .describe(
      "The primary/accent color for the app as a 6-digit hex code (e.g. '#3B82F6'). Choose based on the industry and design direction.",
    ),
  visuals: z
    .array(VisualEntrySchema)
    .max(10, "Maximum 10 visuals per blueprint")
    .optional()
    .default([])
    .describe(
      "Array of visual assets the app needs (logo, photos, illustrations, icons, backgrounds). Generate detailed image prompts for each.",
    ),
});

type WriteAppBlueprintArgs = z.infer<typeof writeAppBlueprintSchema>;

const DESCRIPTION = `Create or update the app blueprint for the user to review before building begins.

The app blueprint is a lightweight configuration step — it captures key decisions about the app (name, design, color, optionally template/theme) AND the visual assets the app needs (with detailed image generation prompts) before implementation starts. The user can modify any field directly in the card or ask you to update it. Template and theme default to the user's settings; only override them when the user explicitly asks for a specific one by name.

This tool returns immediately and ends the current turn. The user reviews the blueprint card and, on approval, the system applies the chosen name/template/theme and starts a new turn with a follow-up message that contains the approved blueprint — that's when you proceed with implementation.

<when_to_use>
Use this tool AFTER gathering any needed preferences (via planning_questionnaire or from the user's prompt). Call it once with all fields populated, including the planned visuals.
</when_to_use>

<guidelines>
- app_name: Generate a creative, memorable name that reflects the app's purpose. Keep it short (1-3 words).
- template_id: Omit by default — the user's settings choice is used. ONLY set when the user explicitly names a tech stack (e.g. "use Next.js" → "next", "use React" → "react"). Don't infer from the app idea.
- theme_id: Omit by default — the user's settings choice is used. ONLY set when the user explicitly names a built-in theme. Don't infer from the design direction.
- design_direction: Analyze the industry, target users, and purpose to determine the right visual approach. Be specific but concise (1-2 sentences).
- primary_color: Pick a color that fits the industry and design direction. Use hex format.
- visuals: 3-6 is typical. Common types: "logo", "photo" (hero images, products), "illustration" (empty states, onboarding), "icon" (custom icons), "background" (decorative), "other". Write detailed prompts that specify subject, style, colors, composition, and mood.
</guidelines>

<example>
{
  "app_name": "FreshBite",
  "user_prompt": "Build me a restaurant website with online ordering",
  "design_direction": "Warm and inviting with food photography emphasis, modern restaurant aesthetic with easy-to-navigate ordering flow",
  "primary_color": "#E85D04",
  "visuals": [
    {
      "type": "logo",
      "description": "App logo for the restaurant website header",
      "prompt": "Minimalist restaurant logo, warm orange tones, fork and knife silhouette integrated into letterform, clean vector style, white background"
    },
    {
      "type": "photo",
      "description": "Hero section background showing restaurant ambiance",
      "prompt": "Warm inviting restaurant interior, soft ambient lighting, wooden tables, bokeh background, food photography style, warm color grading"
    }
  ]
}
</example>`;

export const writeAppBlueprintTool: ToolDefinition<WriteAppBlueprintArgs> = {
  name: "write_app_blueprint",
  description: DESCRIPTION,
  inputSchema: writeAppBlueprintSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) => `App Blueprint: ${args.app_name}`,

  buildXml: (args, isComplete) => {
    if (!args.app_name) return undefined;

    const settings = getCachedSettings();
    const appName = escapeXmlAttr(args.app_name);
    const template = escapeXmlAttr(
      resolveTemplateId(args.template_id, settings),
    );
    const theme = escapeXmlAttr(resolveThemeId(args.theme_id, settings));
    const designDirection = args.design_direction
      ? escapeXmlAttr(args.design_direction)
      : "";
    const primaryColor = args.primary_color
      ? escapeXmlAttr(args.primary_color)
      : "";
    const data =
      args.user_prompt && args.design_direction && args.primary_color
        ? (() => {
            const visuals = normalizeVisuals(args.visuals, {
              app_name: args.app_name,
              design_direction: args.design_direction,
              primary_color: args.primary_color,
            });

            return ` data="${encodeAppBlueprintData({
              appName: args.app_name,
              userPrompt: args.user_prompt,
              attachments: args.attachments ?? [],
              templateId: resolveTemplateId(args.template_id, settings),
              themeId: resolveThemeId(args.theme_id, settings),
              designDirection: args.design_direction,
              primaryColor: args.primary_color,
              visuals: visuals.map((visual, index) => ({
                id: `visual_${index}`,
                type: visual.type,
                description: visual.description,
                prompt: visual.prompt,
              })),
            })}"`;
          })()
        : "";

    return `<dyad-app-blueprint app-name="${appName}" template="${template}" theme="${theme}" design-direction="${designDirection}" primary-color="${primaryColor}"${data} complete="${isComplete}"></dyad-app-blueprint>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Writing app blueprint: ${args.app_name}`);

    const settings = readSettings();

    const visuals = normalizeVisuals(args.visuals, args).map((v) => ({
      id: `visual_${crypto.randomUUID().slice(0, 8)}`,
      type: v.type,
      description: v.description,
      prompt: v.prompt,
    }));

    const data = {
      appName: args.app_name,
      userPrompt: args.user_prompt,
      attachments: args.attachments ?? [],
      templateId: resolveTemplateId(args.template_id, settings),
      themeId: resolveThemeId(args.theme_id, settings),
      designDirection: args.design_direction,
      primaryColor: args.primary_color,
      visuals,
    };

    setAppBlueprintForChat(ctx.chatId, data);

    safeSend(ctx.event.sender, "app-blueprint:update", {
      chatId: ctx.chatId,
      data,
    });

    await ctx.onXmlComplete(
      `<dyad-app-blueprint app-name="${escapeXmlAttr(data.appName)}" template="${escapeXmlAttr(data.templateId)}" theme="${escapeXmlAttr(data.themeId)}" design-direction="${escapeXmlAttr(data.designDirection)}" primary-color="${escapeXmlAttr(data.primaryColor)}" data="${encodeAppBlueprintData(data)}" complete="true"></dyad-app-blueprint>`,
    );

    // Return immediately without waiting for approval. The agent's `stopWhen`
    // ends the turn after this tool, so the model can't proceed against the
    // pre-rename `ctx.appPath`. The blueprint card collects the user's edits
    // and, on approval, sends a fresh chat message that starts a new turn
    // with a refreshed ctx.
    return "App blueprint written. Waiting for the user to review and approve it via the blueprint card.";
  },
};
