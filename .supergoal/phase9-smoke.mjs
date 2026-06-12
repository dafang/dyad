import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startLocalWebRuntime } from "../src/server/local_web_runtime.ts";

const origin = "http://localhost:5173";
const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-phase9-"));
const runtime = await startLocalWebRuntime({
  allowedOrigins: [origin],
  userDataPath,
});
const baseUrl = runtime.server.info.baseUrl;
const token = runtime.server.info.token;
const transcript = {
  baseUrl,
  userDataPath,
  rpc: [],
};

function summarize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { arrayLength: value.length };
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) out[key] = { arrayLength: item.length };
    else if (item && typeof item === "object") out[key] = summarize(item);
    else out[key] = item;
  }
  return out;
}

async function rpc(channel, body, expectOk = true) {
  const response = await fetch(
    `${baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await response.json();
  transcript.rpc.push({
    channel,
    status: response.status,
    ok: Boolean(json.ok),
    body: summarize(json.ok ? json.data : json),
  });
  if (expectOk && (!response.ok || !json.ok)) {
    throw new Error(`${channel} failed: ${JSON.stringify(json)}`);
  }
  if (!expectOk && response.ok && json.ok) {
    throw new Error(`${channel} unexpectedly succeeded`);
  }
  return json;
}

try {
  await rpc("get-user-settings");
  await rpc("set-user-settings", { zoomLevel: "110" });
  await rpc("get-language-model-providers");
  await rpc("get-language-models", { providerId: "openai" });
  await rpc("local-models:list-ollama");
  await rpc("vercel:save-token", { token: "phase9-vercel-token" });
  await rpc("vercel:list-projects");
  await rpc("supabase:list-organizations");
  await rpc("neon:list-projects");
  await rpc("github:list-repos", undefined, false);
  await rpc("github:start-flow", { appId: null }, false);
  await rpc("mcp:create-server", {
    name: "Phase 9 MCP",
    transport: "http",
    url: "https://example.com/mcp",
    envJson: "{}",
    enabled: true,
  });
  await rpc(
    "mcp:create-server",
    {
      name: "Broken MCP",
      transport: "http",
      envJson: "{",
    },
    false,
  );
  await rpc("mcp:start-oauth", { serverId: 0 });
  await rpc("mcp:probe-connection", 0);
  await rpc("get-latest-security-review", 1);
  await rpc("analyze-component", {
    appId: 1,
    componentId: "component-1",
  });
  await rpc("is-capacitor", { appId: 1 });
  await rpc(
    "generate-image",
    {
      targetAppId: 1,
      prompt: "test",
      themeMode: "plain",
      requestId: "phase9-image",
    },
    false,
  );
  await rpc(
    "pro:transcribe-audio",
    {
      audioData: [0, 1, 2],
      filename: "audio.wav",
      requestId: "phase9-audio",
    },
    false,
  );
  await rpc("open-external-url", "https://example.com");
  await rpc("open-external-url", "file:///tmp/nope", false);
  await fs.writeFile(
    ".supergoal/phase9-smoke-transcript.json",
    `${JSON.stringify(transcript, null, 2)}\n`,
  );
  console.info(
    JSON.stringify({
      baseUrl,
      rpcCount: transcript.rpc.length,
      failures: transcript.rpc
        .filter((entry) => !entry.ok)
        .map((entry) => ({
          channel: entry.channel,
          status: entry.status,
          kind: entry.body.kind,
        })),
    }),
  );
} finally {
  await runtime.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
