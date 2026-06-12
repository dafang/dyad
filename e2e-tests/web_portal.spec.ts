import { expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RealProviderConfig = {
  source: "env" | "codex";
  apiKey: string;
  baseUrl: string | null;
  model: string;
};

type LocalWebServer = {
  pageUrl: string;
  apiUrl: string;
  userDataPath: string;
  process: ChildProcess;
  output: string[];
  provider: RealProviderConfig;
};

type WebE2eSummary = {
  routes: {
    desktop: Record<string, RouteMetric>;
    mobile: Record<string, RouteMetric>;
  };
  screenshots: string[];
  accessibility: Record<string, boolean>;
  mobileChat: {
    provider: string | null;
    model: string | null;
    responseVisible: boolean;
  } | null;
  mobilePreview: {
    iframeSrc: string | null;
    iframeHasText: boolean;
    addressPath: string | null;
  } | null;
};

type RouteMetric = {
  innerWidth: number;
  documentScrollWidth: number;
  horizontalOverflow: boolean;
  hasVisibleSurface: boolean;
};

type RpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; kind?: string };

type StreamRpcEvent =
  | { type: "ready" }
  | { type: "event"; channel: string; payload: unknown }
  | { type: "result"; data: unknown }
  | { type: "error"; error: string };

const screenshotDir = path.resolve(".supergoal", "web-e2e");

test.describe("local Web portal", () => {
  test.setTimeout(180_000);

  let server: LocalWebServer | undefined;
  const consoleMessages: string[] = [];
  const networkFailures: string[] = [];
  const backendFailures: string[] = [];
  const ignoredFailures: string[] = [];
  const e2eSummary: WebE2eSummary = createEmptySummary();
  let provider: RealProviderConfig;

  test.beforeEach(async ({ page }, testInfo) => {
    consoleMessages.length = 0;
    networkFailures.length = 0;
    backendFailures.length = 0;
    ignoredFailures.length = 0;
    resetSummary(e2eSummary);
    provider = await readRealProviderConfig();
    server = await startLocalWebServer(
      testInfo.outputPath("user-data"),
      provider,
    );
    attachBrowserFailureCapture(page, {
      consoleMessages,
      networkFailures,
      backendFailures,
      ignoredFailures,
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await fs.mkdir(screenshotDir, { recursive: true });
    const summary = {
      consoleMessages,
      networkFailures,
      backendFailures,
      ignoredFailures,
      provider: {
        source: server?.provider.source,
        baseUrlHost: server?.provider.baseUrl
          ? new URL(server.provider.baseUrl).host
          : null,
        model: server?.provider.model,
        key: server?.provider.apiKey ? "present" : "missing",
      },
      localWebOutput: server?.output.slice(-60) ?? [],
      ...e2eSummary,
    };
    await fs.writeFile(
      path.join(screenshotDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    await testInfo.attach("web-console-summary", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });
    await page.close().catch(() => undefined);
    if (server) {
      await stopLocalWebServer(server);
      server = undefined;
    }
  });

  test("runs the complete browser UI through local HTTP and SSE", async ({
    browser,
    page,
  }) => {
    expect(server).toBeDefined();
    const pageUrl = server!.pageUrl;

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).toBeVisible();
    await expect(page.getByTestId("home-chat-input-container")).toBeVisible();
    e2eSummary.routes.desktop.home = await collectRouteMetric(page);
    await saveScreenshot(page, "home");

    const health = await fetchJson(page, `${server!.apiUrl}/api/health`);
    expect(health).toMatchObject({ ok: true, mode: "local" });

    await configureRealProvider(page, provider, {
      enableAppBlueprint: false,
    });

    const created = await rpc<{
      app: { id: number; name: string; resolvedPath: string };
      chatId: number;
    }>(page, "create-app", {
      name: `Web E2E ${Date.now()}`,
      initialChatMode: "build",
    });
    expect(created.app.resolvedPath).toContain(server!.userDataPath);

    await page.goto(`${pageUrl}/apps`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Apps" })).toBeVisible();
    await expect(page.getByTestId("apps-grid")).toBeVisible();
    await expect(page.getByText(created.app.name)).toBeVisible();
    e2eSummary.routes.desktop.apps = await collectRouteMetric(page);
    await saveScreenshot(page, "apps");

    await page.goto(`${pageUrl}/app-details?appId=${created.app.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("app-details-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: created.app.name }),
    ).toBeVisible();
    await saveScreenshot(page, "app-details");

    const realChatId = await rpc<number>(page, "create-chat", {
      appId: created.app.id,
      initialChatMode: "ask",
    });

    await page.goto(
      `${pageUrl}/chat?id=${realChatId}&appId=${created.app.id}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await expect(page.getByTestId("messages-list")).toBeVisible();
    await expect(page.getByTestId("chat-input-container")).toBeVisible();
    e2eSummary.routes.desktop.chat = await collectRouteMetric(page);
    await saveScreenshot(page, "chat");

    await verifyVisiblePreviewFlow(page, created.app.id);
    await verifyVisibleRealProviderChat(page, realChatId);

    await page.goto(`${pageUrl}/library`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(
      page.getByText(/No items in your library yet|No media files yet/),
    ).toBeVisible();
    await page.goto(`${pageUrl}/library/prompts`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(/No prompts yet|Create one/)).toBeVisible();
    await page.goto(`${pageUrl}/library/themes`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Themes" })).toBeVisible();
    await page.goto(`${pageUrl}/library/media`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Media" })).toBeVisible();
    e2eSummary.routes.desktop.library = await collectRouteMetric(page);
    await saveScreenshot(page, "library-media");

    await page.goto(`${pageUrl}/settings`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Zoom level", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Customize Apps Folder", { exact: true }),
    ).toBeVisible();
    e2eSummary.routes.desktop.settings = await collectRouteMetric(page);
    await saveScreenshot(page, "settings");

    await verifyMobileWebFlow(browser, {
      server: server!,
      appId: created.app.id,
      chatId: realChatId,
      provider,
      summary: e2eSummary,
      captureFailures: {
        consoleMessages,
        networkFailures,
        backendFailures,
        ignoredFailures,
      },
    });

    const proposalChatId = await rpc<number>(page, "create-chat", {
      appId: created.app.id,
      initialChatMode: "build",
    });
    await verifyChatProposalFlow(page, proposalChatId);
    await verifyTerminalSseFlow(page, created.app.id);
    await verifyRuntimeOutputFlow(page, created.app.id);
    await verifyIntegrationFlow(page);

    await expectNoUnsupportedChannels({
      consoleMessages,
      networkFailures,
      backendFailures,
    });
  });
});

function createEmptySummary(): WebE2eSummary {
  return {
    routes: { desktop: {}, mobile: {} },
    screenshots: [],
    accessibility: {},
    mobileChat: null,
    mobilePreview: null,
  };
}

function resetSummary(summary: WebE2eSummary) {
  summary.routes.desktop = {};
  summary.routes.mobile = {};
  summary.screenshots.length = 0;
  summary.accessibility = {};
  summary.mobileChat = null;
  summary.mobilePreview = null;
}

async function startLocalWebServer(
  baseUserDataPath: string,
  provider: RealProviderConfig,
): Promise<LocalWebServer> {
  await fs.mkdir(baseUserDataPath, { recursive: true });
  const userDataPath = await fs.mkdtemp(
    path.join(baseUserDataPath, "local-web-"),
  );
  const output: string[] = [];
  const child = spawn("npm", ["run", "dev:web"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DYAD_LOCAL_WEB_PAGE_PORT: "0",
      DYAD_LOCAL_WEB_API_PORT: "0",
      DYAD_LOCAL_WEB_USER_DATA_PATH: userDataPath,
      OPENAI_API_KEY: provider.apiKey,
      OPENAI_BASE_URL: provider.baseUrl ?? "",
      E2E_TEST_BUILD: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const started = await waitForLocalWebOutput(output, child);
  return {
    ...started,
    userDataPath,
    process: child,
    output,
    provider,
  };
}

async function readRealProviderConfig(): Promise<RealProviderConfig> {
  const envApiKey = process.env.OPENAI_API_KEY;
  const envBaseUrl = process.env.OPENAI_BASE_URL ?? null;
  const envModel = process.env.DYAD_WEB_E2E_MODEL ?? process.env.OPENAI_MODEL;
  if (envApiKey && envModel) {
    return {
      source: "env",
      apiKey: envApiKey,
      baseUrl: envBaseUrl,
      model: envModel,
    };
  }

  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
  const [configText, authText] = await Promise.all([
    fs.readFile(codexConfigPath, "utf8"),
    fs.readFile(codexAuthPath, "utf8"),
  ]).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Real provider config is required for web_portal.spec.ts. Set OPENAI_API_KEY and DYAD_WEB_E2E_MODEL, or provide Codex config/auth files. ${detail}`,
    );
  });
  const auth = JSON.parse(authText) as { OPENAI_API_KEY?: string };
  const apiKey = auth.OPENAI_API_KEY;
  const model = matchTomlValue(configText, "model");
  if (!apiKey || !model) {
    throw new Error(
      "Real provider config is required for web_portal.spec.ts. Codex auth/config must include OPENAI_API_KEY and model.",
    );
  }
  return {
    source: "codex",
    apiKey,
    baseUrl: matchTomlValue(configText, "base_url"),
    model,
  };
}

function matchTomlValue(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? null;
}

async function stopLocalWebServer(server: LocalWebServer): Promise<void> {
  const child = server.process;
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  const closed = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
  }
}

async function waitForLocalWebOutput(
  output: string[],
  child: ChildProcess,
): Promise<{ pageUrl: string; apiUrl: string }> {
  const deadline = Date.now() + 45_000;
  let exitError: Error | undefined;
  child.once("exit", (code, signal) => {
    exitError = new Error(
      `Local Web server exited before startup: code=${code} signal=${signal}\n${output.join("")}`,
    );
  });
  while (Date.now() < deadline) {
    if (exitError) throw exitError;
    const text = output.join("");
    const pageUrl = text.match(/Web UI:\s+(http:\/\/[^\s]+)/)?.[1];
    const apiUrl = text.match(/API:\s+(http:\/\/[^\s]+)/)?.[1];
    if (pageUrl && apiUrl) {
      return { pageUrl, apiUrl };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for Local Web startup\n${output.join("")}`,
  );
}

function attachBrowserFailureCapture(
  page: Page,
  targets: {
    consoleMessages: string[];
    networkFailures: string[];
    backendFailures: string[];
    ignoredFailures: string[];
  },
) {
  page.on("console", (message) => {
    const text = message.text();
    if (isIgnorableConsoleMessage(text) || isIntentionalConsoleMessage(text)) {
      targets.ignoredFailures.push(`[${message.type()}] ${text}`);
      return;
    }
    if (
      message.type() === "error" ||
      text.includes("No local RPC handler registered") ||
      text.includes("unsupported-channel")
    ) {
      targets.consoleMessages.push(`[${message.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    targets.consoleMessages.push(`[pageerror] ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (
      isIgnorableRequestFailure(request.url(), request.failure()?.errorText)
    ) {
      targets.ignoredFailures.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText}`,
      );
      return;
    }
    targets.networkFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    );
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/rpc/") && !url.includes("/api/events")) {
      return;
    }
    if (response.status() < 400) {
      return;
    }
    if (isIntentionalResponseFailure(url, response.status())) {
      targets.ignoredFailures.push(`${response.status()} ${url}`);
      return;
    }
    targets.backendFailures.push(`${response.status()} ${url}`);
  });
}

function isIgnorableConsoleMessage(text: string): boolean {
  if (text.includes("[PostHog.js] TypeError: Failed to fetch")) {
    return true;
  }
  if (text.includes("[PostHog.js] AbortError: signal is aborted")) {
    return true;
  }
  return text.includes("HttpInvokeAbortError");
}

function isIntentionalConsoleMessage(text: string): boolean {
  return text.includes("server responded with a status of 401");
}

function isIntentionalResponseFailure(url: string, status: number): boolean {
  return status === 401 && url.includes("github%3Alist-repos");
}

function isIgnorableRequestFailure(
  url: string,
  errorText: string | undefined,
): boolean {
  if (errorText !== "net::ERR_ABORTED") {
    return false;
  }
  const parsed = new URL(url);
  return (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith("posthog.com") ||
    parsed.hostname === "cdn.jsdelivr.net" ||
    parsed.hostname === "img.youtube.com"
  );
}

async function fetchJson(page: Page, url: string): Promise<unknown> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.json();
  }, url);
}

async function configureRealProvider(
  page: Page,
  provider: RealProviderConfig,
  overrides: Record<string, unknown> = {},
) {
  await rpc(page, "set-user-settings", {
    selectedModel: { provider: "openai", name: provider.model },
    selectedChatMode: "build",
    providerSettings: {
      openai: {
        apiKey: { value: provider.apiKey, encryptionType: "plaintext" },
      },
    },
    ...overrides,
  });
}

async function verifyVisiblePreviewFlow(page: Page, appId: number) {
  const previewModeButton = page.getByTestId("preview-mode-button");
  if (!(await previewModeButton.isVisible().catch(() => false))) {
    await page.getByTestId("toggle-preview-panel-button").click();
    await expect(previewModeButton).toBeVisible();
  }
  if ((await previewModeButton.getAttribute("aria-pressed")) !== "true") {
    await previewModeButton.click();
  }
  await expect
    .poll(
      async () => {
        const preview = await rpc<{
          appUrl: string;
          originalUrl: string;
          mode: string;
        } | null>(page, "app:get-running-preview", { appId });
        return {
          hasAppUrl: Boolean(preview?.appUrl),
          mode: preview?.mode ?? null,
        };
      },
      {
        timeout: 120_000,
        message: "local web runtime should expose the running preview URL",
      },
    )
    .toMatchObject({ hasAppUrl: true });
  const iframe = page.getByTestId("preview-iframe-element");
  await expect(iframe).toBeAttached({ timeout: 120_000 });
  await expect
    .poll(
      async () => {
        const src = await iframe.getAttribute("src").catch(() => null);
        const frame = await iframe.contentFrame();
        const text = frame
          ? await frame
              .locator("body")
              .textContent({ timeout: 1_000 })
              .catch(() => null)
          : null;
        return {
          hasSrc: Boolean(src),
          hasText: Boolean(text?.trim()),
          text,
        };
      },
      { timeout: 120_000 },
    )
    .toMatchObject({ hasSrc: true, hasText: true });
  await saveScreenshot(page, "preview-visible");
}

async function verifyMobileWebFlow(
  browser: Browser,
  args: {
    server: LocalWebServer;
    appId: number;
    chatId: number;
    provider: RealProviderConfig;
    summary: WebE2eSummary;
    captureFailures: {
      consoleMessages: string[];
      networkFailures: string[];
      backendFailures: string[];
      ignoredFailures: string[];
    };
  },
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await context.newPage();
  attachBrowserFailureCapture(mobilePage, args.captureFailures);
  try {
    await mobilePage.goto(args.server.pageUrl, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      mobilePage.getByTestId("home-chat-input-container"),
    ).toBeVisible();
    args.summary.routes.mobile.home = await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(args.summary.routes.mobile.home, "home");
    await saveScreenshot(mobilePage, "mobile-home", args.summary);

    await mobilePage.goto(`${args.server.pageUrl}/apps`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      mobilePage.getByRole("heading", { name: "Apps" }),
    ).toBeVisible();
    args.summary.routes.mobile.apps = await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(args.summary.routes.mobile.apps, "apps");

    await mobilePage.goto(
      `${args.server.pageUrl}/chat?id=${args.chatId}&appId=${args.appId}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(mobilePage.getByTestId("chat-input-container")).toBeVisible();
    await expect(mobilePage.getByTestId("messages-list")).toBeVisible();
    args.summary.routes.mobile.chat = await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(args.summary.routes.mobile.chat, "chat");
    await expect(
      mobilePage.getByRole("button", { name: /send message/i }),
    ).toBeVisible();
    await expect(
      mobilePage.getByRole("button", { name: /show preview/i }),
    ).toBeVisible();
    args.summary.accessibility.mobileSendButton = true;
    args.summary.accessibility.mobilePreviewSwitch = true;
    await saveScreenshot(mobilePage, "mobile-chat", args.summary);

    await verifyVisibleRealProviderChat(mobilePage, args.chatId);
    args.summary.mobileChat = {
      provider: "openai",
      model: args.provider.model,
      responseVisible: true,
    };
    await saveScreenshot(mobilePage, "mobile-chat-real-provider", args.summary);

    await mobilePage.getByRole("button", { name: /show preview/i }).click();
    const mobilePreview = await waitForPreviewIframeEvidence(mobilePage);
    args.summary.mobilePreview = mobilePreview;
    args.summary.routes.mobile.preview = await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(
      args.summary.routes.mobile.preview,
      "preview",
    );
    await expect(
      mobilePage.getByRole("button", { name: /back to chat/i }),
    ).toBeVisible();
    await expect(mobilePage.getByTestId("device-mode-button")).toBeVisible();
    await expect(
      mobilePage.getByTestId("preview-mode-overflow-button"),
    ).toBeVisible();
    await expect(
      mobilePage.getByTestId("preview-more-options-button"),
    ).toBeVisible();
    args.summary.accessibility.mobileBackToChat = true;
    args.summary.accessibility.mobileDeviceMode = true;
    args.summary.accessibility.mobilePreviewModeOverflow = true;
    args.summary.accessibility.mobileMoreOptions = true;
    await saveScreenshot(mobilePage, "mobile-preview", args.summary);

    await mobilePage.getByTestId("device-mode-button").click();
    await expect(
      mobilePage.getByRole("button", { name: "Mobile view" }),
    ).toBeVisible();
    await saveScreenshot(mobilePage, "mobile-preview-controls", args.summary);
    await mobilePage.keyboard.press("Escape").catch(() => undefined);

    await mobilePage.getByRole("button", { name: /back to chat/i }).click();
    await expect(mobilePage.getByTestId("chat-input-container")).toBeVisible();
    await expect(
      mobilePage.getByTestId("preview-iframe-element"),
    ).not.toBeAttached();
    args.summary.routes.mobile.backToChat =
      await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(
      args.summary.routes.mobile.backToChat,
      "back-to-chat",
    );
    await saveScreenshot(mobilePage, "mobile-back-to-chat", args.summary);

    await mobilePage.goto(`${args.server.pageUrl}/settings`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      mobilePage.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    args.summary.routes.mobile.settings = await collectRouteMetric(mobilePage);
    await expectNoHorizontalOverflow(
      args.summary.routes.mobile.settings,
      "settings",
    );
    args.summary.accessibility.mobileNavigation = await mobilePage
      .getByRole("button", { name: /toggle menu/i })
      .isVisible();
    await saveScreenshot(mobilePage, "mobile-settings", args.summary);
  } finally {
    await mobilePage.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

async function verifyVisibleRealProviderChat(page: Page, chatId: number) {
  const expectedToken = "DYAD_WEB_E2E_REAL_CHAT_OK";
  const editor = page.locator('[contenteditable="true"]').last();
  await editor.click();
  await editor.fill(
    `This is a UI test. Reply with exactly this token and no other words: ${expectedToken}`,
  );
  await page.getByRole("button", { name: /send message/i }).click();

  await expect
    .poll(
      async () => {
        const errorText = await page
          .getByTestId("chat-error-box")
          .textContent({ timeout: 500 })
          .catch(() => null);
        if (errorText) {
          return { state: "error", text: errorText };
        }
        const chat = await rpc<{
          messages?: { role: string; content: string }[];
        }>(page, "get-chat", chatId).catch(() => null);
        const assistantText = chat?.messages
          ?.filter((message) => message.role === "assistant")
          .at(-1)?.content;
        const visibleText = await page
          .getByTestId("messages-list")
          .textContent()
          .catch(() => "");
        const streaming = await page
          .getByRole("button", { name: /cancel generation/i })
          .isVisible()
          .catch(() => false);
        return {
          state:
            assistantText?.includes(expectedToken) &&
            visibleText?.includes(expectedToken) &&
            !streaming
              ? "ok"
              : "waiting",
          text: assistantText ?? visibleText,
        };
      },
      {
        timeout: 120_000,
        message: "visible real-provider chat should render assistant response",
      },
    )
    .toMatchObject({ state: "ok" });
  await saveScreenshot(page, "chat-real-provider");
}

async function waitForPreviewIframeEvidence(
  page: Page,
): Promise<WebE2eSummary["mobilePreview"]> {
  const iframe = page.getByTestId("preview-iframe-element");
  await expect(iframe).toBeAttached({ timeout: 120_000 });
  return expect
    .poll(
      async () => {
        const src = await iframe.getAttribute("src").catch(() => null);
        const frame = await iframe.contentFrame();
        const text = frame
          ? await frame
              .locator("body")
              .textContent({ timeout: 1_000 })
              .catch(() => null)
          : null;
        const addressPath = await page
          .locator('[data-testid="preview-address-bar-path"]')
          .textContent({ timeout: 1_000 })
          .catch(() => null);
        return {
          iframeSrc: src,
          iframeHasText: Boolean(text?.trim()),
          addressPath,
        };
      },
      { timeout: 120_000 },
    )
    .toMatchObject({ iframeHasText: true })
    .then(async () => {
      const src = await iframe.getAttribute("src");
      const frame = await iframe.contentFrame();
      const text = frame
        ? await frame.locator("body").textContent({ timeout: 1_000 })
        : null;
      const addressPath = await page
        .locator('[data-testid="preview-address-bar-path"]')
        .textContent({ timeout: 1_000 })
        .catch(() => null);
      return {
        iframeSrc: src,
        iframeHasText: Boolean(text?.trim()),
        addressPath,
      };
    });
}

async function rpc<T>(page: Page, channel: string, body?: unknown): Promise<T> {
  const result = await rpcResult<T>(page, channel, body);
  if (!result.ok) {
    throw new Error(
      `${channel} failed: ${result.error}${result.kind ? ` (${result.kind})` : ""}`,
    );
  }
  return result.data;
}

async function rpcResult<T>(
  page: Page,
  channel: string,
  body?: unknown,
): Promise<RpcResult<T>> {
  return page.evaluate(
    async ({ channel, body }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing from browser page");
      }
      const response = await fetch(
        `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
            origin: location.origin,
          },
          body: JSON.stringify(body),
        },
      );
      const text = await response.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        return {
          ok: false,
          error: `Non-JSON RPC response for ${channel}: status=${response.status} body=${text.slice(0, 200)}`,
        };
      }
      if (!response.ok || !json.ok) {
        return {
          ok: false,
          error: json.error ?? "Unknown local Web RPC error",
          kind: json.kind,
        };
      }
      return { ok: true, data: json.data };
    },
    { channel, body },
  );
}

async function streamRpc(
  page: Page,
  channel: string,
  body?: unknown,
): Promise<StreamRpcEvent[]> {
  return page.evaluate(
    async ({ channel, body }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing from browser page");
      }
      const response = await fetch(
        `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
            origin: location.origin,
          },
          body: JSON.stringify(body),
        },
      );
      const text = await response.text();
      const events = text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as StreamRpcEvent);
      if (!response.ok) {
        throw new Error(
          `${channel} stream failed: status=${response.status} body=${text.slice(0, 200)}`,
        );
      }
      const errorEvent = events.find((event) => event.type === "error");
      if (errorEvent?.type === "error") {
        throw new Error(`${channel} stream failed: ${errorEvent.error}`);
      }
      return events;
    },
    { channel, body },
  );
}

async function subscribe(
  page: Page,
  channel: string,
): Promise<{
  ready(): Promise<void>;
  stop(): Promise<void>;
  events(): Promise<unknown[]>;
}> {
  const key = `webE2eSse${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ key, channel }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing from browser page");
      }
      const controller = new AbortController();
      const events: unknown[] = [];
      let markReady: () => void = () => {};
      const opened = new Promise<void>((resolve) => {
        markReady = resolve;
      });
      const url = new URL("/api/events", config.baseUrl);
      url.searchParams.set("channel", channel);
      const ready = fetch(url, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${config.token}`,
          origin: location.origin,
        },
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`SSE ${channel} failed with ${response.status}`);
        }
        markReady();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let event = "";
            const data: string[] = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              if (line.startsWith("data:"))
                data.push(line.slice(5).trimStart());
            }
            if (event) {
              events.push({ event, data: JSON.parse(data.join("\n")) });
            }
          }
        }
      });
      (globalThis as unknown as Record<string, unknown>)[key] = {
        controller,
        events,
        opened,
        ready,
      };
    },
    { key, channel },
  );
  return {
    async ready() {
      await page.evaluate(async (key) => {
        const state = (globalThis as any)[key];
        await state?.opened;
      }, key);
    },
    async stop() {
      await page.evaluate(async (key) => {
        const state = (globalThis as any)[key];
        state?.controller.abort();
        await state?.ready.catch(() => undefined);
        delete (globalThis as any)[key];
      }, key);
    },
    events() {
      return page.evaluate((key) => {
        return [...((globalThis as any)[key]?.events ?? [])];
      }, key);
    },
  };
}

async function waitForSseEvent(
  subscription: { events(): Promise<unknown[]> },
  predicate: (event: any) => boolean,
  timeoutMs = 20_000,
) {
  await expect
    .poll(
      async () => {
        const events = await subscription.events();
        return events.some(predicate);
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
}

async function verifyChatProposalFlow(page: Page, chatId: number) {
  const chunks = await subscribe(page, "chat:response:chunk");
  const ends = await subscribe(page, "chat:response:end");
  const streamEnds = await subscribe(page, "chat:stream:end");
  try {
    const streamEvents = await streamRpc(page, "chat:stream", {
      chatId,
      prompt: "[dyad-qa=write]",
      selectedComponents: [],
    });
    expect(streamEvents.some((event) => event.type === "ready")).toBe(true);
    expect(streamEvents.some((event) => event.type === "result")).toBe(true);
    await waitForSseEvent(chunks, (event) => event.data?.chatId === chatId);
    await rpc(page, "chat:response:ack", { chatId, lastSeq: 1 });
    await waitForSseEvent(ends, (event) => event.data?.chatId === chatId);
    await waitForSseEvent(streamEnds, (event) => event.data?.chatId === chatId);
    const proposal = await rpc<{
      messageId?: number;
      proposal?: { type: string; filesChanged: unknown[] };
    }>(page, "get-proposal", { chatId });
    expect(proposal.messageId).toBeTruthy();
    await rpc(page, "reject-proposal", {
      chatId,
      messageId: proposal.messageId,
    });
  } finally {
    await chunks.stop();
    await ends.stop();
    await streamEnds.stop();
  }
}

async function verifyTerminalSseFlow(page: Page, appId: number) {
  const opened = await rpc<{
    sessionId: string;
    cwd: string;
    shell: string;
    created: boolean;
  }>(page, "terminal:open", {
    appId,
    cols: 80,
    rows: 24,
  });
  expect(opened.created).toBe(true);
  const terminalData = await subscribe(
    page,
    `terminal:data:${opened.sessionId}`,
  );
  try {
    await rpc(page, "terminal:write", {
      sessionId: opened.sessionId,
      data: `printf web-e2e-terminal-${appId}\\n`,
    });
    await waitForSseEvent(
      terminalData,
      (event) => String(event.data?.chunk ?? "").includes("web-e2e-terminal"),
      20_000,
    );
    const serialized = await rpc<{ scrollback: string }>(
      page,
      "terminal:serialize",
      { sessionId: opened.sessionId },
    );
    expect(serialized.scrollback).toContain("web-e2e-terminal");
  } finally {
    await terminalData.stop();
    await rpc(page, "terminal:close", { sessionId: opened.sessionId }).catch(
      () => undefined,
    );
  }
}

async function verifyRuntimeOutputFlow(page: Page, appId: number) {
  const appPort = 32100 + (appId % 10_000);
  const installScript = "process.exit(0)";
  const startScript = `const http=require('http');const port=${appPort};http.createServer((req,res)=>res.end('web-e2e-preview')).listen(port,'127.0.0.1',()=>console.log('web-e2e-runtime-started http://localhost:${appPort}/'));`;
  await rpc(page, "stop-app", { appId }).catch(() => undefined);
  await rpc(page, "update-app-commands", {
    appId,
    installCommand: `${process.execPath} -e ${JSON.stringify(installScript)}`,
    startCommand: `${process.execPath} -e ${JSON.stringify(startScript)}`,
  });
  const output = await subscribe(page, "app:output");
  const outputBatch = await subscribe(page, "app:output-batch");
  try {
    await Promise.all([output.ready(), outputBatch.ready()]);
    await rpc(page, "run-app", { appId });
    await waitForAppOutput([output, outputBatch], appId, (message) =>
      message.includes("web-e2e-runtime-started"),
    );
    await waitForAppOutput([output, outputBatch], appId, (message) =>
      message.includes("[dyad-proxy-server]started=["),
    );
    const preview = await rpc<{
      appUrl: string;
      originalUrl: string;
      mode: string;
    } | null>(page, "app:get-running-preview", { appId });
    expect(preview).toMatchObject({
      appUrl: expect.stringContaining(`/api/preview/${appId}/`),
      originalUrl: `http://localhost:${appPort}/`,
      mode: "host",
    });
  } finally {
    await output.stop();
    await outputBatch.stop();
    await rpc(page, "stop-app", { appId }).catch(() => undefined);
  }
}

async function waitForAppOutput(
  subscriptions: { events(): Promise<unknown[]> }[],
  appId: number,
  predicate: (message: string) => boolean,
) {
  const deadline = Date.now() + 30_000;
  let latestOutputs: any[] = [];
  while (Date.now() < deadline) {
    const groups = await Promise.all(
      subscriptions.map((subscription) => subscription.events()),
    );
    latestOutputs = groups
      .flat()
      .flatMap((event: any) =>
        Array.isArray(event.data) ? event.data : [event.data],
      )
      .filter((output: any) => output?.appId === appId);
    if (
      latestOutputs.some((output: any) =>
        predicate(String(output.message ?? "")),
      )
    ) {
      return;
    }
    await pageWait(100);
  }
  throw new Error(
    `Timed out waiting for app output. Received: ${JSON.stringify(
      latestOutputs.map((output: any) => ({
        type: output.type,
        message: output.message,
      })),
      null,
      2,
    )}`,
  );
}

function pageWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyIntegrationFlow(page: Page) {
  const providers = await rpc<unknown[]>(page, "get-language-model-providers");
  expect(providers.length).toBeGreaterThan(0);
  const github = await rpcResult(page, "github:list-repos");
  expect(github.ok).toBe(false);
  if (!github.ok) {
    expect(github.kind).toBe("auth");
  }
  const mcpServer = await rpc<{ id: number }>(page, "mcp:create-server", {
    name: "Web E2E MCP",
    transport: "http",
    url: "https://example.com/mcp",
    enabled: true,
    oauthEnabled: false,
  });
  expect(mcpServer.id).toBe(0);
  const mcpServers = await rpc<unknown[]>(page, "mcp:list-servers");
  expect(mcpServers).toEqual([]);
  const probe = await rpc<{ status: string; error?: string }>(
    page,
    "mcp:probe-connection",
    0,
  );
  expect(probe).toMatchObject({ status: "error" });
  expect(probe.error).toContain("Local Web mode");
}

async function collectRouteMetric(page: Page): Promise<RouteMetric> {
  return page.evaluate(() => {
    const visibleSurface = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          "#root",
          "[data-testid='home-chat-input-container']",
          "[data-testid='apps-grid']",
          "[data-testid='messages-list']",
          "[data-testid='preview-iframe-element']",
          "[data-testid='app-details-page']",
          "main",
          "h1",
        ].join(","),
      ),
    ).some((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    });
    return {
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1,
      hasVisibleSurface: visibleSurface,
    };
  });
}

async function expectNoHorizontalOverflow(metric: RouteMetric, route: string) {
  expect(metric, `${route} should render a visible page surface`).toMatchObject(
    {
      hasVisibleSurface: true,
    },
  );
  expect(
    metric.horizontalOverflow,
    `${route} should not horizontally overflow: scrollWidth=${metric.documentScrollWidth}, innerWidth=${metric.innerWidth}`,
  ).toBe(false);
}

async function saveScreenshot(
  page: Page,
  name: string,
  summary?: WebE2eSummary,
) {
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
  });
  summary?.screenshots.push(screenshotPath);
}

async function expectNoUnsupportedChannels(failures: {
  consoleMessages: string[];
  networkFailures: string[];
  backendFailures: string[];
}) {
  const combined = [
    ...failures.consoleMessages,
    ...failures.networkFailures,
    ...failures.backendFailures,
  ];
  expect(
    combined.filter(
      (entry) =>
        entry.includes("No local RPC handler registered") ||
        entry.includes("unsupported-channel") ||
        entry.includes("LocalWebTransportConfigError"),
    ),
  ).toEqual([]);
}
