import { describe, expect, it } from "vitest";

import {
  getPreviewDisplayPath,
  isPreviewRootUrl,
  isSamePreviewOrigin,
  normalizePreviewUrlForApp,
} from "./previewUrl";

const config = {
  mode: "local-web" as const,
  baseUrl: "https://dyad.example.test",
  token: "local-token",
  eventUrl: "https://dyad.example.test/api/events",
};

describe("preview URL normalization", () => {
  it("maps iframe loopback history URLs back through the local web preview route", () => {
    globalThis.__DYAD_LOCAL_WEB_CONFIG__ = config;
    try {
      expect(
        normalizePreviewUrlForApp({
          url: "http://localhost:42144/",
          appUrl: "https://dyad.example.test/api/preview/44/",
          appId: 44,
        }),
      ).toBe("https://dyad.example.test/api/preview/44/");
      expect(
        normalizePreviewUrlForApp({
          url: "http://localhost:42144/settings?tab=theme#colors",
          appUrl: "https://dyad.example.test/api/preview/44/",
          appId: 44,
        }),
      ).toBe(
        "https://dyad.example.test/api/preview/44/settings?tab=theme#colors",
      );
    } finally {
      globalThis.__DYAD_LOCAL_WEB_CONFIG__ = undefined;
    }
  });

  it("keeps local web relative app routes under the preview route", () => {
    globalThis.__DYAD_LOCAL_WEB_CONFIG__ = config;
    try {
      expect(
        normalizePreviewUrlForApp({
          url: "/settings",
          appUrl: "https://dyad.example.test/api/preview/44/",
          appId: 44,
        }),
      ).toBe("https://dyad.example.test/api/preview/44/settings");
    } finally {
      globalThis.__DYAD_LOCAL_WEB_CONFIG__ = undefined;
    }
  });

  it("detects preview origins and roots", () => {
    expect(
      isSamePreviewOrigin(
        "https://dyad.example.test/api/preview/44/settings",
        "https://dyad.example.test/api/preview/44/",
      ),
    ).toBe(true);
    expect(
      isPreviewRootUrl("https://dyad.example.test/api/preview/44/", 44),
    ).toBe(true);
    expect(
      isPreviewRootUrl("https://dyad.example.test/api/preview/44/settings", 44),
    ).toBe(false);
  });

  it("displays local web preview proxy URLs as app routes", () => {
    expect(
      getPreviewDisplayPath({
        url: "https://dyad.example.test/api/preview/44/",
        appId: 44,
      }),
    ).toBe("/");
    expect(
      getPreviewDisplayPath({
        url: "https://dyad.example.test/api/preview/44/settings?tab=theme#top",
        appId: 44,
      }),
    ).toBe("/settings?tab=theme#top");
  });
});
