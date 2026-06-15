import { describe, expect, it } from "vitest";

import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enHome from "./locales/en/home.json";
import enSettings from "./locales/en/settings.json";
import zhCNChat from "./locales/zh-CN/chat.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNErrors from "./locales/zh-CN/errors.json";
import zhCNHome from "./locales/zh-CN/home.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

type LocaleBundle = Record<string, unknown>;

const englishBundles = {
  chat: enChat,
  common: enCommon,
  errors: enErrors,
  home: enHome,
  settings: enSettings,
} satisfies Record<string, LocaleBundle>;

const zhCNBundles = {
  chat: zhCNChat,
  common: zhCNCommon,
  errors: zhCNErrors,
  home: zhCNHome,
  settings: zhCNSettings,
} satisfies Record<keyof typeof englishBundles, LocaleBundle>;

function flattenKeys(bundle: LocaleBundle, prefix = ""): string[] {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value as LocaleBundle, nextPrefix);
    }

    return [nextPrefix];
  });
}

describe("locale parity", () => {
  it("keeps zh-CN keys in sync with the English locale bundles", () => {
    for (const namespace of Object.keys(englishBundles) as Array<
      keyof typeof englishBundles
    >) {
      const englishKeys = flattenKeys(englishBundles[namespace]).sort();
      const zhCNKeys = flattenKeys(zhCNBundles[namespace]).sort();

      expect(zhCNKeys, namespace).toEqual(englishKeys);
    }
  });
});
