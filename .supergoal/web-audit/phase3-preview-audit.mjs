#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const outputDir = path.resolve(rootDir, ".supergoal", "web-audit");
const reportPath = path.join(outputDir, "phase3-report.json");
const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");

const report = {
  schemaVersion: 1,
  phase: 3,
  startedAt: new Date().toISOString(),
  provider: {
    source: "codex",
    baseUrlHost: null,
    key: "missing",
    model: null,
    note: "Secrets are never written to this report.",
  },
  localWeb: {
    pageUrl: null,
    apiUrl: null,
    userDataPath: null,
    pid: null,
  },
  preview: {
    attempted: false,
    outcome: "not-run",
    appId: null,
    chatId: null,
    iframeSrc: null,
    iframeText: null,
    loadingVisible: null,
    errorText: null,
    outputEvents: [],
    browserFetches: [],
  },
  serviceStillAlive: false,
  failures: {
    console: [],
    requestFailures: [],
    rpcFailures: [],
    eventRequests: [],
    backend: [],
    product: [],
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
  report.provider.key = provider.apiKey ? "present" : "missing";
  report.provider.model = provider.model;

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
    globalThis.__DYAD_AUDIT_FETCHES__ = [];
    globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      globalThis.__DYAD_AUDIT_FETCHES__.push({
        method: init?.method ?? "GET",
        url,
      });
      return originalFetch(input, init);
    };
  });

  await page.goto(server.pageUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("home-chat-input-container").waitFor();
  await saveScreenshot(page, "phase3-home.png");

  const app = await createAuditApp(page);
  report.preview.appId = app.app.id;
  report.preview.chatId = app.chatId;
  await page.goto(
    `${server.pageUrl}/chat?id=${app.chatId}&appId=${app.app.id}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.getByTestId("messages-list").waitFor();
  await page.getByTestId("chat-input-container").waitFor();
  await saveScreenshot(page, "phase3-chat-before-preview.png");

  await runVisiblePreview(page);

  const health = await fetch(`${server.apiUrl}/api/health`).then((response) =>
    response.ok ? response.json() : null,
  );
  report.serviceStillAlive = health?.ok === true;
} catch (error) {
  report.failures.product.push(
    `audit threw: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  if (server) {
    report.failures.backend = redactLines(server.output.slice(-160));
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => undefined);
  if (server) {
    await stopLocalWeb(server);
  }
  console.log(`PHASE3_REPORT ${reportPath}`);
  console.log(`PHASE3_PAGE_URL ${report.localWeb.pageUrl ?? "unknown"}`);
  console.log(`PHASE3_API_URL ${report.localWeb.apiUrl ?? "unknown"}`);
  console.log(`PHASE3_PREVIEW_OUTCOME ${report.preview.outcome}`);
  console.log(`PHASE3_IFRAME_SRC ${report.preview.iframeSrc ?? "none"}`);
  console.log(`PHASE3_SERVICE_ALIVE ${report.serviceStillAlive}`);
  console.log(
    `PHASE3_FINDINGS ${[
      ...report.failures.product,
      ...report.failures.rpcFailures,
    ]
      .slice(0, 10)
      .join(" | ")}`,
  );
}

async function runVisiblePreview(page) {
  report.preview.attempted = true;
  await page.getByTestId("toggle-preview-panel-button").click();

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const iframe = page.getByTestId("preview-iframe-element");
    await iframe
      .waitFor({ state: "attached", timeout: 1_000 })
      .catch(() => null);
    report.preview.iframeSrc = await iframe
      .getAttribute("src")
      .catch(() => null);
    report.preview.loadingVisible = await page
      .getByTestId("preview-loading-screen")
      .isVisible()
      .catch(() => false);
    report.preview.errorText = await page
      .getByTestId("preview-error-banner")
      .textContent({ timeout: 500 })
      .catch(() => null);

    let frame = null;
    try {
      frame = await iframe.contentFrame();
    } catch {
      frame = null;
    }
    const text = frame
      ? await frame
          .locator("body")
          .textContent({ timeout: 1_000 })
          .catch(() => null)
      : null;
    if (text) {
      report.preview.iframeText = redact(text.slice(0, 1200));
    }
    if (
      report.preview.iframeSrc &&
      text &&
      text.trim().length > 0 &&
      report.preview.loadingVisible === false
    ) {
      report.preview.outcome = "iframe-rendered";
      break;
    }
    if (report.preview.errorText) {
      report.preview.outcome = "preview-error-rendered";
      break;
    }
    await delay(1_000);
  }

  if (report.preview.outcome === "not-run") {
    report.preview.outcome = "preview-stuck-or-timeout";
    report.failures.product.push(
      "Visible preview did not render iframe content or a preview error within 120s.",
    );
  }

  report.preview.browserFetches = await page.evaluate(() =>
    (globalThis.__DYAD_AUDIT_FETCHES__ ?? [])
      .filter((entry) =>
        /\/api\/events|\/api\/rpc\/run-app|\/api\/rpc\/check-problems/.test(
          entry.url,
        ),
      )
      .map((entry) => `${entry.method} ${entry.url}`),
  );
  report.preview.outputEvents = report.failures.backend
    .filter(
      (line) =>
        line.includes("app_runtime_service") ||
        line.includes("start_proxy_server"),
    )
    .slice(-80);
  await saveScreenshot(page, `phase3-preview-${report.preview.outcome}.png`);
}

async function createAuditApp(page) {
  const result = await rpc(page, "create-app", {
    name: `Preview Audit ${Date.now()}`,
    initialChatMode: "build",
  });
  await rpc(page, "set-user-settings", {
    selectedModel: {
      provider: "openai",
      name: report.provider.model ?? "gpt-5.5",
    },
    selectedChatMode: "build",
  });
  return result;
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
    path.join(os.tmpdir(), "dyad-phase3-local-web-"),
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
      report.failures.console.push(redact(`[${message.type()}] ${text}`));
    }
  });
  page.on("requestfailed", (request) => {
    report.failures.requestFailures.push(
      redact(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      ),
    );
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/events")) {
      report.failures.eventRequests.push(
        redact(`request ${request.method()} ${url}`),
      );
    }
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/events")) {
      report.failures.eventRequests.push(
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
    report.failures.rpcFailures.push(
      redact(`${response.status()} ${url} ${body.slice(0, 500)}`),
    );
  });
}

async function saveScreenshot(page, name) {
  const screenshotPath = path.join(outputDir, name);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshots.push(screenshotPath);
}

function redactLines(lines) {
  return lines.map((line) => redact(line));
}

function redact(value) {
  if (!value) return value;
  return String(value)
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
