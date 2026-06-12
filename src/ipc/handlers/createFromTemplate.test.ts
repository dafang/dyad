import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEXT_APP_ROUTER_RULES_START } from "../utils/ai_rules_patcher";
import { createFromTemplate } from "./createFromTemplate";

const templatePath = vi.hoisted(() => ({
  value: "",
}));
const userDataPath = vi.hoisted(() => ({
  value: "",
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ selectedTemplateId: "next" })),
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: vi.fn(() => userDataPath.value),
}));

vi.mock("../utils/template_utils", () => ({
  getTemplateOrThrow: vi.fn(async () => ({
    id: "next",
    title: "Next.js Template",
    description: "Test template",
    imageUrl: "",
    githubUrl: "https://github.com/dyad-sh/nextjs-template",
    isOfficial: true,
  })),
}));

vi.mock("../utils/git_utils", () => ({
  getCurrentCommitHash: vi.fn(async () => "local-sha"),
  gitClone: vi.fn(async ({ path: clonePath }: { path: string }) => {
    await fs.mkdir(path.dirname(clonePath), { recursive: true });
    await fs.cp(templatePath.value, clonePath, { recursive: true });
  }),
}));

describe("createFromTemplate", () => {
  let rootPath: string;
  let appPath: string;

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ sha: "remote-sha" }),
      })),
    );
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "create-template-"));
    userDataPath.value = path.join(rootPath, "user-data");
    templatePath.value = path.join(rootPath, "template");
    appPath = path.join(rootPath, "app");
    await fs.mkdir(templatePath.value, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it("appends Next.js App Router rules after copying a Next template", async () => {
    await fs.writeFile(
      path.join(templatePath.value, "package.json"),
      JSON.stringify({ dependencies: { next: "^15.0.0" } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(templatePath.value, "AI_RULES.md"),
      "# Existing template rules\n",
      "utf8",
    );

    await createFromTemplate({
      fullAppPath: appPath,
      templateId: "next",
    });

    const aiRules = await fs.readFile(
      path.join(appPath, "AI_RULES.md"),
      "utf8",
    );
    expect(aiRules).toContain("# Existing template rules");
    expect(aiRules).toContain(NEXT_APP_ROUTER_RULES_START);
    expect(aiRules).toContain("Event handlers cannot be passed");
  });

  it("does not append Next.js App Router rules to non-Next templates", async () => {
    await fs.writeFile(
      path.join(templatePath.value, "package.json"),
      JSON.stringify({ dependencies: { "@vitejs/plugin-react": "^latest" } }),
      "utf8",
    );
    await fs.writeFile(
      path.join(templatePath.value, "AI_RULES.md"),
      "# Existing Vite rules\n",
      "utf8",
    );

    await createFromTemplate({
      fullAppPath: appPath,
      templateId: "react-vite-nitro",
    });

    const aiRules = await fs.readFile(
      path.join(appPath, "AI_RULES.md"),
      "utf8",
    );
    expect(aiRules).toBe("# Existing Vite rules\n");
  });
});
