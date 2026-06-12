import { describe, expect, it, vi } from "vitest";

import { createWebHostCapabilities } from "./web_host_capabilities";

describe("web host capabilities", () => {
  it("opens http links in a browser-safe new tab", async () => {
    const open = vi.fn();
    const capabilities = createWebHostCapabilities({
      localWeb: true,
      window: { open } as unknown as Window,
    });

    await expect(
      capabilities.openExternalUrl("https://example.com"),
    ).resolves.toMatchObject({
      capability: "open-external-url",
      supported: true,
    });
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("rejects non-http external links before opening", async () => {
    const open = vi.fn();
    const capabilities = createWebHostCapabilities({
      localWeb: true,
      window: { open } as unknown as Window,
    });

    await expect(
      capabilities.openExternalUrl("file:///private/etc/passwd"),
    ).rejects.toThrow("External URL must be http(s)");
    expect(open).not.toHaveBeenCalled();
  });

  it("reports unsupported local OS actions in Web mode", async () => {
    const capabilities = createWebHostCapabilities({ localWeb: true });

    await expect(
      capabilities.showItemInFolder("/tmp/app"),
    ).resolves.toMatchObject({
      capability: "show-item-in-folder",
      supported: false,
      reason: expect.stringContaining("Browsers cannot reveal local files"),
    });
    await expect(capabilities.restartApp()).resolves.toMatchObject({
      capability: "restart",
      supported: false,
    });
    await expect(capabilities.resetAll()).resolves.toMatchObject({
      capability: "reset",
      supported: false,
    });
  });

  it("uses browser clipboard APIs when available", async () => {
    const writeText = vi.fn(async () => undefined);
    const readText = vi.fn(async () => "copied");
    const capabilities = createWebHostCapabilities({
      localWeb: true,
      navigator: { clipboard: { writeText, readText } },
    });

    await expect(capabilities.writeClipboard("copy me")).resolves.toMatchObject(
      { supported: true },
    );
    await expect(capabilities.readClipboard()).resolves.toMatchObject({
      supported: true,
      text: "copied",
    });
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("normalizes folder selection to a root folder name", async () => {
    let input: HTMLInputElement | undefined;
    const body = { append: vi.fn() };
    const document = {
      body,
      createElement: vi.fn(() => {
        input = documentThis.createElement("input");
        input.click = vi.fn();
        return input;
      }),
    };
    const documentThis = globalThis.document;
    const capabilities = createWebHostCapabilities({
      localWeb: true,
      document: document as unknown as Document,
    });

    const promise = capabilities.selectDirectory();
    expect(input).toBeDefined();
    Object.defineProperty(input!, "files", {
      configurable: true,
      value: [
        {
          name: "package.json",
          webkitRelativePath: "sample-app/package.json",
        },
      ],
    });
    input!.dispatchEvent(new Event("change"));

    await expect(promise).resolves.toMatchObject({
      capability: "select-directory",
      supported: true,
      path: "sample-app/package.json",
      name: "sample-app",
      canceled: false,
    });
    expect(body.append).toHaveBeenCalledWith(input);
  });
});
