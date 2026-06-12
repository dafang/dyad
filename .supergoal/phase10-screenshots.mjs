import { chromium } from "playwright";

const pageUrl = process.argv[2] ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const shots = [];

async function screenshot(name) {
  const path = `.supergoal/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  shots.push(path);
}

async function rpc(channel, body) {
  return page.evaluate(
    async ({ channel, body }) => {
      const config = globalThis.__DYAD_LOCAL_WEB_CONFIG__;
      if (!config?.baseUrl || !config?.token) {
        throw new Error("Local Web config missing from page");
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
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(`${channel} failed: ${JSON.stringify(json)}`);
      }
      return json.data;
    },
    { channel, body },
  );
}

try {
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root");
  await page.waitForTimeout(1500);
  await screenshot("web-phase10-home");

  const suffix = Date.now();
  const created = await rpc("create-app", {
    name: `Phase 10 Web ${suffix}`,
    initialChatMode: "build",
  });
  const appId = created.app.id;

  await page.goto(`${pageUrl}/app-details?appId=${appId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  await screenshot("web-phase10-app-details");

  await page.goto(`${pageUrl}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await screenshot("web-phase10-chat");

  await page.goto(`${pageUrl}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await screenshot("web-phase10-settings");

  await page
    .getByTestId("customize-apps-folder-button")
    .click({ timeout: 5000 });
  await page.waitForTimeout(1000);
  await screenshot("web-phase10-native-fallback");

  console.info(JSON.stringify({ pageUrl, appId, screenshots: shots }));
} finally {
  await browser.close();
}
