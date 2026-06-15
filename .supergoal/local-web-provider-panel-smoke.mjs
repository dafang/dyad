import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const root = process.cwd();
const userDataPath = fs.mkdtempSync(
  path.join(root, "tmp-local-web-provider-panel-smoke-"),
);
const configPath = path.join(
  os.tmpdir(),
  `dyad-provider-panel-smoke-${Date.now()}.json`,
);
const token = "dyad-local-web-provider-panel-smoke-token-32-bytes-min";
const env = {
  ...process.env,
  DYAD_LOCAL_WEB_USER_DATA_PATH: userDataPath,
  DYAD_LOCAL_WEB_CONFIG_PATH: configPath,
  DYAD_LOCAL_WEB_PAGE_PORT: "0",
  DYAD_LOCAL_WEB_API_PORT: "0",
  DYAD_LOCAL_WEB_TOKEN: token,
  NODE_ENV: "development",
};

const child = spawn("npm", ["run", "dev:web"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

let browser;
const report = {
  ok: false,
  panels: {},
  rpcCalls: [],
  failedRpc: [],
};

try {
  const config = await waitForConfig(configPath);
  browser = await chromium.launch(getBrowserLaunchOptions());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/rpc/")) return;
    const channel = decodeURIComponent(url.split("/api/rpc/")[1] ?? "");
    const body = await response.text().catch(() => "");
    const rpcCall = {
      status: response.status(),
      channel,
      ok: parseRpcOk(body),
      kind: parseRpcKind(body),
    };
    report.rpcCalls.push(rpcCall);
    if (response.status() < 400) return;
    report.failedRpc.push({
      status: response.status(),
      channel,
      ok: rpcCall.ok,
      kind: rpcCall.kind,
      error: parseRpcError(body),
    });
  });

  const created = await rpc(config, "create-app", {
    name: `Provider Panel Smoke ${Date.now()}`,
    initialChatMode: "build",
  });

  await page.goto(`${config.webUrl}/app-details?appId=${created.app.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .waitForLoadState("networkidle", { timeout: 30_000 })
    .catch(() => undefined);
  await expectVisible(page, '[data-testid="app-details-page"]');

  await clickGitHubConnect(page);
  await waitForRpc("github:start-flow");
  report.panels.github = {
    visible: await hasText(page, "Connect to GitHub"),
    requestedDeviceFlow: await hasText(page, "Requesting device code"),
    rpcChannels: matchingRpc("github:start-flow"),
  };

  const supabaseButtonVisible = await isVisible(
    page,
    '[data-testid="connect-supabase-button"]',
  );
  await fillSupabaseAndSave(page);
  report.panels.supabase = {
    visible: supabaseButtonVisible,
    rpcChannels: matchingRpc("supabase:save-organization-token"),
  };

  await page.goto(
    `${config.webUrl}/app-details?appId=${created.app.id}&provider=neon`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .waitForLoadState("networkidle", { timeout: 30_000 })
    .catch(() => undefined);
  const neonButtonVisible = await isVisible(
    page,
    '[data-testid="connect-neon-button"]',
  );
  await fillNeonAndSave(page);
  report.panels.neon = {
    visible: neonButtonVisible,
    rpcChannels: matchingRpc("neon:save-api-key"),
  };

  report.ok =
    report.panels.github.visible &&
    report.panels.github.requestedDeviceFlow &&
    report.panels.supabase.visible &&
    report.panels.supabase.rpcChannels.length > 0 &&
    report.panels.neon.visible &&
    report.panels.neon.rpcChannels.length > 0;

  const reportPath = path.join(
    root,
    ".supergoal",
    "local-web-provider-panel-smoke-report.json",
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, report }, null, 2));
  if (!report.ok) {
    throw new Error(`Provider panel smoke failed: ${JSON.stringify(report)}`);
  }
} finally {
  if (browser) {
    await browser.close();
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  fs.rmSync(userDataPath, { recursive: true, force: true });
  fs.rmSync(configPath, { force: true });
}

async function rpc(config, channel, body) {
  const response = await fetch(
    `${config.apiBaseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: config.webUrl,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(
      `${channel} failed: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload.data;
}

async function clickGitHubConnect(page) {
  const button = page.getByRole("button", { name: /connect to github/i });
  await button.waitFor({ state: "visible", timeout: 30_000 });
  await button.click();
  await page.getByText(/requesting device code/i).waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

async function fillSupabaseAndSave(page) {
  const dummySupabaseAccessToken = crypto.randomBytes(24).toString("base64url");
  await page.locator("#supabase-org-slug-empty").fill("local-smoke-org");
  await page
    .locator("#supabase-access-token-empty")
    .fill(dummySupabaseAccessToken);
  await page.getByTestId("connect-supabase-button").click();
  await waitForRpc("supabase:save-organization-token");
}

async function fillNeonAndSave(page) {
  const dummyNeonApiKey = crypto.randomBytes(24).toString("base64url");
  await page.locator("#neon-api-key").fill(dummyNeonApiKey);
  await page.getByTestId("connect-neon-button").click();
  await waitForRpc("neon:save-api-key");
}

async function expectVisible(page, selector) {
  await page.locator(selector).waitFor({ state: "visible", timeout: 30_000 });
}

async function isVisible(page, selector) {
  return await page
    .locator(selector)
    .isVisible()
    .catch(() => false);
}

async function hasText(page, text) {
  return await page
    .getByText(text)
    .isVisible()
    .catch(() => false);
}

async function waitForRpc(channel) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (matchingRpc(channel).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${channel}`);
}

function matchingRpc(channel) {
  return report.rpcCalls
    .filter((entry) => entry.channel === channel)
    .map(({ status, channel, ok, kind }) => ({
      status,
      channel,
      ok,
      kind,
    }));
}

function parseRpcOk(body) {
  try {
    return JSON.parse(body).ok ?? null;
  } catch {
    return null;
  }
}

function parseRpcKind(body) {
  try {
    return JSON.parse(body).kind ?? null;
  } catch {
    return null;
  }
}

function parseRpcError(body) {
  try {
    return JSON.parse(body).error ?? null;
  } catch {
    return null;
  }
}

async function waitForConfig(filePath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
    }
    if (child.exitCode !== null) {
      throw new Error(
        `Local Web server exited early (${child.exitCode})\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for config ${filePath}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  );
}

function getBrowserLaunchOptions() {
  const systemChromePath =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(systemChromePath)) {
    return { headless: true, executablePath: systemChromePath };
  }
  return { headless: true };
}
