import fs from "node:fs";
import path from "node:path";

import { startLocalWebRuntime } from "../src/server/local_web_runtime.ts";

const origin = "http://localhost:5173";
const token = "dyad-local-web-provider-smoke-token-32-bytes-min";
const userDataPath = fs.mkdtempSync(
  path.join(process.cwd(), "tmp-local-web-provider-smoke-"),
);

let runtime;
const report = {
  ok: false,
  authGates: {},
  realProviderChecks: {},
};

try {
  runtime = await startLocalWebRuntime({
    allowedOrigins: [origin],
    token,
    userDataPath,
    version: "provider-smoke",
  });
  report.baseUrl = runtime.server.info.baseUrl;

  report.authGates.github = await expectRpcError(
    "github:list-repos",
    undefined,
  );
  report.authGates.supabase = await expectRpcError(
    "supabase:list-all-projects",
    undefined,
  );
  report.authGates.neon = await expectRpcError("neon:list-projects", undefined);

  if (process.env.DYAD_TEST_GITHUB_TOKEN) {
    runtime.settingsStore.writeSettings({
      githubAccessToken: { value: process.env.DYAD_TEST_GITHUB_TOKEN },
    });
    const repos = await rpc("github:list-repos", undefined);
    report.realProviderChecks.github = {
      configured: true,
      repoCount: Array.isArray(repos) ? repos.length : null,
    };
  } else {
    report.realProviderChecks.github = {
      configured: false,
      skipped: "DYAD_TEST_GITHUB_TOKEN is not set",
    };
  }

  if (
    process.env.DYAD_TEST_SUPABASE_TOKEN &&
    process.env.DYAD_TEST_SUPABASE_ORG
  ) {
    await rpc("supabase:save-organization-token", {
      organizationSlug: process.env.DYAD_TEST_SUPABASE_ORG,
      accessToken: process.env.DYAD_TEST_SUPABASE_TOKEN,
    });
    const projects = await rpc("supabase:list-all-projects", undefined);
    report.realProviderChecks.supabase = {
      configured: true,
      projectCount: Array.isArray(projects) ? projects.length : null,
    };
  } else {
    report.realProviderChecks.supabase = {
      configured: false,
      skipped:
        "DYAD_TEST_SUPABASE_TOKEN and DYAD_TEST_SUPABASE_ORG are not both set",
    };
  }

  if (process.env.DYAD_TEST_NEON_API_KEY) {
    await rpc("neon:save-api-key", {
      apiKey: process.env.DYAD_TEST_NEON_API_KEY,
    });
    const projects = await rpc("neon:list-projects", undefined);
    report.realProviderChecks.neon = {
      configured: true,
      projectCount: projects.projects.length,
    };
  } else {
    report.realProviderChecks.neon = {
      configured: false,
      skipped: "DYAD_TEST_NEON_API_KEY is not set",
    };
  }

  report.ok =
    report.authGates.github.kind === "auth" &&
    report.authGates.supabase.kind === "auth" &&
    report.authGates.neon.kind === "auth";
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (runtime) {
    await runtime.close();
  }
  fs.rmSync(userDataPath, { recursive: true, force: true });
}

async function rpc(channel, body) {
  const response = await fetch(
    `${runtime.server.info.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin,
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

async function expectRpcError(channel, body) {
  const response = await fetch(
    `${runtime.server.info.baseUrl}/api/rpc/${encodeURIComponent(channel)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const payload = await response.json();
  if (response.ok || payload.ok) {
    throw new Error(`${channel} unexpectedly succeeded`);
  }
  return {
    status: response.status,
    kind: payload.kind,
    message: payload.error,
  };
}
