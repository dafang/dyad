import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = path.resolve(".supergoal", "mobile-web-audit");
const token = "dyad-mobile-web-audit-token-32-bytes-min";

await fs.mkdir(auditDir, { recursive: true });

const server = await startLocalWebServer();
const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  server: {
    pageUrl: server.pageUrl,
    apiUrl: server.apiUrl,
    userDataPath: server.userDataPath,
  },
  created: null,
  mobile: {},
  desktop: {},
  localWebOutputTail: [],
};

try {
  const setupPage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await setupPage.goto(server.pageUrl, { waitUntil: "domcontentloaded" });
  await rpc(setupPage, "set-user-settings", {
    enableAppBlueprint: false,
    selectedChatMode: "ask",
  });
  const created = await rpc(setupPage, "create-app", {
    name: `Mobile Preview ${Date.now()}`,
    initialChatMode: "ask",
  });
  const chatId = await rpc(setupPage, "create-chat", {
    appId: created.app.id,
    initialChatMode: "ask",
  });
  report.created = {
    appId: created.app.id,
    appName: created.app.name,
    chatId,
    resolvedPath: created.app.resolvedPath,
  };
  await setupPage.close();

  const mobilePage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const chatUrl = new URL(
    `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
      String(created.app.id),
    )}`,
    server.pageUrl,
  ).toString();
  await mobilePage.goto(chatUrl, { waitUntil: "domcontentloaded" });
  await mobilePage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  const chatScreenshot = path.join(auditDir, "phase4-mobile-chat.png");
  await mobilePage.screenshot({ path: chatScreenshot, fullPage: true });
  report.mobile.chat = {
    screenshot: chatScreenshot,
    metrics: await collectPreviewMetrics(mobilePage),
  };

  await mobilePage.getByTestId("toggle-preview-panel-button").click();
  await waitForPreviewReady(mobilePage, created.app.id);
  const previewScreenshot = path.join(auditDir, "phase4-mobile-preview.png");
  await mobilePage.screenshot({ path: previewScreenshot, fullPage: true });
  report.mobile.preview = {
    screenshot: previewScreenshot,
    metrics: await collectPreviewMetrics(mobilePage),
    iframe: await collectIframeEvidence(mobilePage),
  };

  await mobilePage.getByTestId("device-mode-button").click();
  const controlsScreenshot = path.join(
    auditDir,
    "phase4-mobile-preview-controls.png",
  );
  await mobilePage.screenshot({ path: controlsScreenshot, fullPage: true });
  report.mobile.controls = {
    screenshot: controlsScreenshot,
    metrics: await collectPreviewMetrics(mobilePage),
    devicePopoverVisible: await mobilePage
      .getByRole("button", { name: "Mobile view" })
      .isVisible()
      .catch(() => false),
    overflowVisible: await mobilePage
      .getByTestId("preview-mode-overflow-button")
      .isVisible()
      .catch(() => false),
    moreOptionsVisible: await mobilePage
      .getByTestId("preview-more-options-button")
      .isVisible()
      .catch(() => false),
  };
  await mobilePage.keyboard.press("Escape").catch(() => undefined);

  await mobilePage.getByTestId("mobile-preview-back-to-chat-button").click();
  await mobilePage.waitForTimeout(250);
  const backScreenshot = path.join(auditDir, "phase4-mobile-back-chat.png");
  await mobilePage.screenshot({ path: backScreenshot, fullPage: true });
  report.mobile.backToChat = {
    screenshot: backScreenshot,
    metrics: await collectPreviewMetrics(mobilePage),
  };
  await mobilePage.close();

  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await desktopPage.goto(chatUrl, { waitUntil: "domcontentloaded" });
  await desktopPage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await waitForPreviewReady(desktopPage, created.app.id);
  const desktopScreenshot = path.join(
    auditDir,
    "phase4-desktop-preview-split-pane.png",
  );
  await desktopPage.screenshot({ path: desktopScreenshot, fullPage: true });
  report.desktop.preview = {
    screenshot: desktopScreenshot,
    metrics: await collectPreviewMetrics(desktopPage),
    iframe: await collectIframeEvidence(desktopPage),
  };
  await desktopPage.close();
} finally {
  await browser.close().catch(() => undefined);
  report.localWebOutputTail = server.output.slice(-80);
  await stopLocalWebServer(server);
  await fs.writeFile(
    path.join(auditDir, "phase4-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      pageUrl: server.pageUrl,
      apiUrl: server.apiUrl,
      report: path.join(auditDir, "phase4-report.json"),
      mobile: {
        chat: report.mobile.chat?.metrics,
        preview: {
          metrics: report.mobile.preview?.metrics,
          iframe: report.mobile.preview?.iframe,
        },
        controls: report.mobile.controls,
        backToChat: report.mobile.backToChat?.metrics,
      },
      desktop: {
        metrics: report.desktop.preview?.metrics,
        iframe: report.desktop.preview?.iframe,
      },
    },
    null,
    2,
  ),
);

async function startLocalWebServer() {
  const baseUserDataPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "dyad-mobile-web-audit-"),
  );
  const userDataPath = path.join(baseUserDataPath, "user-data");
  await fs.mkdir(userDataPath, { recursive: true });
  const output = [];
  const child = spawn("npm", ["run", "dev:web"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DYAD_LOCAL_WEB_PAGE_PORT: "0",
      DYAD_LOCAL_WEB_API_PORT: "0",
      DYAD_LOCAL_WEB_TOKEN: token,
      DYAD_LOCAL_WEB_USER_DATA_PATH: userDataPath,
      E2E_TEST_BUILD: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const started = await waitForLocalWebOutput(output, child);
  return { ...started, userDataPath, process: child, output };
}

async function waitForLocalWebOutput(output, child) {
  const deadline = Date.now() + 45_000;
  let exitError;
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

async function stopLocalWebServer(server) {
  const child = server.process;
  if (child.exitCode !== null || child.signalCode) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
  }
}

async function rpc(page, channel, body) {
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
      const json = text ? JSON.parse(text) : {};
      if (!response.ok || !json.ok) {
        throw new Error(
          `${channel} failed: ${json.error ?? response.statusText}`,
        );
      }
      return json.data;
    },
    { channel, body },
  );
}

async function waitForPreviewReady(page, appId) {
  await page.waitForFunction(
    async (appId) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      const response = await fetch(
        `${config.baseUrl}/api/rpc/${encodeURIComponent("app:get-running-preview")}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
            origin: location.origin,
          },
          body: JSON.stringify({ appId }),
        },
      );
      const json = await response.json();
      return Boolean(json?.data?.appUrl);
    },
    appId,
    { timeout: 120_000 },
  );
  await page.getByTestId("preview-iframe-element").waitFor({
    state: "attached",
    timeout: 120_000,
  });
  await page.waitForFunction(
    () => {
      const iframe = document.querySelector(
        '[data-testid="preview-iframe-element"]',
      );
      return Boolean(iframe?.getAttribute("src"));
    },
    undefined,
    { timeout: 120_000 },
  );
  const iframe = page.getByTestId("preview-iframe-element");
  await page.waitForTimeout(1000);
  const iframeHandle = await iframe.elementHandle();
  const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
  if (frame) {
    await frame.locator("body").waitFor({ state: "visible", timeout: 120_000 });
    await frame.waitForFunction(
      () => document.body.innerText.trim().length > 0,
      undefined,
      { timeout: 120_000 },
    );
  }
}

async function collectIframeEvidence(page) {
  const iframe = page.getByTestId("preview-iframe-element");
  const src = await iframe.getAttribute("src").catch(() => null);
  const iframeHandle = await iframe.elementHandle().catch(() => null);
  const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
  const bodyText =
    (await frame
      ?.locator("body")
      .textContent({ timeout: 5_000 })
      .catch(() => null)) ?? "";
  const addressPath =
    (await page
      .getByTestId("preview-address-bar-path")
      .textContent()
      .catch(() => "")) ?? "";
  return {
    src,
    bodyText: bodyText.trim().slice(0, 500),
    hasBodyText: bodyText.trim().length > 0,
    addressPath,
    usesLocalWebProxy: src?.includes("/api/preview/") ?? false,
  };
}

async function collectPreviewMetrics(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return { present: false };
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        present: true,
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden",
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    };
    const root = document.documentElement;
    const body = document.body;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentScrollWidth: root.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
      backToChat: rectFor('[data-testid="mobile-preview-back-to-chat-button"]'),
      previewToolbar: rectFor('[data-testid="preview-mode-button"]'),
      modeOverflow: rectFor('[data-testid="preview-mode-overflow-button"]'),
      deviceMode: rectFor('[data-testid="device-mode-button"]'),
      refresh: rectFor('[data-testid="preview-refresh-button"]'),
      openBrowser: rectFor('[data-testid="preview-open-browser-button"]'),
      restart: rectFor('[data-testid="preview-restart-button"]'),
      moreOptions: rectFor('[data-testid="preview-more-options-button"]'),
      iframe: rectFor('[data-testid="preview-iframe-element"]'),
      chatInput: rectFor('[data-testid="chat-input-container"]'),
      previewPanel: rectFor("#preview-panel"),
      chatPanel: rectFor("#chat-panel"),
    };
  });
}
