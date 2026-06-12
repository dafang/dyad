import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = path.resolve(".supergoal", "mobile-web-audit");
const token = "dyad-mobile-web-audit-token-32-bytes-min";
const routes = [
  { key: "home", path: "/" },
  { key: "apps", path: "/apps" },
  { key: "chat", path: null },
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
  },
  created: null,
  routes: [],
  mobileNavigation: [],
  desktopSidebar: [],
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
    name: `Mobile Shell ${Date.now()}`,
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
  for (const route of routes) {
    const routeUrl =
      route.path ??
      `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
        String(created.app.id),
      )}`;
    await mobilePage.goto(new URL(routeUrl, server.pageUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await mobilePage
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => undefined);
    const screenshot = path.join(auditDir, `phase2-mobile-${route.key}.png`);
    await mobilePage.screenshot({ path: screenshot, fullPage: true });
    report.routes.push({
      viewport: "mobile",
      route: route.key,
      url: mobilePage.url(),
      screenshot,
      metrics: await collectMetrics(mobilePage),
      shellRects: await collectShellRects(mobilePage),
    });
  }

  await mobilePage.goto(
    new URL(
      `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
        String(created.app.id),
      )}`,
      server.pageUrl,
    ).toString(),
    { waitUntil: "domcontentloaded" },
  );
  await mobilePage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await mobilePage.goto(new URL("/apps", server.pageUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  await mobilePage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);

  for (const action of [
    {
      label: "Toggle Menu",
      action: "Apps drawer",
      expected: "app-list-container",
    },
    { label: "Settings", action: "Settings", expectedText: "Settings" },
    { label: "Library", action: "Library", expectedText: "Library" },
    { label: "Hub", action: "Hub", expectedText: "Pick your default template" },
  ]) {
    await mobilePage.getByLabel(action.label).click();
    await mobilePage.waitForTimeout(250);
    const screenshot = path.join(
      auditDir,
      `phase2-mobile-nav-${action.action.toLowerCase().replaceAll(" ", "-")}.png`,
    );
    await mobilePage.screenshot({ path: screenshot, fullPage: true });
    report.mobileNavigation.push({
      action: action.action,
      screenshot,
      evidence: await collectNavigationEvidence(mobilePage, action),
    });
  }

  await mobilePage.goto(
    new URL(
      `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
        String(created.app.id),
      )}`,
      server.pageUrl,
    ).toString(),
    { waitUntil: "domcontentloaded" },
  );
  await mobilePage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await mobilePage.getByLabel("Toggle Menu").click();
  await mobilePage.waitForTimeout(250);
  const chatListScreenshot = path.join(
    auditDir,
    "phase2-mobile-nav-chat-list.png",
  );
  await mobilePage.screenshot({ path: chatListScreenshot, fullPage: true });
  report.mobileNavigation.push({
    action: "selected app chat list",
    screenshot: chatListScreenshot,
    evidence: await collectNavigationEvidence(mobilePage, {
      expected: "chat-list-container",
    }),
  });

  await mobilePage.getByLabel("Help").click();
  await mobilePage.waitForTimeout(250);
  const helpScreenshot = path.join(auditDir, "phase2-mobile-nav-help.png");
  await mobilePage.screenshot({ path: helpScreenshot, fullPage: true });
  report.mobileNavigation.push({
    action: "Help",
    screenshot: helpScreenshot,
    evidence: {
      helpVisible: await mobilePage
        .getByRole("dialog")
        .isVisible()
        .catch(() => false),
      metrics: await collectMetrics(mobilePage),
    },
  });
  await mobilePage.close();

  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await desktopPage.goto(new URL("/", server.pageUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  await desktopPage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await captureDesktopSidebar(desktopPage, report, "collapsed");
  await desktopPage.getByLabel("Toggle Menu").click();
  await desktopPage.waitForTimeout(250);
  await captureDesktopSidebar(desktopPage, report, "expanded");
  await desktopPage.getByLabel("Settings").hover();
  await desktopPage.waitForTimeout(250);
  await captureDesktopSidebar(desktopPage, report, "hover-settings");
  await desktopPage.close();
} finally {
  await browser.close().catch(() => undefined);
  report.localWebOutputTail = server.output.slice(-80);
  await stopLocalWebServer(server);
  await fs.writeFile(
    path.join(auditDir, "phase2-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      pageUrl: server.pageUrl,
      apiUrl: server.apiUrl,
      report: path.join(auditDir, "phase2-report.json"),
      mobileOverflow: report.routes.map((route) => ({
        route: route.route,
        horizontalOverflow: route.metrics.horizontalOverflow,
        scrollWidth: route.metrics.documentScrollWidth,
        innerWidth: route.metrics.innerWidth,
      })),
      navigation: report.mobileNavigation.map((entry) => ({
        action: entry.action,
        evidence: entry.evidence,
      })),
      desktopSidebar: report.desktopSidebar,
    },
    null,
    2,
  ),
);

async function captureDesktopSidebar(page, report, state) {
  const screenshot = path.join(auditDir, `phase2-desktop-sidebar-${state}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  report.desktopSidebar.push({
    state,
    screenshot,
    metrics: await collectMetrics(page),
    shellRects: await collectShellRects(page),
  });
}

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

async function collectMetrics(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const visibleText = body.innerText.trim().slice(0, 500);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentScrollWidth: root.scrollWidth,
      documentScrollHeight: root.scrollHeight,
      bodyScrollWidth: body.scrollWidth,
      horizontalOverflow: root.scrollWidth > window.innerWidth + 1,
      blank: visibleText.length === 0,
      visibleText,
    };
  });
}

async function collectShellRects(page) {
  return page.evaluate(() => {
    const collect = (selector) => {
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
    return {
      sidebar: collect('[data-slot="sidebar"]'),
      sidebarGap: collect('[data-slot="sidebar-gap"]'),
      sidebarContainer: collect('[data-slot="sidebar-container"]'),
      main: collect("#layout-main-content-container"),
    };
  });
}

async function collectNavigationEvidence(page, action) {
  const testIdVisible = action.expected
    ? await page
        .getByTestId(action.expected)
        .isVisible()
        .catch(() => false)
    : null;
  const textVisible = action.expectedText
    ? await page
        .getByText(action.expectedText, { exact: true })
        .first()
        .isVisible()
        .catch(() => false)
    : null;
  return {
    testIdVisible,
    textVisible,
    metrics: await collectMetrics(page),
    shellRects: await collectShellRects(page),
  };
}
