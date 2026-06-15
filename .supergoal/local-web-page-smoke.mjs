import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const userDataPath = fs.mkdtempSync(
  path.join(process.cwd(), "tmp-local-web-page-smoke-"),
);
const configPath = path.join(os.tmpdir(), `dyad-page-smoke-${Date.now()}.json`);
const env = {
  ...process.env,
  DYAD_LOCAL_WEB_USER_DATA_PATH: userDataPath,
  DYAD_LOCAL_WEB_CONFIG_PATH: configPath,
  DYAD_LOCAL_WEB_PAGE_PORT: "0",
  DYAD_LOCAL_WEB_API_PORT: "0",
  DYAD_LOCAL_WEB_TOKEN: "dyad-local-web-page-smoke-token-32-bytes-min",
  NODE_ENV: "development",
};

const child = spawn("npm", ["run", "dev:web"], {
  cwd: process.cwd(),
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
try {
  const config = await waitForConfig(configPath);
  browser = await chromium.launch(getBrowserLaunchOptions());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const failedVisualRpc = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (
      !url.includes("/api/rpc/apply-visual-editing-changes") &&
      !url.includes("/api/rpc/analyze-component")
    ) {
      return;
    }
    if (response.status() >= 400) {
      failedVisualRpc.push({
        url,
        status: response.status(),
        body: await response.text().catch(() => ""),
      });
    }
  });
  await page.goto(config.webUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page
    .waitForLoadState("networkidle", { timeout: 30_000 })
    .catch(() => undefined);
  const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
  if (!bodyText.trim()) {
    throw new Error("Web UI body is empty");
  }
  if (failedVisualRpc.length > 0) {
    throw new Error(`Visual RPC failures: ${JSON.stringify(failedVisualRpc)}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        webUrl: config.webUrl,
        apiBaseUrl: config.apiBaseUrl,
        bodyTextSample: bodyText.trim().slice(0, 200),
        failedVisualRpc,
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) {
    await browser.close();
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  fs.rmSync(userDataPath, { recursive: true, force: true });
  fs.rmSync(configPath, { force: true });
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
