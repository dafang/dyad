import {
  AppBlueprintDataSchema,
  type AppBlueprintData,
} from "@/ipc/types/app_blueprint";
import { escapeXmlAttr, unescapeXmlAttr } from "../../shared/xmlEscape";

const BLUEPRINT_DATA_ATTR = "data";

export function encodeAppBlueprintData(data: AppBlueprintData): string {
  return escapeXmlAttr(JSON.stringify(AppBlueprintDataSchema.parse(data)));
}

export function decodeAppBlueprintData(
  value: string | undefined,
): AppBlueprintData | null {
  if (!value) {
    return null;
  }

  const candidates = [value, unescapeXmlAttr(value)];
  for (const candidate of candidates) {
    try {
      return AppBlueprintDataSchema.parse(JSON.parse(candidate));
    } catch {
      // Try the next representation. Blueprint data may arrive either as a
      // raw XML attribute or from the streaming parser after XML unescaping.
    }
  }
  return null;
}

export function decodeRawAppBlueprintData(
  encoded: string | undefined,
): AppBlueprintData | null {
  return decodeAppBlueprintData(encoded ? unescapeXmlAttr(encoded) : undefined);
}

export function extractAppBlueprintDataFromContent(
  content: string,
): AppBlueprintData | null {
  const tagMatch = content.match(/<dyad-app-blueprint\b([^>]*)>/);
  if (!tagMatch) {
    return null;
  }

  const attrs = parseRawAttributes(tagMatch[1]);
  return (
    decodeAppBlueprintData(attrs[BLUEPRINT_DATA_ATTR]) ??
    createAppBlueprintDataFromAttributes(attrs)
  );
}

export function createAppBlueprintDataFromAttributes(
  attributes: Record<string, string | undefined>,
): AppBlueprintData | null {
  const appName = attributes["app-name"]?.trim();
  if (!appName) {
    return null;
  }

  const data = {
    appName,
    userPrompt: attributes["user-prompt"] ?? "",
    attachments: [],
    templateId: attributes.template?.trim() || "react",
    themeId: attributes.theme?.trim() || "default",
    designDirection: attributes["design-direction"] ?? "",
    primaryColor: attributes["primary-color"]?.trim() || "#3B82F6",
    visuals: [],
  };

  return AppBlueprintDataSchema.parse(data);
}

function parseRawAttributes(attrsStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrsStr)) !== null) {
    out[match[1]] = unescapeXmlAttr(match[2]);
  }
  return out;
}
