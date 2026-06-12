import { describe, expect, it, vi } from "vitest";
import { resolvePreviewBrowserUrl } from "./previewBrowserUrl";

describe("resolvePreviewBrowserUrl", () => {
  it("returns a cloud share link instead of the raw preview URL", async () => {
    const createCloudSandboxShareLink = vi
      .fn()
      .mockResolvedValue({ url: "https://dyad.sh/share/sandbox-1" });

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: 42,
        originalUrl: "https://preview.internal.test",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("https://dyad.sh/share/sandbox-1");

    expect(createCloudSandboxShareLink).toHaveBeenCalledWith({
      appId: 42,
    });
  });

  it("returns the existing preview URL for non-cloud previews", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: null,
        originalUrl: "http://127.0.0.1:3000",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("http://127.0.0.1:3000");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it("returns the local web preview URL for non-cloud local web previews", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: 44,
        appUrl: "https://dyad.example.test/api/preview/44/",
        originalUrl: "http://localhost:32144/",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("https://dyad.example.test/api/preview/44/");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it("falls back to the original preview URL for non-local-web previews", async () => {
    const createCloudSandboxShareLink = vi.fn();

    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: false,
        selectedAppId: 44,
        appUrl: "http://localhost:42144/",
        originalUrl: "http://localhost:32144/",
        createCloudSandboxShareLink,
      }),
    ).resolves.toBe("http://localhost:32144/");

    expect(createCloudSandboxShareLink).not.toHaveBeenCalled();
  });

  it("throws when cloud preview browser open is requested without an app id", async () => {
    await expect(
      resolvePreviewBrowserUrl({
        isCloudMode: true,
        selectedAppId: null,
        originalUrl: "https://preview.internal.test",
        createCloudSandboxShareLink: vi.fn(),
      }),
    ).rejects.toThrow("Cloud sandbox is not running.");
  });
});
