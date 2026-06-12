#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const outputDir = path.resolve(rootDir, ".supergoal", "web-audit");
const reportPath = path.join(outputDir, "phase4-report.json");
const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");

const report = {
  schemaVersion: 1,
  phase: 4,
  startedAt: new Date().toISOString(),
  localWeb: {
    pageUrl: null,
    apiUrl: null,
    userDataPath: null,
    pid: null,
  },
  provider: {
    source: "codex",
    baseUrlHost: null,
    model: null,
    key: "missing",
    note: "Secrets are never written to this report.",
  },
  app: {
    appId: null,
    chatId: null,
  },
  pages: [],
  failureMatrix: {
    productBug: [],
    unsupportedByDesign: [],
    externalSetup: [],
    ignoredNoise: [],
  },
  rawFailures: {
    console: [],
    pageErrors: [],
    requestFailures: [],
    rpcFailures: [],
    eventRequests: [],
    backend: [],
  },
  screenshots: [],
  endedAt: null,
};

await fs.mkdir(outputDir, { recursive: true });

let server;
let browser;

try {
  const provider = await readCodexProvider();
  report.provider.baseUrlHost = provider.baseUrl
    ? new URL(provider.baseUrl).host
    : null;
  report.provider.model = provider.model;
  report.provider.key = provider.apiKey ? "present" : "missing";

  server = await startLocalWeb(provider);
  report.localWeb = {
    pageUrl: server.pageUrl,
    apiUrl: server.apiUrl,
    userDataPath: server.userDataPath,
    pid: server.child.pid ?? null,
  };

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  attachCapture(page);
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.__DYAD_PHASE4_FETCHES__ = [];
    globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      globalThis.__DYAD_PHASE4_FETCHES__.push({
        method: init?.method ?? "GET",
        url,
      });
      return originalFetch(input, init);
    };
  });

  await visit(page, "home", "/", async () => {
    await page.getByTestId("home-chat-input-container").waitFor();
  });

  const app = await createAuditApp(page);
  report.app.appId = app.app.id;
  report.app.chatId = app.chatId;

  await visit(page, "apps", "/apps", async () => {
    await page.getByRole("heading", { name: /apps/i }).first().waitFor();
  });

  await visit(
    page,
    "app-details",
    `/app-details?appId=${app.app.id}`,
    async () => {
      await page.getByText(app.app.name).first().waitFor();
    },
  );

  await visit(
    page,
    "chat",
    `/chat?id=${app.chatId}&appId=${app.app.id}`,
    async () => {
      await page.getByTestId("messages-list").waitFor();
      await page.getByTestId("chat-input-container").waitFor();
    },
  );

  await visit(
    page,
    "preview-panel",
    `/chat?id=${app.chatId}&appId=${app.app.id}`,
    async () => {
      await ensurePreviewOpen(page);
      await waitForPreviewFrame(page);
    },
  );

  for (const mode of ["code", "configure", "publish", "security", "problems"]) {
    await auditPreviewMode(page, mode);
  }

  await visit(page, "library", "/library", async () => {
    await page
      .getByText(/library/i)
      .first()
      .waitFor();
  });
  await visit(page, "library-prompts", "/library/prompts", async () => {
    await page.getByRole("heading", { name: /library: prompts/i }).waitFor();
  });
  await visit(page, "library-themes", "/library/themes", async () => {
    await page.getByRole("heading", { name: /themes/i }).waitFor();
  });
  await visit(page, "library-media", "/library/media", async () => {
    await page.getByRole("heading", { name: /media/i }).waitFor();
  });
  await visit(page, "settings", "/settings", async () => {
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
  });
  await visit(
    page,
    "provider-settings-openai",
    "/providers/openai",
    async () => {
      await page
        .getByText(/openai/i)
        .first()
        .waitFor();
    },
  );
  await visit(page, "hub", "/hub", async () => {
    await page.locator("body").waitFor();
  });

  classifyFailures();
} catch (error) {
  addFailure("productBug", {
    id: "phase4-audit-threw",
    message: error instanceof Error ? error.message : String(error),
    owner: ".supergoal/web-audit/phase4-core-pages-audit.mjs",
  });
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  if (server) {
    report.rawFailures.backend = redactLines(server.output.slice(-220));
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => undefined);
  if (server) {
    await stopLocalWeb(server);
  }
  console.log(`PHASE4_REPORT ${reportPath}`);
  console.log(`PHASE4_PAGE_URL ${report.localWeb.pageUrl ?? "unknown"}`);
  console.log(`PHASE4_PRODUCT_BUGS ${report.failureMatrix.productBug.length}`);
  console.log(
    `PHASE4_UNSUPPORTED ${report.failureMatrix.unsupportedByDesign.length}`,
  );
  console.log(
    `PHASE4_EXTERNAL_SETUP ${report.failureMatrix.externalSetup.length}`,
  );
  console.log(
    `PHASE4_IGNORED_NOISE ${report.failureMatrix.ignoredNoise.length}`,
  );
}

async function visit(page, id, route, assertReady) {
  const startedAt = Date.now();
  const before = snapshotFailureCounts();
  const url = new URL(route, report.localWeb.pageUrl).toString();
  const pageRecord = {
    id,
    route,
    url,
    status: "started",
    title: null,
    bodyText: null,
    screenshot: null,
    durationMs: null,
    newFailures: null,
  };
  report.pages.push(pageRecord);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await assertReady();
    await page.waitForTimeout(500);
    pageRecord.title = await page.title();
    pageRecord.bodyText = redact(
      (
        (await page
          .locator("body")
          .textContent()
          .catch(() => "")) ?? ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
    );
    pageRecord.screenshot = await saveScreenshot(page, `phase4-${id}.png`);
    pageRecord.status = "ok";
  } catch (error) {
    pageRecord.status = "failed";
    pageRecord.bodyText = redact(
      (
        (await page
          .locator("body")
          .textContent()
          .catch(() => "")) ?? ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
    );
    pageRecord.screenshot = await saveScreenshot(
      page,
      `phase4-${id}-failed.png`,
    );
    addFailure("productBug", {
      id: `page-${id}-failed`,
      message: error instanceof Error ? error.message : String(error),
      owner: routeOwner(route),
      route,
    });
  } finally {
    pageRecord.durationMs = Date.now() - startedAt;
    pageRecord.newFailures = diffFailureCounts(before);
  }
}

async function auditPreviewMode(page, mode) {
  await visit(
    page,
    `preview-${mode}`,
    `/chat?id=${report.app.chatId}&appId=${report.app.appId}`,
    async () => {
      await ensurePreviewOpen(page);
      await clickPreviewMode(page, mode);
      await page.waitForTimeout(800);
      await page.locator("body").waitFor();
    },
  );
}

async function clickPreviewMode(page, mode) {
  const modeButton = page.getByTestId(`${mode}-mode-button`).first();
  const isOverflowMode = ["configure", "problems", "security"].includes(mode);
  const directVisible = await modeButton.isVisible().catch(() => false);
  if (isOverflowMode && !directVisible) {
    await page.getByTestId("preview-mode-overflow-button").click();
  }
  await modeButton.waitFor({ state: "visible" });
  await modeButton.click();
}

async function ensurePreviewOpen(page) {
  const previewButton = page.getByTestId("preview-mode-button");
  if (await previewButton.isVisible().catch(() => false)) {
    return;
  }
  await page.getByTestId("toggle-preview-panel-button").click();
  await previewButton.waitFor({ state: "visible" });
}

async function waitForPreviewFrame(page) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const iframe = page.getByTestId("preview-iframe-element");
    await iframe
      .waitFor({ state: "attached", timeout: 1_000 })
      .catch(() => null);
    const src = await iframe.getAttribute("src").catch(() => null);
    const loadingVisible = await page
      .getByTestId("preview-loading-screen")
      .isVisible()
      .catch(() => false);
    let text = null;
    try {
      const frame = await iframe.contentFrame();
      text = frame
        ? await frame
            .locator("body")
            .textContent({ timeout: 1_000 })
            .catch(() => null)
        : null;
    } catch {
      text = null;
    }
    if (src && text && text.trim().length > 0 && !loadingVisible) {
      return;
    }
    await delay(1_000);
  }
  throw new Error("Preview iframe did not render visible app content");
}

function snapshotFailureCounts() {
  return {
    console: report.rawFailures.console.length,
    pageErrors: report.rawFailures.pageErrors.length,
    requestFailures: report.rawFailures.requestFailures.length,
    rpcFailures: report.rawFailures.rpcFailures.length,
  };
}

function diffFailureCounts(before) {
  return {
    console: report.rawFailures.console.length - before.console,
    pageErrors: report.rawFailures.pageErrors.length - before.pageErrors,
    requestFailures:
      report.rawFailures.requestFailures.length - before.requestFailures,
    rpcFailures: report.rawFailures.rpcFailures.length - before.rpcFailures,
  };
}

function classifyFailures() {
  for (const failure of report.rawFailures.rpcFailures) {
    if (
      /select-app-folder|select-app-location|open-file-path|show-item-in-folder/.test(
        failure,
      )
    ) {
      addFailure("unsupportedByDesign", {
        id: "native-host-action",
        message: failure,
        owner: "src/lib/web_host_capabilities.ts",
      });
    } else {
      addFailure("productBug", {
        id: "unexpected-rpc-failure",
        message: failure,
        owner: "src/server/local_web_rpc_registry.ts",
      });
    }
  }
  for (const failure of report.rawFailures.console) {
    if (/PostHog\.js|cdn\.jsdelivr|youtube\.com|monaco-editor/.test(failure)) {
      addFailure("ignoredNoise", {
        id: "external-network-noise",
        message: failure,
        owner: "external",
      });
    } else if (/Error running app .*Failed to fetch/i.test(failure)) {
      addFailure("productBug", {
        id: "preview-run-fetch-failed",
        message: failure,
        owner: "src/hooks/useRunApp.ts",
      });
    } else if (/net::ERR_CONNECTION_CLOSED/i.test(failure)) {
      addFailure("ignoredNoise", {
        id: "local-server-teardown-noise",
        message: failure,
        owner: "test-harness",
      });
    } else if (
      /No local RPC handler|unsupported|Failed to load resource/i.test(failure)
    ) {
      addFailure("productBug", {
        id: "console-error",
        message: failure,
        owner: "browser-console",
      });
    }
  }
  for (const failure of report.rawFailures.pageErrors) {
    addFailure("productBug", {
      id: "page-error",
      message: failure,
      owner: "renderer",
    });
  }
}

function addFailure(category, failure) {
  report.failureMatrix[category].push(redactObject(failure));
}

function routeOwner(route) {
  if (route.startsWith("/chat")) return "src/pages/chat.tsx";
  if (route.startsWith("/app-details")) return "src/pages/app-details.tsx";
  if (route.startsWith("/apps")) return "src/pages/apps.tsx";
  if (route.startsWith("/settings") || route.startsWith("/providers")) {
    return "src/pages/settings.tsx";
  }
  if (route.startsWith("/library")) return "src/pages/library-home.tsx";
  if (route.startsWith("/hub")) return "src/pages/hub.tsx";
  return "src/router.ts";
}

async function createAuditApp(page) {
  return rpc(page, "create-app", {
    name: `Core Pages Audit ${Date.now()}`,
    initialChatMode: "build",
  });
}

async function rpc(page, channel, body) {
  return page.evaluate(
    async ({ channel, body }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing");
      }
      const response = await fetch(
        `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(`${channel} failed: ${json.error ?? response.status}`);
      }
      return json.data;
    },
    { channel, body },
  );
}

async function readCodexProvider() {
  const configText = await fs.readFile(codexConfigPath, "utf8");
  const auth = JSON.parse(await fs.readFile(codexAuthPath, "utf8"));
  const baseUrl = matchTomlValue(configText, "base_url");
  const model = matchTomlValue(configText, "model");
  return {
    baseUrl,
    model,
    apiKey: auth.OPENAI_API_KEY,
  };
}

function matchTomlValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? null;
}

async function startLocalWeb(provider) {
  const userDataPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "dyad-phase4-local-web-"),
  );
  const output = [];
  const child = spawn("npm", ["run", "dev:web"], {
    cwd: rootDir,
    env: {
      ...process.env,
      DYAD_LOCAL_WEB_PAGE_PORT: "0",
      DYAD_LOCAL_WEB_API_PORT: "0",
      DYAD_LOCAL_WEB_USER_DATA_PATH: userDataPath,
      OPENAI_API_KEY: provider.apiKey ?? "",
      OPENAI_BASE_URL: provider.baseUrl ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const started = await waitForStartup(output, child);
  return { ...started, userDataPath, child, output };
}

async function waitForStartup(output, child) {
  const deadline = Date.now() + 60_000;
  let exit;
  child.once("exit", (code, signal) => {
    exit = `Local Web exited before startup: code=${code} signal=${signal}`;
  });
  while (Date.now() < deadline) {
    if (exit) throw new Error(`${exit}\n${redact(output.join(""))}`);
    const text = output.join("");
    const pageUrl = text.match(/Web UI:\s+(http:\/\/[^\s]+)/)?.[1];
    const apiUrl = text.match(/API:\s+(http:\/\/[^\s]+)/)?.[1];
    if (pageUrl && apiUrl) {
      return { pageUrl, apiUrl };
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for Local Web startup\n${redact(output.join(""))}`,
  );
}

async function stopLocalWeb(localServer) {
  const child = localServer.child;
  if (child.exitCode !== null || child.signalCode) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([closed, delay(5_000)]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
  }
}

function attachCapture(page) {
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" ||
      /unsupported|No local RPC handler/i.test(text)
    ) {
      report.rawFailures.console.push(redact(`[${message.type()}] ${text}`));
    }
  });
  page.on("pageerror", (error) => {
    report.rawFailures.pageErrors.push(redact(formatPageError(error)));
  });
  page.on("requestfailed", (request) => {
    report.rawFailures.requestFailures.push(
      redact(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      ),
    );
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/events")) {
      report.rawFailures.eventRequests.push(
        redact(`request ${request.method()} ${url}`),
      );
    }
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/events")) {
      report.rawFailures.eventRequests.push(
        redact(`response ${response.status()} ${url}`),
      );
    }
    if (!url.includes("/api/rpc/") || response.status() < 400) return;
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "<unavailable>";
    }
    report.rawFailures.rpcFailures.push(
      redact(`${response.status()} ${url} ${body.slice(0, 500)}`),
    );
  });
}

async function saveScreenshot(page, name) {
  const screenshotPath = path.join(outputDir, name);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshots.push(screenshotPath);
  return screenshotPath;
}

function redactLines(lines) {
  return lines.map((line) => redact(line));
}

function redactObject(input) {
  return JSON.parse(JSON.stringify(input, (_key, value) => redact(value)));
}

function formatPageError(error) {
  if (error?.stack) {
    return error.stack;
  }
  if (error?.message) {
    return `${error.name ?? "Error"}: ${error.message}`;
  }
  return String(error);
}

function redact(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-<redacted>")
    .replace(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
      "<jwt-redacted>",
    )
    .replace(
      /OPENAI_API_KEY['":=\s]+[A-Za-z0-9._-]+/gi,
      "OPENAI_API_KEY=<redacted>",
    );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
