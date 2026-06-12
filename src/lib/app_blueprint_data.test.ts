import { describe, expect, it } from "vitest";

import {
  createAppBlueprintDataFromAttributes,
  decodeAppBlueprintData,
  decodeRawAppBlueprintData,
  encodeAppBlueprintData,
  extractAppBlueprintDataFromContent,
} from "./app_blueprint_data";
import type { AppBlueprintData } from "@/ipc/types/app_blueprint";

describe("app blueprint data serialization", () => {
  it("round trips blueprint data through an XML attribute", () => {
    const data: AppBlueprintData = {
      appName: "Nexora & Co",
      userPrompt: "Build a landing page",
      attachments: ["docs/spec.md"],
      templateId: "react",
      themeId: "default",
      designDirection: "Sharp, editorial, and high contrast",
      primaryColor: "#111827",
      visuals: [
        {
          id: "visual_logo",
          type: "logo",
          description: "Logo for Nexora & Co",
          prompt: "Minimal wordmark",
        },
      ],
    };

    const encoded = encodeAppBlueprintData(data);

    expect(decodeRawAppBlueprintData(encoded)).toEqual(data);
    expect(decodeAppBlueprintData(encoded)).toEqual(data);
    expect(decodeAppBlueprintData(JSON.stringify(data))).toEqual(data);
    expect(
      extractAppBlueprintDataFromContent(
        `<dyad-app-blueprint data="${encoded}" complete="true"></dyad-app-blueprint>`,
      ),
    ).toEqual(data);
  });

  it("recovers minimal blueprint data from plain XML attributes", () => {
    expect(
      extractAppBlueprintDataFromContent(
        '<dyad-app-blueprint app-name="Aurora Desk" template="next" theme="default" design-direction="Minimal &amp; polished" primary-color="#5B5FE9" complete="true"></dyad-app-blueprint>',
      ),
    ).toEqual({
      appName: "Aurora Desk",
      userPrompt: "",
      attachments: [],
      templateId: "next",
      themeId: "default",
      designDirection: "Minimal & polished",
      primaryColor: "#5B5FE9",
      visuals: [],
    });
  });

  it("creates minimal blueprint data from already parsed attributes", () => {
    expect(
      createAppBlueprintDataFromAttributes({
        "app-name": "Parsed Plan",
        template: "next",
        theme: "default",
        "design-direction": "Clean and direct",
        "primary-color": "#111827",
      }),
    ).toMatchObject({
      appName: "Parsed Plan",
      templateId: "next",
      themeId: "default",
      visuals: [],
    });
  });
});
