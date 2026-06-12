#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const outputDir = path.resolve(rootDir, ".supergoal", "web-audit");
const reportPath = path.join(outputDir, "phase2-report.json");
const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");

const report = {
  schemaVersion: 1,
  phase: 2,
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
  chat: {
    attempted: false,
    outcome: "not-run",
    prompt: "Reply with exactly: DYAD_WEB_REAL_CHAT_OK",
    expectedAssistantText: "DYAD_WEB_REAL_CHAT_OK",
    assistantText: null,
    assistantDbText: null,
    errorText: null,
    streamingCleared: null,
  },
  serviceStillAlive: false,
  providerDiagnostics: [],
  failures: {
    console: [],
    requestFailures: [],
    rpcFailures: [],
    eventRequests: [],
    browserFetches: [],
    backend: [],
    product: [],
    externalProvider: [],
  },
  screenshots: [],
  backendMentionsApiOpenAI: false,
  backendMentionsConfiguredHost: false,
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
  if (!provider.baseUrl || !provider.apiKey) {
    report.failures.externalProvider.push(
      "Missing Codex OpenAI-compatible base URL or API key.",
    );
  }

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
  report.localWeb.browserConfig = await page.evaluate(() => {
    const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
    return config
      ? {
          mode: config.mode ?? null,
          hasBaseUrl: Boolean(config.baseUrl),
          hasToken: Boolean(config.token),
          hasEventUrl: Boolean(config.eventUrl),
        }
      : null;
  });
  await page.getByTestId("home-chat-input-container").waitFor();
  await saveScreenshot(page, "phase2-home.png");

  const app = await createAuditApp(page);
  await page.goto(
    `${server.pageUrl}/chat?id=${app.chatId}&appId=${app.app.id}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await page.getByTestId("messages-list").waitFor();
  await page.getByTestId("chat-input-container").waitFor();
  await saveScreenshot(page, "phase2-chat-before.png");

  await attemptVisibleChat(page, app.chatId);

  const health = await fetch(`${server.apiUrl}/api/health`).then((response) =>
    response.ok ? response.json() : null,
  );
  report.serviceStillAlive = health?.ok === true;
  await page.goto(`${server.pageUrl}/settings`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await saveScreenshot(page, "phase2-settings-after-chat.png");
} catch (error) {
  report.failures.product.push(
    `audit threw: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  if (server) {
    summarizeBackend(server.output);
    report.failures.backend = redactLines(server.output.slice(-120));
    report.providerDiagnostics = redactLines(
      server.output
        .filter((line) => line.includes("Using language model provider"))
        .slice(-10),
    );
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => undefined);
  if (server) {
    await stopLocalWeb(server);
  }
  console.log(`PHASE2_REPORT ${reportPath}`);
  console.log(`PHASE2_PAGE_URL ${report.localWeb.pageUrl ?? "unknown"}`);
  console.log(`PHASE2_API_URL ${report.localWeb.apiUrl ?? "unknown"}`);
  console.log(
    `PHASE2_PROVIDER_HOST ${report.provider.baseUrlHost ?? "missing"}`,
  );
  console.log(`PHASE2_CHAT_OUTCOME ${report.chat.outcome}`);
  console.log(`PHASE2_SERVICE_ALIVE ${report.serviceStillAlive}`);
  console.log(
    `PHASE2_FINDINGS ${[
      ...report.failures.product,
      ...report.failures.externalProvider,
      ...report.failures.rpcFailures,
    ]
      .slice(0, 10)
      .join(" | ")}`,
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
    path.join(os.tmpdir(), "dyad-phase2-local-web-"),
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

async function createAuditApp(page) {
  const result = await rpc(page, "create-app", {
    name: `Real Provider Chat ${Date.now()}`,
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

async function attemptVisibleChat(page, chatId) {
  report.chat.attempted = true;
  const editor = page.locator('[contenteditable="true"]').last();
  await editor.click();
  await editor.fill(report.chat.prompt);
  await page.getByRole("button", { name: /send message/i }).click();

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const errorText = await page
      .getByTestId("chat-error-box")
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (errorText) {
      report.chat.outcome = "provider-error-rendered";
      report.chat.errorText = redact(errorText);
      report.failures.externalProvider.push(redact(errorText));
      break;
    }

    const visibleText = await page
      .getByTestId("messages-list")
      .textContent()
      .catch(() => "");
    const latestChat = await rpc(page, "get-chat", chatId).catch(() => null);
    const assistantText = latestChat?.messages
      ?.filter((message) => message.role === "assistant")
      .at(-1)?.content;
    if (assistantText) {
      report.chat.assistantDbText = redact(assistantText.slice(0, 1200));
    }
    const streamingCleared = !(await page
      .getByRole("button", { name: /cancel generation/i })
      .isVisible()
      .catch(() => false));
    if (
      assistantText?.includes(report.chat.expectedAssistantText) &&
      visibleText?.includes(report.chat.expectedAssistantText) &&
      streamingCleared
    ) {
      report.chat.outcome = "assistant-response-rendered";
      report.chat.assistantText = redact(visibleText.slice(0, 1200));
      report.chat.streamingCleared = true;
      break;
    }
    await delay(1_000);
  }

  if (report.chat.streamingCleared !== true) {
    report.chat.streamingCleared = !(await page
      .getByRole("button", { name: /cancel generation/i })
      .isVisible()
      .catch(() => false));
  }

  if (report.chat.outcome === "not-run") {
    report.chat.outcome = "stream-stuck-or-timeout";
    report.failures.product.push(
      "Visible chat submission did not render assistant text or provider error within 120s.",
    );
  }
  report.failures.browserFetches = await page.evaluate(() =>
    (globalThis.__DYAD_AUDIT_FETCHES__ ?? [])
      .filter((entry) =>
        /\/api\/events|\/api\/rpc\/chat%3Astream|\/api\/rpc\/chat:stream/.test(
          entry.url,
        ),
      )
      .map((entry) => `${entry.method} ${entry.url}`),
  );
  await saveScreenshot(page, `phase2-chat-${report.chat.outcome}.png`);
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

async function saveScreenshot(page, name) {
  const screenshotPath = path.join(outputDir, name);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  report.screenshots.push(screenshotPath);
}

function summarizeBackend(output) {
  const text = output.join("");
  report.backendMentionsApiOpenAI = text.includes("api.openai.com");
  report.backendMentionsConfiguredHost = report.provider.baseUrlHost
    ? text.includes(report.provider.baseUrlHost)
    : false;
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
