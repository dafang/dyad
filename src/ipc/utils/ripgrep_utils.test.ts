import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("getRgExecutablePath", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses the bundled development ripgrep binary when it exists", async () => {
    const cwd = path.join("/repo", "dyad");
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.spyOn(fs, "existsSync").mockImplementation((candidate) =>
      String(candidate).endsWith(
        path.join("@vscode", "ripgrep", "bin", rgName()),
      ),
    );

    const { getRgExecutablePath } = await import("./ripgrep_utils");

    expect(getRgExecutablePath()).toBe(
      path.join(cwd, "node_modules", "@vscode", "ripgrep", "bin", rgName()),
    );
  });

  it("falls back to PATH when the development package binary is missing", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join("/repo", "dyad"));
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const { getRgExecutablePath } = await import("./ripgrep_utils");

    expect(getRgExecutablePath()).toBe(rgName());
  });
});

function rgName() {
  return os.platform() === "win32" ? "rg.exe" : "rg";
}
