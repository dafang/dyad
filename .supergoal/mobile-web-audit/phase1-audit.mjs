import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = path.resolve(".supergoal", "mobile-web-audit");
const token = "dyad-mobile-web-audit-token-32-bytes-min";
const viewportProfiles = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

const routes = [
  { key: "home", path: "/" },
  { key: "apps", path: "/apps" },
  { key: "chat", path: null },
  { key: "preview", path: null, preview: true },
  { key: "settings", path: "/settings" },
  { key: "library", path: "/library" },
];

await fs.mkdir(auditDir, { recursive: true });

const server = await startLocalWebServer();
const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  server: {
    pageUrl: server.pageUrl,
    apiUrl: server.apiUrl,
    userDataPath: server.userDataPath,
    tokenSource: "DYAD_LOCAL_WEB_TOKEN env",
    mode: "local",
  },
  created: null,
  routes: [],
  issues: [],
  localWebOutputTail: [],
};

try {
  const setupPage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  attachFailureCapture(setupPage, "setup");
  await setupPage.goto(server.pageUrl, { waitUntil: "domcontentloaded" });
  await rpc(setupPage, "set-user-settings", {
    enableAppBlueprint: false,
    selectedChatMode: "ask",
  });
  const created = await rpc(setupPage, "create-app", {
    name: `Mobile Audit ${Date.now()}`,
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

  for (const profile of viewportProfiles) {
    const page = await browser.newPage({
      viewport: { width: profile.width, height: profile.height },
      isMobile: profile.isMobile,
      hasTouch: profile.isMobile,
    });
    const captured = attachFailureCapture(page, profile.name);
    for (const route of routes) {
      const url =
        route.path ??
        `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
          String(created.app.id),
        )}`;
      await page.goto(new URL(url, server.pageUrl).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => undefined);

      if (route.preview) {
        await openPreview(page, created.app.id);
      }

      const screenshot = path.join(
        auditDir,
        `phase1-${profile.name}-${route.key}.png`,
      );
      await page.screenshot({ path: screenshot, fullPage: true });
      const metrics = await collectMetrics(page);
      const entry = {
        viewport: profile.name,
        route: route.key,
        url: page.url(),
        screenshot,
        metrics,
        controls: await collectControls(page),
        errors: {
          console: [...captured.consoleMessages],
          network: [...captured.networkFailures],
          backend: [...captured.backendFailures],
        },
      };
      report.routes.push(entry);
      addIssues(report.issues, entry);
      captured.consoleMessages.length = 0;
      captured.networkFailures.length = 0;
      captured.backendFailures.length = 0;
    }
    await page.close();
  }
} finally {
  await browser.close().catch(() => undefined);
  report.localWebOutputTail = server.output.slice(-80);
  await stopLocalWebServer(server);
  await fs.writeFile(
    path.join(auditDir, "phase1-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      pageUrl: server.pageUrl,
      apiUrl: server.apiUrl,
      report: path.join(auditDir, "phase1-report.json"),
      screenshots: report.routes.map((route) => route.screenshot),
      issues: report.issues,
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

function attachFailureCapture(page, label) {
  const captured = {
    consoleMessages: [],
    networkFailures: [],
    backendFailures: [],
  };
  page.on("console", (message) => {
    const text = message.text();
    if (isIgnorableConsoleMessage(text)) return;
    if (message.type() === "error") {
      captured.consoleMessages.push(`[${label}] [${message.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    captured.consoleMessages.push(`[${label}] [pageerror] ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (
      isIgnorableRequestFailure(request.url(), request.failure()?.errorText)
    ) {
      return;
    }
    captured.networkFailures.push(
      `[${label}] ${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    );
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/api/rpc/") && !url.includes("/api/events")) return;
    if (response.status() < 400) return;
    captured.backendFailures.push(`[${label}] ${response.status()} ${url}`);
  });
  return captured;
}

function isIgnorableConsoleMessage(text) {
  return (
    text.includes("[PostHog.js] TypeError: Failed to fetch") ||
    text.includes("[PostHog.js] AbortError: signal is aborted") ||
    text.includes("HttpInvokeAbortError")
  );
}

function isIgnorableRequestFailure(url, errorText) {
  if (errorText !== "net::ERR_ABORTED") return false;
  const parsed = new URL(url);
  return (
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith("posthog.com") ||
    parsed.hostname === "cdn.jsdelivr.net" ||
    parsed.hostname === "img.youtube.com"
  );
}

async function rpc(page, channel, body) {
  return page.evaluate(
    async ({ channel, body, token }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl) {
        throw new Error("Local Web config missing from browser page");
      }
      const response = await fetch(
        `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            origin: location.origin,
          },
          body: JSON.stringify(body),
        },
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(
          `${channel} failed: ${json.error ?? response.statusText}`,
        );
      }
      return json.data;
    },
    { channel, body, token },
  );
}

async function openPreview(page, appId) {
  const button = page.getByTestId("preview-mode-button");
  if (!(await button.isVisible().catch(() => false))) {
    await page
      .getByTestId("toggle-preview-panel-button")
      .click()
      .catch(() => undefined);
  }
  await page
    .getByTestId("preview-mode-button")
    .click()
    .catch(() => undefined);
  await page
    .waitForFunction(
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
      { timeout: 60_000 },
    )
    .catch(() => undefined);
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const active = document.activeElement;
    const visibleText = body.innerText.trim().slice(0, 500);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentScrollWidth: root.scrollWidth,
      documentScrollHeight: root.scrollHeight,
      bodyScrollWidth: body.scrollWidth,
      horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
      blank: visibleText.length === 0,
      activeElement: active
        ? {
            tag: active.tagName,
            text: active.textContent?.trim().slice(0, 80) ?? "",
            ariaLabel: active.getAttribute("aria-label"),
          }
        : null,
      visibleText,
    };
  });
}

async function collectControls(page) {
  return page.evaluate(() => {
    const labels = [
      "toggle-preview-panel-button",
      "preview-mode-button",
      "preview-refresh-button",
      "preview-restart-button",
      "preview-open-browser-button",
      "chat-input-container",
      "messages-list",
      "apps-grid",
    ];
    return Object.fromEntries(
      labels.map((testId) => {
        const node = document.querySelector(`[data-testid="${testId}"]`);
        if (!node) return [testId, { present: false }];
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return [
          testId,
          {
            present: true,
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none",
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          },
        ];
      }),
    );
  });
}

function addIssues(issues, entry) {
  const area = routeToArea(entry.route);
  if (entry.metrics.horizontalOverflow) {
    issues.push({
      area,
      viewport: entry.viewport,
      route: entry.route,
      type: "horizontal-overflow",
      owners: ownersForArea(area),
      detail: `scrollWidth=${entry.metrics.documentScrollWidth}, innerWidth=${entry.metrics.innerWidth}`,
    });
  }
  if (entry.metrics.blank) {
    issues.push({
      area,
      viewport: entry.viewport,
      route: entry.route,
      type: "blank-content",
      owners: ownersForArea(area),
      detail: "body innerText is empty",
    });
  }
  for (const [kind, messages] of Object.entries(entry.errors)) {
    for (const message of messages) {
      issues.push({
        area,
        viewport: entry.viewport,
        route: entry.route,
        type: kind,
        owners: ownersForArea(area),
        detail: message,
      });
    }
  }
  if (
    entry.viewport === "mobile" &&
    entry.route === "chat" &&
    !entry.controls["chat-input-container"]?.visible
  ) {
    issues.push({
      area: "chat",
      viewport: entry.viewport,
      route: entry.route,
      type: "unreachable-control",
      owners: ownersForArea("chat"),
      detail: "chat input container not visible",
    });
  }
  if (
    entry.viewport === "mobile" &&
    entry.route === "preview" &&
    !entry.controls["preview-mode-button"]?.visible
  ) {
    issues.push({
      area: "preview",
      viewport: entry.viewport,
      route: entry.route,
      type: "unreachable-control",
      owners: ownersForArea("preview"),
      detail: "preview mode button not visible",
    });
  }
}

function routeToArea(route) {
  if (route === "chat") return "chat";
  if (route === "preview") return "preview";
  return "shell";
}

function ownersForArea(area) {
  if (area === "chat") {
    return [
      "src/pages/chat.tsx",
      "src/components/ChatPanel.tsx",
      "src/components/chat/ChatInput.tsx",
      "src/components/chat/MessagesList.tsx",
      "src/components/chat/ChatHeader.tsx",
    ];
  }
  if (area === "preview") {
    return [
      "src/pages/chat.tsx",
      "src/components/preview_panel/PreviewPanel.tsx",
      "src/components/preview_panel/PreviewIframe.tsx",
      "src/components/preview_panel/PreviewToolbar.tsx",
    ];
  }
  return ["src/app/layout.tsx", "src/components/app-sidebar.tsx"];
}
