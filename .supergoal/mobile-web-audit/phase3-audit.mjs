import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const auditDir = path.resolve(".supergoal", "mobile-web-audit");
const token = "dyad-mobile-web-audit-token-32-bytes-min";

await fs.mkdir(auditDir, { recursive: true });

const provider = await readRealProviderConfig();
const server = await startLocalWebServer(provider);
const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  provider: {
    source: provider.source,
    baseUrlHost: provider.baseUrl ? new URL(provider.baseUrl).host : null,
    model: provider.model,
    key: provider.apiKey ? "present" : "missing",
  },
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
  await configureRealProvider(setupPage, provider);
  const created = await rpc(setupPage, "create-app", {
    name: `Mobile Chat ${Date.now()}`,
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

  const beforeScreenshot = path.join(auditDir, "phase3-mobile-chat-before.png");
  await mobilePage.screenshot({ path: beforeScreenshot, fullPage: true });
  report.mobile.before = {
    screenshot: beforeScreenshot,
    metrics: await collectChatMetrics(mobilePage),
  };

  const chunks = await subscribe(mobilePage, "chat:response:chunk");
  const streamEnd = await subscribe(mobilePage, "chat:stream:end");
  await chunks.ready();
  await streamEnd.ready();
  const expectedToken = `MOBILE_CHAT_OK_${Date.now()}`;
  const editor = mobilePage.locator('[contenteditable="true"]').last();
  await editor.click();
  await editor.fill(
    `This is a UI test. Reply with exactly this token and no other words: ${expectedToken}`,
  );
  report.mobile.afterType = {
    metrics: await collectChatMetrics(mobilePage),
  };
  await mobilePage.getByRole("button", { name: /send message/i }).click();
  await mobilePage.waitForTimeout(1200);
  const duringScreenshot = path.join(auditDir, "phase3-mobile-chat-during.png");
  await mobilePage.screenshot({ path: duringScreenshot, fullPage: true });
  report.mobile.during = {
    screenshot: duringScreenshot,
    metrics: await collectChatMetrics(mobilePage),
    chunkEvents: await chunks.events(),
  };

  const finalState = await waitForChatCompletion(
    mobilePage,
    chatId,
    expectedToken,
  );
  const afterScreenshot = path.join(auditDir, "phase3-mobile-chat-after.png");
  await mobilePage.screenshot({ path: afterScreenshot, fullPage: true });
  report.mobile.after = {
    screenshot: afterScreenshot,
    metrics: await collectChatMetrics(mobilePage),
    finalState,
    chunkEvents: await chunks.events(),
    streamEndEvents: await streamEnd.events(),
  };
  await chunks.stop();
  await streamEnd.stop();
  await mobilePage.close();

  const desktopPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await desktopPage.goto(
    new URL(
      `/chat?id=${encodeURIComponent(String(chatId))}&appId=${encodeURIComponent(
        String(created.app.id),
      )}`,
      server.pageUrl,
    ).toString(),
    { waitUntil: "domcontentloaded" },
  );
  await desktopPage
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  const desktopScreenshot = path.join(
    auditDir,
    "phase3-desktop-chat-split-pane.png",
  );
  await desktopPage.screenshot({ path: desktopScreenshot, fullPage: true });
  report.desktop.splitPane = {
    screenshot: desktopScreenshot,
    metrics: await collectChatMetrics(desktopPage),
  };
  await desktopPage.close();
} finally {
  await browser.close().catch(() => undefined);
  report.localWebOutputTail = server.output.slice(-80);
  await stopLocalWebServer(server);
  await fs.writeFile(
    path.join(auditDir, "phase3-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

console.log(
  JSON.stringify(
    {
      pageUrl: server.pageUrl,
      apiUrl: server.apiUrl,
      report: path.join(auditDir, "phase3-report.json"),
      provider: report.provider,
      mobileBefore: report.mobile.before?.metrics,
      mobileDuring: {
        metrics: report.mobile.during?.metrics,
        chunkCount: report.mobile.during?.chunkEvents?.length ?? 0,
      },
      mobileAfter: {
        metrics: report.mobile.after?.metrics,
        finalState: report.mobile.after?.finalState,
        chunkCount: report.mobile.after?.chunkEvents?.length ?? 0,
        streamEndCount: report.mobile.after?.streamEndEvents?.length ?? 0,
      },
      desktop: report.desktop.splitPane?.metrics,
    },
    null,
    2,
  ),
);

async function startLocalWebServer(provider) {
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
      OPENAI_API_KEY: provider.apiKey,
      OPENAI_BASE_URL: provider.baseUrl ?? "",
      E2E_TEST_BUILD: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const started = await waitForLocalWebOutput(output, child);
  return { ...started, userDataPath, process: child, output };
}

async function readRealProviderConfig() {
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
  ]);
  const auth = JSON.parse(authText);
  const apiKey = auth.OPENAI_API_KEY;
  const model = matchTomlValue(configText, "model");
  if (!apiKey || !model) {
    throw new Error(
      "Real provider config is required. Set OPENAI_API_KEY and DYAD_WEB_E2E_MODEL, or provide Codex config/auth files.",
    );
  }
  return {
    source: "codex",
    apiKey,
    baseUrl: matchTomlValue(configText, "base_url"),
    model,
  };
}

function matchTomlValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1] ?? null;
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

async function configureRealProvider(page, provider) {
  await rpc(page, "set-user-settings", {
    enableAppBlueprint: false,
    selectedChatMode: "ask",
    selectedModel: { provider: "openai", name: provider.model },
    providerSettings: {
      openai: {
        apiKey: { value: provider.apiKey, encryptionType: "plaintext" },
      },
    },
  });
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

async function subscribe(page, channel) {
  const key = `phase3Sse${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ({ key, channel }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing from browser page");
      }
      const controller = new AbortController();
      const events = [];
      let markReady = () => {};
      const opened = new Promise((resolve) => {
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
            const data = [];
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
      globalThis[key] = { controller, events, opened, ready };
    },
    { key, channel },
  );
  return {
    ready() {
      return page.evaluate(async (key) => {
        await globalThis[key]?.opened;
      }, key);
    },
    stop() {
      return page.evaluate(async (key) => {
        const state = globalThis[key];
        state?.controller.abort();
        await state?.ready.catch(() => undefined);
        delete globalThis[key];
      }, key);
    },
    events() {
      return page.evaluate((key) => [...(globalThis[key]?.events ?? [])], key);
    },
  };
}

async function waitForChatCompletion(page, chatId, expectedToken) {
  const deadline = Date.now() + 120_000;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      async ({ chatId, expectedToken }) => {
        const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
        const response = await fetch(
          `${config.baseUrl}/api/rpc/${encodeURIComponent("get-chat")}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.token}`,
              "content-type": "application/json",
              origin: location.origin,
            },
            body: JSON.stringify(chatId),
          },
        );
        const json = await response.json();
        const assistantText = json.data?.messages
          ?.filter((message) => message.role === "assistant")
          .at(-1)?.content;
        const visibleText =
          document.querySelector('[data-testid="messages-list"]')
            ?.textContent ?? "";
        const streaming = Boolean(
          document.querySelector('[aria-label="Cancel generation"]'),
        );
        return {
          ok:
            assistantText?.includes(expectedToken) &&
            visibleText.includes(expectedToken) &&
            !streaming,
          assistantText,
          visibleHasToken: visibleText.includes(expectedToken),
          streaming,
        };
      },
      { chatId, expectedToken },
    );
    lastState = state;
    if (state.ok) {
      return state;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(
    `Timed out waiting for chat completion: ${JSON.stringify(lastState)}`,
  );
}

async function collectChatMetrics(page) {
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
      messagesList: rectFor('[data-testid="messages-list"]'),
      chatInput: rectFor('[data-testid="chat-input-container"]'),
      editor: rectFor('[contenteditable="true"]'),
      sendButton: rectFor('[aria-label="Send message"]'),
      cancelButton: rectFor('[aria-label="Cancel generation"]'),
      previewToggle: rectFor('[data-testid="toggle-preview-panel-button"]'),
      terminalToggle: rectFor('[data-testid="toggle-terminal-button"]'),
      previewPanel: rectFor("#preview-panel"),
      chatPanel: rectFor("#chat-panel"),
    };
  });
}
