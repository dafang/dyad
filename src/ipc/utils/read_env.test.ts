import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shellEnvSync: vi.fn(() => ({
    OPENAI_BASE_URL: "https://shell.example.test",
    SHELL_ONLY: "from-shell",
  })),
}));

vi.mock("shell-env", () => ({
  shellEnvSync: mocks.shellEnvSync,
}));

describe("getEnvVar", () => {
  afterEach(async () => {
    delete process.env.OPENAI_BASE_URL;
    delete process.env.SHELL_ONLY;
    const { configureLocalWebRuntimeContext } =
      await import("@/runtime/local_web_runtime_context");
    configureLocalWebRuntimeContext(false);
    vi.resetModules();
    mocks.shellEnvSync.mockClear();
  });

  test("prefers the current process environment over shell-env", async () => {
    process.env.OPENAI_BASE_URL = "https://process.example.test";
    const { getEnvVar } = await import("./read_env");

    expect(getEnvVar("OPENAI_BASE_URL")).toBe("https://process.example.test");
    expect(mocks.shellEnvSync).not.toHaveBeenCalled();
  });

  test("falls back to shell-env for desktop launches without process env", async () => {
    const { getEnvVar } = await import("./read_env");

    expect(getEnvVar("SHELL_ONLY")).toBe("from-shell");
    expect(mocks.shellEnvSync).toHaveBeenCalledTimes(1);
  });

  test("does not call shell-env in the local web runtime", async () => {
    const { configureLocalWebRuntimeContext } =
      await import("@/runtime/local_web_runtime_context");
    configureLocalWebRuntimeContext(true);
    const { getEnvVar } = await import("./read_env");

    expect(getEnvVar("SHELL_ONLY")).toBeUndefined();
    expect(mocks.shellEnvSync).not.toHaveBeenCalled();
  });
});
