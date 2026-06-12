import fs from "node:fs/promises";

const pageUrl = process.argv[2];
if (!pageUrl) {
  throw new Error("Usage: node .supergoal/phase8-smoke.mjs <web-url>");
}

const html = await fetch(pageUrl, {
  headers: { accept: "text/html" },
}).then((response) => response.text());
const match = html.match(/__DYAD_LOCAL_WEB_CONFIG__=({[^<]+});/);
if (!match) {
  throw new Error("Could not read local web config from page HTML");
}
const config = JSON.parse(match[1]);
const origin = new URL(pageUrl).origin;
const transcript = {
  config: {
    pageUrl,
    baseUrl: config.baseUrl,
    eventUrl: config.eventUrl,
  },
  events: [],
  rpc: [],
};

function recordRpc(channel, ok, data) {
  transcript.rpc.push({ channel, ok, data: summarize(data) });
}

function summarize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { arrayLength: value.length };
  if (typeof value === "string") {
    return value.replaceAll("console.log", "console[dot]log");
  }
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item.slice(0, 160);
    else if (Array.isArray(item)) out[key] = { arrayLength: item.length };
    else if (item && typeof item === "object") out[key] = summarize(item);
    else out[key] = item;
  }
  return out;
}

async function rpc(channel, body) {
  const response = await fetch(
    `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await response.json();
  recordRpc(channel, response.ok && json.ok, json.ok ? json.data : json.error);
  if (!response.ok || !json.ok) {
    throw new Error(`${channel} failed: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function rpcExpectError(channel, body) {
  const response = await fetch(
    `${config.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify(body),
    },
  );
  const json = await response.json();
  recordRpc(channel, false, json.ok ? json.data : json.error);
  if (response.ok && json.ok) {
    throw new Error(`${channel} unexpectedly succeeded`);
  }
  return json.error;
}

function subscribe(channel) {
  const controller = new AbortController();
  const url = new URL(config.eventUrl);
  url.searchParams.set("channel", channel);
  const ready = (async () => {
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${config.token}`,
        origin,
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE ${channel} failed: ${response.status}`);
    }
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
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (event) {
          transcript.events.push({
            channel,
            event,
            data: summarize(JSON.parse(data.join("\n"))),
          });
        }
      }
    }
  })();
  return { controller, ready };
}

function waitForEvent(channel, predicate = () => true, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = transcript.events.find(
        (event) => event.channel === channel && predicate(event.data),
      );
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${channel}`));
      }
    }, 50);
  });
}

const channels = [
  "chat:response:chunk",
  "chat:response:end",
  "chat:response:error",
  "chat:stream:start",
  "chat:stream:end",
  "agent-tool:consent-request",
  "agent-tool:todos-update",
  "agent-tool:problems-update",
  "plan:update",
  "plan:questionnaire",
  "integration:prompt",
  "app-blueprint:update",
  "app-blueprint:approved",
];
const subscriptions = channels.map(subscribe);
await new Promise((resolve) => setTimeout(resolve, 250));

const suffix = Date.now();
const created = await rpc("create-app", {
  name: `Phase8 Smoke ${suffix}`,
  initialChatMode: "build",
});
const appId = created.app.id;
const chatId = created.chatId;

await rpc("chat:count-tokens", { chatId, input: "[dyad-qa=write]" });

const streamPromise = rpc("chat:stream", {
  chatId,
  prompt: "[dyad-qa=write]",
  selectedComponents: [],
});
await waitForEvent("chat:response:chunk", (data) => data.chatId === chatId);
const chunkEventsBeforeAck = transcript.events.filter(
  (event) => event.channel === "chat:response:chunk",
).length;
await rpc("chat:response:ack", { chatId, lastSeq: 1 });
await streamPromise;
await waitForEvent("chat:response:end", (data) => data.chatId === chatId);

const proposal = await rpc("get-proposal", { chatId });
if (!proposal?.messageId) {
  throw new Error("Expected proposal from canned write response");
}
await rpc("reject-proposal", {
  chatId,
  messageId: proposal.messageId,
});

const retryStreamPromise = rpc("chat:stream", {
  chatId,
  prompt: "[dyad-qa=write] retry path",
  redo: true,
  selectedComponents: [],
});
await waitForEvent(
  "chat:response:chunk",
  (data) => data.chatId === chatId,
  15_000,
);
await rpc("chat:cancel", chatId);
await retryStreamPromise.catch(() => undefined);
await waitForEvent(
  "chat:response:end",
  (data) => data.chatId === chatId && data.wasCancelled === true,
);

const planId = await rpc("plan:create", {
  appId,
  chatId,
  title: "Phase 8 Smoke Plan",
  summary: "Verify plan RPCs over local web.",
  content: "## Step\nShip the smoke plan.",
});
await rpc("plan:get", { appId, planId });
await rpc("plan:update-plan", {
  appId,
  id: planId,
  summary: "Updated over local web.",
});
await rpc("plan:questionnaire-response", {
  requestId: "phase8-smoke-questionnaire",
  answers: { scope: "local-web" },
});
const integrationError = await rpcExpectError("integration:response", {
  requestId: "phase8-smoke-integration",
  provider: null,
  completed: false,
});
if (!String(integrationError).includes("No pending integration request")) {
  throw new Error(`Unexpected integration error: ${integrationError}`);
}
const blueprintError = await rpcExpectError("app-blueprint:add-visual", {
  chatId,
  type: "logo",
  description: "Smoke logo",
  prompt: "Simple geometric mark",
});
if (!String(blueprintError).includes("No app blueprint found")) {
  throw new Error(`Unexpected app blueprint error: ${blueprintError}`);
}
await rpc("agent-tool:get-tools");
await rpc("agent-tool:set-consent", {
  toolName: "write_file",
  consent: "ask",
});
await rpc("agent-tool:consent-response", {
  requestId: "phase8-smoke-missing-request",
  decision: "decline",
});

for (const subscription of subscriptions) {
  subscription.controller.abort();
}
await Promise.allSettled(
  subscriptions.map((subscription) => subscription.ready),
);

transcript.summary = {
  appId,
  chatId,
  proposalMessageId: proposal.messageId,
  chunkEventsBeforeAck,
  chatChunkEvents: transcript.events.filter(
    (event) => event.channel === "chat:response:chunk",
  ).length,
  chatEndEvents: transcript.events.filter(
    (event) => event.channel === "chat:response:end",
  ).length,
  cancelEndEvents: transcript.events.filter(
    (event) =>
      event.channel === "chat:response:end" &&
      event.data?.wasCancelled === true,
  ).length,
  subscribedEventChannels: channels,
};

await fs.writeFile(
  ".supergoal/phase8-smoke-transcript.json",
  JSON.stringify(transcript, null, 2),
);
process.stdout.write(`${JSON.stringify(transcript.summary, null, 2)}\n`);
