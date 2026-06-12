#!/usr/bin/env node

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const outputDir = path.resolve(rootDir, ".supergoal", "web-audit");
const reportPath = path.join(outputDir, "phase1-report.json");
const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");

const report = {
  schemaVersion: 1,
  phase: 1,
  startedAt: new Date().toISOString(),
  provider: {
    source: "codex",
    baseUrl: null,
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
  routes: [],
  chat: {
    attempted: false,
    outcome: "not-run",
    prompt: "Reply with a short plain sentence for Dyad Web audit.",
    currentUrl: null,
    visibleTextSample: null,
    errorText: null,
    assistantText: null,
    streamingVisible: null,
  },
  preview: {
    attempted: false,
    outcome: "not-run",
    iframeUrl: null,
    iframeText: null,
    errorText: null,
    proxyOutput: [],
    appOutput: [],
  },
  failures: {
    console: [],
    pageErrors: [],
    requestFailures: [],
    rpcFailures: [],
    backend: [],
    product: [],
    externalProvider: [],
  },
  screenshots: [],
  backendMentionsApiOpenAI: false,
  backendMentionsSub2Global: false,
  endedAt: null,
};

await fs.mkdir(outputDir, { recursive: true });

let server;
let browser;

try {
  const provider = await readCodexProvider();
  report.provider = {
    ...report.provider,
    baseUrl: provider.baseUrl,
    baseUrlHost: provider.baseUrl ? new URL(provider.baseUrl).host : null,
    key: provider.apiKey ? "present" : "missing",
    model: provider.model,
  };

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

  await navigate(page, "/", "home", async () => {
    await page.getByTestId("home-chat-input-container").waitFor();
  });

  const app = await createAuditApp(page);
  await navigate(page, "/apps", "apps", async () => {
    await page.getByTestId("apps-grid").waitFor();
  });
  await navigate(
    page,
    `/app-details?appId=${app.app.id}`,
    "app-details",
    async () => {
      await page.getByTestId("app-details-page").waitFor();
    },
  );
  await navigate(
    page,
    `/chat?id=${app.chatId}&appId=${app.app.id}`,
    "chat-initial",
    async () => {
      await page.getByTestId("messages-list").waitFor();
      await page.getByTestId("chat-input-container").waitFor();
    },
  );

  await attemptVisibleChat(page);
  await attemptVisiblePreview(page, app.app.id);

  await navigate(page, "/settings", "settings", async () => {
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
  });
  await navigate(page, "/library", "library", async () => {
    await page.getByRole("heading", { name: "Library" }).waitFor();
  });

  summarizeBackend(server.output);
} catch (error) {
  report.failures.product.push(
    `audit threw: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  report.endedAt = new Date().toISOString();
  if (server) {
    summarizeBackend(server.output);
    report.failures.backend = redactLines(server.output.slice(-100));
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => undefined);
  if (server) {
    await stopLocalWeb(server);
  }
  console.log(`PHASE1_REPORT ${reportPath}`);
  console.log(`PHASE1_PAGE_URL ${report.localWeb.pageUrl ?? "unknown"}`);
  console.log(`PHASE1_API_URL ${report.localWeb.apiUrl ?? "unknown"}`);
  console.log(
    `PHASE1_PROVIDER_HOST ${report.provider.baseUrlHost ?? "missing"}`,
  );
  console.log(`PHASE1_CHAT_OUTCOME ${report.chat.outcome}`);
  console.log(`PHASE1_PREVIEW_OUTCOME ${report.preview.outcome}`);
  console.log(
    `PHASE1_FINDINGS ${[
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
    path.join(os.tmpdir(), "dyad-phase1-local-web-"),
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
  page.on("pageerror", (error) => {
    report.failures.pageErrors.push(redact(error.message));
  });
  page.on("requestfailed", (request) => {
    report.failures.requestFailures.push(
      redact(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
      ),
    );
  });
  page.on("response", async (response) => {
    const url = response.url();
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

async function navigate(page, route, name, assertReady) {
  const url = `${report.localWeb.pageUrl}${route}`;
  const record = { name, route, ok: false, error: null };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await assertReady();
    record.ok = true;
    await saveScreenshot(page, `phase1-${name}.png`);
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    report.failures.product.push(`${name} navigation failed: ${record.error}`);
    await saveScreenshot(page, `phase1-${name}-failed.png`).catch(
      () => undefined,
    );
  }
  report.routes.push(record);
}

async function createAuditApp(page) {
  const result = await rpc(page, "create-app", {
    name: `Real Provider Audit ${Date.now()}`,
    initialChatMode: "build",
  });
  await rpc(page, "set-user-settings", {
    selectedModel: {
      provider: "openai",
      name: report.provider.model ?? "gpt-5.5",
    },
    selectedChatMode: "build",
  }).catch(() => undefined);
  return result;
}

async function attemptVisibleChat(page) {
  report.chat.attempted = true;
  try {
    const editor = page.locator('[contenteditable="true"]').last();
    await editor.click();
    await editor.pressSequentially(report.chat.prompt);
    await page.getByRole("button", { name: /send message/i }).click();
    report.chat.currentUrl = page.url();

    const end = Date.now() + 75_000;
    while (Date.now() < end) {
      const errorText = await page
        .getByTestId("chat-error-box")
        .textContent({ timeout: 500 })
        .catch(() => null);
      if (errorText) {
        report.chat.outcome = "provider-error-rendered";
        report.chat.errorText = redact(errorText);
        report.failures.externalProvider.push(redact(errorText));
        await saveScreenshot(page, "phase1-chat-error.png");
        return;
      }

      const visibleText = await page
        .getByTestId("messages-list")
        .textContent()
        .catch(() => "");
      report.chat.visibleTextSample = redact(
        (visibleText ?? "").slice(0, 1200),
      );
      if (
        visibleText &&
        /assistant|dyad|audit|reply|short|sentence/i.test(visibleText) &&
        !visibleText.includes(report.chat.prompt)
      ) {
        report.chat.outcome = "assistant-response-rendered";
        report.chat.assistantText = redact(visibleText.slice(0, 1200));
        await saveScreenshot(page, "phase1-chat-response.png");
        return;
      }
      await delay(1_000);
    }
    report.chat.outcome = "stream-stuck-or-timeout";
    report.chat.streamingVisible = true;
    report.failures.product.push(
      "Visible chat submission did not render assistant text or provider error within 75s.",
    );
    await saveScreenshot(page, "phase1-chat-timeout.png");
  } catch (error) {
    report.chat.outcome = "request-failed";
    report.chat.errorText =
      error instanceof Error ? error.message : String(error);
    report.failures.product.push(
      `visible chat failed: ${report.chat.errorText}`,
    );
    await saveScreenshot(page, "phase1-chat-failed.png").catch(() => undefined);
  }
}

async function attemptVisiblePreview(page, appId) {
  report.preview.attempted = true;
  try {
    await page
      .getByTestId("preview-mode-button")
      .click()
      .catch(() => undefined);
    await page.getByTestId("preview-restart-button").click();
    await page
      .getByTestId("preview-iframe-element")
      .waitFor({ timeout: 90_000 });
    const iframe = page.getByTestId("preview-iframe-element");
    report.preview.iframeUrl = await iframe.getAttribute("src");
    const frame = await iframe.contentFrame();
    report.preview.iframeText = redact(
      (await frame
        ?.locator("body")
        .textContent({ timeout: 15_000 })
        .catch(() => null)) ?? "",
    ).slice(0, 1200);
    report.preview.errorText = await page
      .getByTestId("preview-error-banner")
      .textContent({ timeout: 500 })
      .catch(() => null);
    report.preview.errorText = redact(report.preview.errorText ?? "");
    report.preview.outcome = report.preview.iframeText
      ? "iframe-content-rendered"
      : report.preview.errorText
        ? "preview-error-rendered"
        : "blank-iframe";
    if (report.preview.outcome === "blank-iframe") {
      report.failures.product.push(
        "Preview iframe became visible but body text was blank.",
      );
    }
    await saveScreenshot(page, "phase1-preview.png");
    report.preview.appOutput = redactLines(
      server.output.filter((line) => line.includes(String(appId))).slice(-40),
    );
    report.preview.proxyOutput = redactLines(
      server.output
        .filter((line) => line.includes("[dyad-proxy-server]started=["))
        .slice(-20),
    );
  } catch (error) {
    report.preview.outcome = "request-failed";
    report.preview.errorText =
      error instanceof Error ? error.message : String(error);
    report.failures.product.push(
      `visible preview failed: ${report.preview.errorText}`,
    );
    await saveScreenshot(page, "phase1-preview-failed.png").catch(
      () => undefined,
    );
  }
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
  report.backendMentionsSub2Global = text.includes("sub2global.bzy.ai");
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
