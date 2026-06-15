import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  analyzeVisualEditingComponent,
  applyVisualEditingChanges,
  MAX_VISUAL_EDIT_IMAGE_SIZE,
  type VisualEditingServiceDeps,
} from "./visual_editing_service";

describe("visual editing service", () => {
  let tempDir: string;
  let appPath: string;
  let deps: VisualEditingServiceDeps;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-visual-editing-service-"),
    );
    appPath = path.join(tempDir, "app");
    await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <div className="p-[4px] text-[12px]">Old text</div>;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    deps = {
      findAppById: vi.fn(async (appId: number) =>
        appId === 1 ? { id: 1, path: appPath } : undefined,
      ),
      resolveAppPath: (appRecordPath: string) => appRecordPath,
      now: () => 1234567890,
      queueSnapshotSync: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("applies text and style changes to an app source file", async () => {
    await applyVisualEditingChanges(
      {
        appId: 1,
        changes: [
          {
            componentId: "src/App.tsx:2",
            componentName: "div",
            relativePath: "src/App.tsx",
            lineNumber: 2,
            styles: {
              padding: { left: "16px", right: "16px" },
              text: { fontSize: "24px" },
            },
            textContent: "New text",
          },
        ],
      },
      deps,
    );

    const content = await fs.promises.readFile(
      path.join(appPath, "src", "App.tsx"),
      "utf-8",
    );
    expect(content).toContain("New text");
    expect(content).toContain("px-[16px]");
    expect(content).toContain("text-[24px]");
    expect(content).not.toContain("Old text");
    expect(deps.queueSnapshotSync).toHaveBeenCalledWith({
      appId: 1,
      changedPaths: ["src/App.tsx"],
    });
  });

  it("writes accepted image uploads to .dyad/media and public/images", async () => {
    await fs.promises.writeFile(
      path.join(appPath, "src", "App.tsx"),
      [
        "export function App() {",
        '  return <img alt="hero" src="/old.png" />;',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    await applyVisualEditingChanges(
      {
        appId: 1,
        changes: [
          {
            componentId: "src/App.tsx:2",
            componentName: "img",
            relativePath: "src/App.tsx",
            lineNumber: 2,
            styles: {},
            imageUpload: {
              fileName: "hero image.png",
              base64Data: Buffer.from("image-bytes").toString("base64"),
              mimeType: "image/png",
            },
          },
        ],
      },
      deps,
    );

    const finalFileName = "1234567890-hero_image.png";
    await expect(
      fs.promises.readFile(
        path.join(appPath, ".dyad", "media", finalFileName),
        "utf-8",
      ),
    ).resolves.toBe("image-bytes");
    await expect(
      fs.promises.readFile(
        path.join(appPath, "public", "images", finalFileName),
        "utf-8",
      ),
    ).resolves.toBe("image-bytes");
    await expect(
      fs.promises.readFile(path.join(appPath, ".gitignore"), "utf-8"),
    ).resolves.toContain(".dyad/");
    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toContain(`src="/images/${finalFileName}"`);
  });

  it("rejects invalid image uploads before source files are changed", async () => {
    const before = await fs.promises.readFile(
      path.join(appPath, "src", "App.tsx"),
      "utf-8",
    );

    await expect(
      applyVisualEditingChanges(
        {
          appId: 1,
          changes: [
            {
              componentId: "src/App.tsx:2",
              componentName: "div",
              relativePath: "src/App.tsx",
              lineNumber: 2,
              styles: {},
              textContent: "Should not write",
              imageUpload: {
                fileName: "broken.svg",
                base64Data: "PHN2Zy8+",
                mimeType: "image/svg+xml",
              },
            },
          ],
        },
        deps,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("Unsupported image type"),
    });

    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toBe(before);
    expect(fs.existsSync(path.join(appPath, ".dyad"))).toBe(false);
    expect(fs.existsSync(path.join(appPath, "public"))).toBe(false);
  });

  it("rejects oversized image uploads before source files are changed", async () => {
    const before = await fs.promises.readFile(
      path.join(appPath, "src", "App.tsx"),
      "utf-8",
    );

    await expect(
      applyVisualEditingChanges(
        {
          appId: 1,
          changes: [
            {
              componentId: "src/App.tsx:2",
              componentName: "div",
              relativePath: "src/App.tsx",
              lineNumber: 2,
              styles: {},
              imageUpload: {
                fileName: "huge.png",
                base64Data: "a".repeat(MAX_VISUAL_EDIT_IMAGE_SIZE + 1),
                mimeType: "image/png",
              },
            },
          ],
        },
        deps,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("too large"),
    });

    await expect(
      fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
    ).resolves.toBe(before);
  });

  it("classifies missing apps as not found", async () => {
    await expect(
      applyVisualEditingChanges(
        {
          appId: 404,
          changes: [
            {
              componentId: "src/App.tsx:2",
              componentName: "div",
              relativePath: "src/App.tsx",
              lineNumber: 2,
              styles: {},
            },
          ],
        },
        deps,
      ),
    ).rejects.toEqual(
      new DyadError("App not found: 404", DyadErrorKind.NotFound),
    );
  });

  it("analyzes components from a resolved app file", async () => {
    await expect(
      analyzeVisualEditingComponent(
        {
          appId: 1,
          componentId: "src/App.tsx:2",
        },
        deps,
      ),
    ).resolves.toMatchObject({
      isDynamic: false,
      hasStaticText: true,
      hasImage: false,
    });
  });
});
