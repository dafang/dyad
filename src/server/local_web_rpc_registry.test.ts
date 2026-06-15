import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeDatabase,
  configureDatabaseUserDataPath,
  db,
  initializeDatabase,
} from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createHttpInvokeTransport } from "@/ipc/contracts/core";
import { createDefaultLocalWebIntegrationService } from "@/ipc/services/default_local_web_integration_service";
import { createLocalWebPathResolver } from "./local_web_paths";
import {
  LOCAL_WEB_RPC_ALLOWLIST,
  registerLocalWebRpcHandlers,
  type LocalWebRpcService,
} from "./local_web_rpc_registry";
import {
  createLocalEventStream,
  createSseEventTransport,
} from "./local_event_stream";
import { createLocalRpcServer, type LocalRpcServer } from "./local_rpc_server";
import { createLocalWebSettingsStore } from "./local_web_settings";

const now = new Date("2026-06-11T00:00:00.000Z");
const origin = "http://localhost:5173";

describe("local Web RPC registry", () => {
  let server: LocalRpcServer | undefined;
  let baseUrl: string;
  let service: LocalWebRpcService;
  let activeEvents: ReturnType<typeof createLocalEventStream> | undefined;

  afterEach(async () => {
    activeEvents?.close();
    activeEvents = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("exposes only the migrated endpoint allowlist", () => {
    expect(LOCAL_WEB_RPC_ALLOWLIST).toEqual([
      "get-user-settings",
      "set-user-settings",
      "get-env-vars",
      "get-app-env-vars",
      "set-app-env-vars",
      "add-log",
      "clear-logs",
      "check-problems",
      "renderer:error-toast-ready",
      "get-system-platform",
      "get-initial-load-telemetry-context",
      "get-system-debug-info",
      "get-app-version",
      "nodejs-status",
      "install-pnpm",
      "select-app-folder",
      "get-custom-apps-folder",
      "open-external-url",
      "show-item-in-folder",
      "open-file-path",
      "get-user-budget",
      "get-app",
      "list-apps",
      "create-app",
      "delete-app",
      "delete-apps",
      "copy-app",
      "rename-app",
      "run-app",
      "stop-app",
      "restart-app",
      "app:get-running-preview",
      "respond-to-app-input",
      "edit-app-file",
      "read-app-file",
      "search-app-files",
      "change-app-location",
      "add-to-favorite",
      "select-app-location",
      "check-app-name",
      "search-app",
      "update-app-commands",
      "select-app-for-preview",
      "app:get-current-commit-hash",
      "app:save-screenshot",
      "app:list-screenshots",
      "app:list-thumbnails",
      "get-chat",
      "get-chats",
      "get-chat-metadata",
      "create-chat",
      "update-chat",
      "delete-chat",
      "delete-messages",
      "search-chats",
      "chat:count-tokens",
      "chat:cancel",
      "chat:response:ack",
      "chat:stream",
      "get-proposal",
      "approve-proposal",
      "reject-proposal",
      "agent-tool:get-tools",
      "agent-tool:set-consent",
      "agent-tool:consent-response",
      "help:chat:start",
      "help:chat:cancel",
      "plan:create",
      "plan:get",
      "plan:get-for-chat",
      "plan:update-plan",
      "plan:delete",
      "plan:questionnaire-response",
      "integration:response",
      "app-blueprint:approve",
      "app-blueprint:edit-field",
      "app-blueprint:edit-visual",
      "app-blueprint:add-visual",
      "app-blueprint:remove-visual",
      "get-templates",
      "apply-app-template",
      "get-themes",
      "set-app-theme",
      "get-custom-themes",
      "get-theme-generation-model-options",
      "save-theme-image",
      "cleanup-theme-images",
      "generate-theme-prompt",
      "generate-theme-from-url",
      "get-app-theme",
      "create-custom-theme",
      "update-custom-theme",
      "delete-custom-theme",
      "prompts:list",
      "prompts:create",
      "prompts:update",
      "prompts:delete",
      "appCollections:list",
      "appCollections:create",
      "appCollections:update",
      "appCollections:delete",
      "appCollections:assignApps",
      "import-app",
      "check-app-name",
      "check-ai-rules",
      "get-context-paths",
      "set-context-paths",
      "get-language-model-providers",
      "get-language-models",
      "get-language-models-by-providers",
      "free-agent-quota:get-status",
      "list-all-media",
      "rename-media-file",
      "delete-media-file",
      "move-media-file",
      "terminal:open",
      "terminal:close",
      "terminal:kill",
      "terminal:write",
      "terminal:resize",
      "terminal:serialize",
      "list-versions",
      "get-current-branch",
      "revert-version",
      "checkout-version",
      "github:start-flow",
      "github:list-repos",
      "github:get-repo-branches",
      "github:is-repo-available",
      "github:create-repo",
      "github:connect-existing-repo",
      "github:push",
      "github:fetch",
      "github:pull",
      "github:rebase",
      "github:rebase-abort",
      "github:merge-abort",
      "github:rebase-continue",
      "github:list-local-branches",
      "github:list-remote-branches",
      "github:create-branch",
      "github:switch-branch",
      "github:delete-branch",
      "github:rename-branch",
      "github:merge-branch",
      "github:get-conflicts",
      "github:get-git-state",
      "github:disconnect",
      "github:list-collaborators",
      "github:invite-collaborator",
      "github:remove-collaborator",
      "github:clone-repo-from-url",
      "git:get-uncommitted-files",
      "git:commit-changes",
      "git:discard-changes",
      "vercel:save-token",
      "vercel:list-projects",
      "vercel:is-project-available",
      "vercel:create-project",
      "vercel:connect-existing-project",
      "vercel:get-deployments",
      "vercel:disconnect",
      "vercel:get-sync-preview",
      "vercel:sync-neon-config",
      "vercel:remove-neon-env-vars",
      "supabase:list-organizations",
      "supabase:delete-organization",
      "supabase:list-all-projects",
      "supabase:list-branches",
      "supabase:get-edge-logs",
      "supabase:set-app-project",
      "supabase:unset-app-project",
      "supabase:fake-connect-and-set-project",
      "neon:create-project",
      "neon:get-project",
      "neon:list-projects",
      "neon:set-app-project",
      "neon:unset-app-project",
      "neon:set-active-branch",
      "neon:get-email-password-config",
      "neon:update-email-verification",
      "neon:fake-connect",
      "neon:get-branch-env-vars",
      "neon:set-selected-database-branch-type",
      "mcp:list-servers",
      "mcp:create-server",
      "mcp:update-server",
      "mcp:delete-server",
      "mcp:get-tool-consents",
      "mcp:set-tool-consent",
      "mcp:tool-consent-response",
      "mcp:list-tools",
      "mcp:start-oauth",
      "mcp:disconnect-oauth",
      "mcp:is-oauth-storage-encrypted",
      "mcp:probe-callback-port",
      "mcp:probe-connection",
      "create-custom-language-model-provider",
      "edit-custom-language-model-provider",
      "delete-custom-language-model-provider",
      "create-custom-language-model",
      "delete-custom-language-model",
      "delete-custom-model",
      "local-models:list-ollama",
      "local-models:list-lmstudio",
      "get-latest-security-review",
      "apply-visual-editing-changes",
      "analyze-component",
      "get-app-upgrades",
      "execute-app-upgrade",
      "is-capacitor",
      "sync-capacitor",
      "open-ios",
      "open-android",
      "generate-image",
      "cancel-image-generation",
      "pro:transcribe-audio",
    ]);
  });

  it("serves get-app over authenticated HTTP using contract schemas", async () => {
    await startRegistryServer();
    const transport = createHttpInvokeTransport({
      baseUrl,
      token: "local-token",
      fetch: nodeFetch,
      headers: { origin },
    });

    await expect(transport.invoke("get-app", 1)).resolves.toMatchObject({
      id: 1,
      name: "Test App",
      files: ["src/App.tsx"],
      resolvedPath: "/apps/test-app",
    });
    expect(service.getApp).toHaveBeenCalledWith(1);
  });

  it("serves get-chat over authenticated HTTP using contract schemas", async () => {
    await startRegistryServer();
    const transport = createHttpInvokeTransport({
      baseUrl,
      token: "local-token",
      fetch: nodeFetch,
      headers: { origin },
    });

    await expect(transport.invoke("get-chat", 7)).resolves.toMatchObject({
      id: 7,
      title: "Chat",
      messages: [{ id: 10, role: "user", content: "hello" }],
    });
    expect(service.getChat).toHaveBeenCalledWith(7);
  });

  it("serves shell read contracts over authenticated HTTP", async () => {
    await startRegistryServer();
    const transport = createTransport(baseUrl);

    await expect(
      transport.invoke("get-user-settings", undefined),
    ).resolves.toMatchObject({
      selectedModel: { provider: "auto", name: "auto" },
    });
    await expect(
      transport.invoke("set-user-settings", { zoomLevel: "110" }),
    ).resolves.toMatchObject({
      selectedModel: { provider: "auto", name: "auto" },
    });
    await expect(transport.invoke("get-env-vars", undefined)).resolves.toEqual({
      OPENAI_API_KEY: "configured",
    });
    await expect(
      transport.invoke("get-system-platform", undefined),
    ).resolves.toBe("darwin");
    await expect(
      transport.invoke("get-initial-load-telemetry-context", undefined),
    ).resolves.toEqual({ isFirstSession: false });
    await expect(
      transport.invoke("get-system-debug-info", undefined),
    ).resolves.toMatchObject({
      dyadVersion: "1.3.0",
      selectedLanguageModel: "auto:auto",
    });
    await expect(
      transport.invoke("nodejs-status", undefined),
    ).resolves.toMatchObject({
      nodeVersion: "v24.0.0",
    });
    await expect(transport.invoke("install-pnpm", undefined)).resolves.toEqual({
      pnpmVersion: "11.1.2",
    });
    await expect(
      transport.invoke("get-custom-apps-folder", undefined),
    ).resolves.toMatchObject({
      path: "/apps",
      isPathAvailable: true,
    });
    await expect(
      transport.invoke("get-app-version", undefined),
    ).resolves.toEqual({ version: "1.3.0" });
    await expect(transport.invoke("get-user-budget", undefined)).resolves.toBe(
      null,
    );
    await expect(
      transport.invoke("renderer:error-toast-ready", undefined),
    ).resolves.toBeUndefined();
  });

  it("serves app, chat, library, model, media, version, and MCP reads", async () => {
    await startRegistryServer();
    const transport = createTransport(baseUrl);

    await expect(
      transport.invoke("list-apps", undefined),
    ).resolves.toMatchObject({
      apps: [{ id: 1, name: "Test App" }],
    });
    await expect(transport.invoke("search-app", "Test")).resolves.toMatchObject(
      [{ id: 1, name: "Test App" }],
    );
    await expect(
      transport.invoke("app:list-screenshots", { appId: 1 }),
    ).resolves.toEqual({ screenshots: [] });
    await expect(
      transport.invoke("app:list-thumbnails", { appIds: [1] }),
    ).resolves.toEqual({ thumbnails: [{ appId: 1, thumbnailUrl: null }] });
    await expect(transport.invoke("get-chats", 1)).resolves.toMatchObject([
      { id: 7, appId: 1, title: "Chat" },
    ]);
    await expect(
      transport.invoke("get-chat-metadata", 7),
    ).resolves.toMatchObject({ id: 7, title: "Chat" });
    await expect(
      transport.invoke("get-templates", undefined),
    ).resolves.toMatchObject([{ id: "react", title: "React.js Template" }]);
    await expect(
      transport.invoke("apply-app-template", {
        appId: 1,
        templateId: "react",
        chatId: 7,
      }),
    ).resolves.toEqual({ applied: true, needsRestart: false });
    await expect(
      transport.invoke("get-themes", undefined),
    ).resolves.toMatchObject([{ id: "default", name: "Default Theme" }]);
    await expect(
      transport.invoke("get-custom-themes", undefined),
    ).resolves.toEqual([]);
    await expect(
      transport.invoke("get-theme-generation-model-options", undefined),
    ).resolves.toEqual([
      { id: "dyad/theme-generator/openai", label: "OpenAI" },
    ]);
    await expect(
      transport.invoke("get-app-theme", { appId: 1 }),
    ).resolves.toBeNull();
    await expect(transport.invoke("prompts:list", undefined)).resolves.toEqual(
      [],
    );
    await expect(
      transport.invoke("appCollections:list", undefined),
    ).resolves.toEqual([]);
    await expect(
      transport.invoke("get-language-model-providers", undefined),
    ).resolves.toMatchObject([{ id: "openai", name: "OpenAI" }]);
    await expect(
      transport.invoke("get-language-models", { providerId: "openai" }),
    ).resolves.toMatchObject([{ apiName: "gpt-5", displayName: "GPT 5" }]);
    await expect(
      transport.invoke("get-language-models-by-providers", undefined),
    ).resolves.toMatchObject({ openai: [{ apiName: "gpt-5" }] });
    await expect(
      transport.invoke("free-agent-quota:get-status", undefined),
    ).resolves.toMatchObject({ messagesUsed: 0, isQuotaExceeded: false });
    await expect(
      transport.invoke("list-all-media", undefined),
    ).resolves.toEqual({
      apps: [],
    });
    await expect(
      transport.invoke("list-versions", { appId: 1 }),
    ).resolves.toEqual([]);
    await expect(
      transport.invoke("app:get-current-commit-hash", { appId: 1 }),
    ).resolves.toEqual({ commitHash: null });
    await expect(
      transport.invoke("app:save-screenshot", {
        appId: 1,
        dataUrl: "data:image/png;base64,AA==",
        commitHash: "0123456789012345678901234567890123456789",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("get-current-branch", { appId: 1 }),
    ).resolves.toEqual({ branch: "main" });
    await expect(
      transport.invoke("revert-version", {
        appId: 1,
        previousVersionId: "abc123",
      }),
    ).resolves.toEqual({ successMessage: "Restored version" });
    await expect(
      transport.invoke("checkout-version", {
        appId: 1,
        versionId: "abc123",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("check-problems", { appId: 1 }),
    ).resolves.toEqual({ problems: [] });
    await expect(
      transport.invoke("mcp:list-servers", undefined),
    ).resolves.toEqual([]);
    await expect(
      transport.invoke("mcp:get-tool-consents", undefined),
    ).resolves.toEqual([]);
    await expect(transport.invoke("mcp:list-tools", 1)).resolves.toEqual({
      tools: [],
      status: "error",
    });
    await expect(
      transport.invoke("mcp:is-oauth-storage-encrypted", undefined),
    ).resolves.toEqual({ available: false });
    await expect(
      transport.invoke("mcp:probe-callback-port", undefined),
    ).resolves.toEqual({ port: 53682 });
  });

  it("serves chat workflow endpoints and publishes push events over SSE", async () => {
    const events = createLocalEventStream();
    await startRegistryServer(createService(), events);
    const transport = createTransport(baseUrl);
    const eventTransport = createSseEventTransport({
      baseUrl,
      token: "local-token",
      fetch: streamingNodeFetch,
    });
    const chunks: unknown[] = [];
    const consentRequests: unknown[] = [];
    const todosUpdates: unknown[] = [];
    const problemsUpdates: unknown[] = [];
    const planUpdates: unknown[] = [];
    const questionnaires: unknown[] = [];
    const integrationPrompts: unknown[] = [];
    const blueprintUpdates: unknown[] = [];
    const approvals: unknown[] = [];
    const unsubscribeChunk = eventTransport.on!(
      "chat:response:chunk",
      (payload) => chunks.push(payload),
    );
    const unsubscribeConsent = eventTransport.on!(
      "agent-tool:consent-request",
      (payload) => consentRequests.push(payload),
    );
    const unsubscribeTodos = eventTransport.on!(
      "agent-tool:todos-update",
      (payload) => todosUpdates.push(payload),
    );
    const unsubscribeProblems = eventTransport.on!(
      "agent-tool:problems-update",
      (payload) => problemsUpdates.push(payload),
    );
    const unsubscribePlan = eventTransport.on!("plan:update", (payload) =>
      planUpdates.push(payload),
    );
    const unsubscribeQuestionnaire = eventTransport.on!(
      "plan:questionnaire",
      (payload) => questionnaires.push(payload),
    );
    const unsubscribeIntegration = eventTransport.on!(
      "integration:prompt",
      (payload) => integrationPrompts.push(payload),
    );
    const unsubscribeBlueprintUpdate = eventTransport.on!(
      "app-blueprint:update",
      (payload) => blueprintUpdates.push(payload),
    );
    const unsubscribeBlueprint = eventTransport.on!(
      "app-blueprint:approved",
      (payload) => approvals.push(payload),
    );

    await waitFor(() => events.subscriberCount("chat:response:chunk") === 1);
    await waitFor(
      () => events.subscriberCount("agent-tool:consent-request") === 1,
    );
    await waitFor(
      () => events.subscriberCount("agent-tool:todos-update") === 1,
    );
    await waitFor(
      () => events.subscriberCount("agent-tool:problems-update") === 1,
    );
    await waitFor(() => events.subscriberCount("plan:update") === 1);
    await waitFor(() => events.subscriberCount("plan:questionnaire") === 1);
    await waitFor(() => events.subscriberCount("integration:prompt") === 1);
    await waitFor(() => events.subscriberCount("app-blueprint:update") === 1);
    await waitFor(() => events.subscriberCount("app-blueprint:approved") === 1);

    await expect(
      transport.invoke("chat:stream", { chatId: 7, prompt: "hello" }),
    ).resolves.toBe(7);
    await waitFor(() => chunks.length === 1);
    expect(chunks[0]).toEqual({
      chatId: 7,
      messages: [{ id: 11, role: "assistant", content: "hello web" }],
    });
    await waitFor(() => consentRequests.length === 1);
    expect(consentRequests[0]).toMatchObject({
      requestId: "consent-1",
      chatId: 7,
      toolName: "write_file",
    });
    await waitFor(() => todosUpdates.length === 1);
    expect(todosUpdates[0]).toEqual({
      chatId: 7,
      todos: [
        {
          id: "todo-1",
          content: "Check Web event bridge",
          status: "in_progress",
        },
      ],
    });
    await waitFor(() => problemsUpdates.length === 1);
    expect(problemsUpdates[0]).toMatchObject({
      appId: 1,
      problems: {
        problems: [{ file: "src/App.tsx", code: 2322 }],
      },
    });
    await waitFor(() => planUpdates.length === 1);
    expect(planUpdates[0]).toMatchObject({
      chatId: 7,
      title: "Web Plan",
      plan: "## Verify",
    });
    await waitFor(() => questionnaires.length === 1);
    expect(questionnaires[0]).toMatchObject({
      chatId: 7,
      requestId: "question-1",
      questions: [{ id: "scope", type: "text" }],
    });
    await waitFor(() => integrationPrompts.length === 1);
    expect(integrationPrompts[0]).toEqual({
      chatId: 7,
      requestId: "integration-1",
      provider: "supabase",
    });
    await waitFor(() => blueprintUpdates.length === 1);
    expect(blueprintUpdates[0]).toMatchObject({
      chatId: 7,
      data: {
        appName: "Test App",
        templateId: "react",
        themeId: "default",
      },
    });
    expect(service.startChatStream).toHaveBeenCalledOnce();

    await expect(
      transport.invoke("chat:count-tokens", { chatId: 7, input: "hello" }),
    ).resolves.toMatchObject({ estimatedTotalTokens: 42 });
    await expect(
      transport.invoke("chat:response:ack", {
        chatId: 7,
        lastSeq: 2,
      }),
    ).resolves.toBeUndefined();
    await expect(transport.invoke("chat:cancel", 7)).resolves.toBe(true);
    await expect(
      transport.invoke("get-proposal", { chatId: 7 }),
    ).resolves.toMatchObject({
      chatId: 7,
      messageId: 11,
      proposal: { type: "tip-proposal" },
    });
    await expect(
      transport.invoke("approve-proposal", { chatId: 7, messageId: 11 }),
    ).resolves.toEqual({ success: true });
    await expect(
      transport.invoke("reject-proposal", { chatId: 7, messageId: 11 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("agent-tool:get-tools", undefined),
    ).resolves.toEqual([]);
    await expect(
      transport.invoke("agent-tool:set-consent", {
        toolName: "write_file",
        consent: "ask",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("agent-tool:consent-response", {
        requestId: "req-1",
        decision: "accept-once",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("plan:create", {
        appId: 1,
        chatId: 7,
        title: "Plan",
        content: "Do it",
      }),
    ).resolves.toBe("plan-1");
    await expect(
      transport.invoke("plan:get-for-chat", { appId: 1, chatId: 7 }),
    ).resolves.toMatchObject({ id: "plan-1", chatId: 7 });
    await expect(
      transport.invoke("plan:questionnaire-response", {
        requestId: "question-1",
        answers: { a: "b" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("integration:response", {
        requestId: "integration-1",
        provider: "supabase",
        completed: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("app-blueprint:approve", { chatId: 7 }),
    ).resolves.toBeUndefined();
    await waitFor(() => approvals.length === 1);
    expect(approvals[0]).toEqual({ chatId: 7 });
    await expect(
      transport.invoke("app-blueprint:add-visual", {
        chatId: 7,
        type: "photo",
        description: "Hero",
        prompt: "A hero image",
      }),
    ).resolves.toEqual({ visualId: "visual-1" });
    await expect(
      transport.invoke("help:chat:start", {
        sessionId: "help-1",
        message: "hi",
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      transport.invoke("help:chat:cancel", "help-1"),
    ).resolves.toEqual({ ok: true });

    unsubscribeChunk();
    unsubscribeConsent();
    unsubscribeTodos();
    unsubscribeProblems();
    unsubscribePlan();
    unsubscribeQuestionnaire();
    unsubscribeIntegration();
    unsubscribeBlueprintUpdate();
    unsubscribeBlueprint();
  });

  it("serves migrated mutations over authenticated HTTP", async () => {
    await startRegistryServer();
    const transport = createTransport(baseUrl);

    await expect(
      transport.invoke("create-app", { name: "new-app" }),
    ).resolves.toMatchObject({ app: { id: 2, name: "New App" }, chatId: 8 });
    await expect(
      transport.invoke("rename-app", {
        appId: 1,
        appName: "Renamed",
        appPath: "renamed",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("run-app", { appId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("restart-app", { appId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("app:get-running-preview", { appId: 1 }),
    ).resolves.toEqual({
      appId: 1,
      appUrl: "http://localhost:42101",
      originalUrl: "http://localhost:32101",
      mode: "host",
    });
    await expect(
      transport.invoke("stop-app", { appId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("respond-to-app-input", {
        appId: 1,
        response: "y",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("select-app-for-preview", { appId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("read-app-file", { appId: 1, filePath: "src/App.tsx" }),
    ).resolves.toBe("export default function App() {}");
    await expect(
      transport.invoke("edit-app-file", {
        appId: 1,
        filePath: "src/App.tsx",
        content: "updated",
      }),
    ).resolves.toEqual({});
    await expect(
      transport.invoke("get-app-env-vars", { appId: 1 }),
    ).resolves.toEqual([{ key: "VITE_FLAG", value: "true" }]);
    await expect(
      transport.invoke("set-app-env-vars", {
        appId: 1,
        envVars: [{ key: "VITE_FLAG", value: "false" }],
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("add-log", {
        level: "info",
        type: "server",
        message: "Connecting to app...",
        appId: 1,
        timestamp: now.getTime(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("clear-logs", { appId: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("get-context-paths", { appId: 1 }),
    ).resolves.toMatchObject({ contextPaths: [] });
    await expect(
      transport.invoke("set-context-paths", {
        appId: 1,
        chatContext: { contextPaths: [], smartContextAutoIncludes: [] },
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("prompts:create", {
        title: "Prompt",
        content: "Use this",
      }),
    ).resolves.toMatchObject({ id: 1, title: "Prompt" });
    await expect(
      transport.invoke("appCollections:create", {
        name: "Favorites",
        appIds: [1],
      }),
    ).resolves.toMatchObject({ id: 1, name: "Favorites", appIds: [1] });
    await expect(
      transport.invoke("create-custom-theme", {
        name: "Theme",
        prompt: "<theme></theme>",
      }),
    ).resolves.toMatchObject({ id: 1, name: "Theme" });
    await expect(
      transport.invoke("save-theme-image", {
        data: Buffer.from("image").toString("base64"),
        filename: "reference.png",
      }),
    ).resolves.toEqual({ path: "/tmp/reference.png" });
    await expect(
      transport.invoke("generate-theme-prompt", {
        imagePaths: ["/tmp/reference.png"],
        keywords: "modern",
        generationMode: "inspired",
        model: "dyad/theme-generator/openai",
      }),
    ).resolves.toEqual({ prompt: "<theme>generated</theme>" });
    await expect(
      transport.invoke("cleanup-theme-images", {
        paths: ["/tmp/reference.png"],
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("generate-theme-from-url", {
        url: "https://example.com",
        keywords: "",
        generationMode: "inspired",
        model: "dyad/theme-generator/openai",
      }),
    ).rejects.toThrow(
      "Website URL theme generation is not available in Local Web mode yet.",
    );
    const unsupportedUrlResponse = await nodeFetch(
      `${baseUrl}/api/rpc/generate-theme-from-url`,
      {
        method: "POST",
        headers: rpcHeaders(),
        body: JSON.stringify({
          url: "https://example.com",
          keywords: "",
          generationMode: "inspired",
          model: "dyad/theme-generator/openai",
        }),
      },
    );
    await expect(unsupportedUrlResponse.json()).resolves.toEqual({
      ok: false,
      error:
        "Website URL theme generation is not available in Local Web mode yet.",
      kind: "precondition",
    });
    expect(unsupportedUrlResponse.status).toBe(409);
    await expect(
      transport.invoke("rename-media-file", {
        appId: 1,
        fileName: "old.png",
        newBaseName: "new",
      }),
    ).resolves.toBeUndefined();
    await expect(
      transport.invoke("terminal:open", { appId: 1, cols: 80, rows: 24 }),
    ).resolves.toMatchObject({ sessionId: "term-1", created: true });
    await expect(
      transport.invoke("terminal:write", { sessionId: "term-1", data: "ls\n" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      transport.invoke("terminal:resize", {
        sessionId: "term-1",
        cols: 100,
        rows: 30,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      transport.invoke("terminal:serialize", { sessionId: "term-1" }),
    ).resolves.toEqual({ scrollback: "ready\n", scrollbackEndOffset: 6 });
    await expect(
      transport.invoke("terminal:close", { sessionId: "term-1" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      transport.invoke("terminal:kill", { sessionId: "term-1" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      transport.invoke("select-app-folder", undefined),
    ).resolves.toEqual({ path: null, name: null });
    await expect(transport.invoke("select-app-location", {})).resolves.toEqual({
      path: null,
      canceled: true,
    });

    expect(service.createApp).toHaveBeenCalledWith({ name: "new-app" });
    expect(service.addLog).toHaveBeenCalledWith({
      level: "info",
      type: "server",
      message: "Connecting to app...",
      appId: 1,
      timestamp: now.getTime(),
    });
    expect(service.clearLogs).toHaveBeenCalledWith(1);
    expect(service.renameApp).toHaveBeenCalledOnce();
    expect(service.runApp).toHaveBeenCalledOnce();
    expect(service.getRunningAppPreview).toHaveBeenCalledWith({ appId: 1 });
    expect(service.openTerminal).toHaveBeenCalledOnce();
    expect(service.createPrompt).toHaveBeenCalledOnce();
    expect(service.createAppCollection).toHaveBeenCalledOnce();
    expect(service.createCustomTheme).toHaveBeenCalledOnce();
    expect(service.saveThemeImage).toHaveBeenCalledOnce();
    expect(service.generateThemePrompt).toHaveBeenCalledOnce();
    expect(service.cleanupThemeImages).toHaveBeenCalledOnce();
    expect(service.generateThemeFromUrl).toHaveBeenCalledTimes(2);
    expect(service.renameMediaFile).toHaveBeenCalledOnce();
  });

  it("serves Local Web visual editing over authenticated HTTP using local app files", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-local-web-visual-rpc-"),
    );
    try {
      configureDatabaseUserDataPath(tempDir);
      initializeDatabase();
      const settingsStore = createLocalWebSettingsStore({
        userDataPath: tempDir,
      });
      const pathResolver = createLocalWebPathResolver({
        userDataPath: tempDir,
        settingsStore,
      });
      const appPath = pathResolver.getDyadAppPath("visual-rpc-app");
      await fs.promises.mkdir(path.join(appPath, "src"), { recursive: true });
      await fs.promises.writeFile(
        path.join(appPath, "src", "App.tsx"),
        [
          "export function App() {",
          '  return <section className="p-[4px]">RPC copy</section>;',
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      const appId = Number(
        db
          .insert(apps)
          .values({ name: "Visual RPC App", path: "visual-rpc-app" })
          .run().lastInsertRowid,
      );
      const integrationService = createDefaultLocalWebIntegrationService({
        settingsStore,
        pathResolver,
      });
      await startRegistryServer(
        createService({
          applyVisualEditingChanges:
            integrationService.applyVisualEditingChanges!,
          analyzeComponent: integrationService.analyzeComponent!,
        }),
      );
      const transport = createTransport(baseUrl);

      await expect(
        transport.invoke("analyze-component", {
          appId,
          componentId: "src/App.tsx:2",
        }),
      ).resolves.toMatchObject({
        isDynamic: false,
        hasStaticText: true,
        hasImage: false,
      });
      await expect(
        transport.invoke("apply-visual-editing-changes", {
          appId,
          changes: [
            {
              componentId: "src/App.tsx:2",
              componentName: "section",
              relativePath: "src/App.tsx",
              lineNumber: 2,
              styles: {
                padding: { left: "20px", right: "20px" },
              },
              textContent: "RPC edited copy",
            },
          ],
        }),
      ).resolves.toBeUndefined();

      await expect(
        fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
      ).resolves.toContain("RPC edited copy");
      await expect(
        fs.promises.readFile(path.join(appPath, "src", "App.tsx"), "utf-8"),
      ).resolves.toContain("px-[20px]");
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects auth failures with a structured error envelope", async () => {
    await startRegistryServer();

    const response = await nodeFetch(`${baseUrl}/api/rpc/get-app`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify(1),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Invalid local RPC token",
      kind: "auth",
    });
    expect(response.status).toBe(401);
  });

  it("rejects validation failures with a structured error envelope", async () => {
    await startRegistryServer();

    const response = await nodeFetch(`${baseUrl}/api/rpc/get-app`, {
      method: "POST",
      headers: rpcHeaders(),
      body: JSON.stringify("not-a-number"),
    });

    const body = (await response.json()) as {
      ok: false;
      error: string;
      kind: string;
    };
    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("[get-app] Invalid input");
    expect(body.kind).toBe("validation");
  });

  it("maps service not-found failures to structured 404 envelopes", async () => {
    service = createService({
      getApp: vi.fn(async () => {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }),
    });
    await startRegistryServer(service);

    const response = await nodeFetch(`${baseUrl}/api/rpc/get-app`, {
      method: "POST",
      headers: rpcHeaders(),
      body: JSON.stringify(404),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "App not found",
      kind: "not_found",
    });
    expect(response.status).toBe(404);
  });

  it("fails closed for unsupported endpoints", async () => {
    await startRegistryServer();

    const response = await nodeFetch(`${baseUrl}/api/rpc/app%3Ascreenshot`, {
      method: "POST",
      headers: rpcHeaders(),
      body: JSON.stringify({ appId: 1 }),
    });

    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "No local RPC handler registered for app:screenshot",
      kind: "not_found",
    });
    expect(response.status).toBe(404);
  });

  async function startRegistryServer(
    serviceOverride: LocalWebRpcService = createService(),
    events?: ReturnType<typeof createLocalEventStream>,
  ) {
    service = serviceOverride;
    activeEvents = events;
    server = createLocalRpcServer({
      token: "local-token",
      allowedOrigins: [origin],
      routes: events?.routes,
    });
    await registerLocalWebRpcHandlers(server, service, { events });
    const listening = await server.listen();
    baseUrl = listening.url;
  }
});

function createTransport(baseUrl: string) {
  return createHttpInvokeTransport({
    baseUrl,
    token: "local-token",
    fetch: nodeFetch,
    headers: { origin },
  });
}

function createService(
  overrides: Partial<LocalWebRpcService> = {},
): LocalWebRpcService {
  const service = {
    getSettings: vi.fn(() => ({
      selectedModel: { provider: "auto" as const, name: "auto" },
      providerSettings: {},
      selectedTemplateId: "react",
      enableAutoUpdate: true,
      releaseChannel: "stable" as const,
    })),
    setSettings: vi.fn(() => ({
      selectedModel: { provider: "auto" as const, name: "auto" },
      providerSettings: {},
      selectedTemplateId: "react",
      enableAutoUpdate: true,
      releaseChannel: "stable" as const,
      zoomLevel: "110" as const,
    })),
    getEnvVars: vi.fn(async () => ({ OPENAI_API_KEY: "configured" })),
    getSystemPlatform: vi.fn(() => "darwin"),
    getInitialLoadTelemetryContext: vi.fn(() => ({ isFirstSession: false })),
    getSystemDebugInfo: vi.fn(async () => ({
      nodeVersion: "v24.0.0",
      pnpmVersion: null,
      nodePath: process.execPath,
      telemetryId: "telemetry",
      telemetryConsent: "unset",
      telemetryUrl: "https://us.i.posthog.com",
      dyadVersion: "1.3.0",
      platform: "darwin",
      architecture: "arm64",
      logs: "",
      selectedLanguageModel: "auto:auto",
    })),
    getAppVersion: vi.fn(() => ({ version: "1.3.0" })),
    getNodejsStatus: vi.fn(async () => ({
      nodeVersion: "v24.0.0",
      pnpmVersion: null,
      nodeDownloadUrl: "https://nodejs.org",
    })),
    installPnpm: vi.fn(async () => ({
      pnpmVersion: "11.1.2",
    })),
    getCustomAppsFolder: vi.fn(() => ({
      path: "/apps",
      isPathAvailable: true,
      isPathDefault: true,
    })),
    getUserBudget: vi.fn(async () => null),
    getApp: vi.fn(async () => createApp()),
    listApps: vi.fn(async () => ({ apps: [createListedApp()] })),
    searchApps: vi.fn(async () => [
      {
        id: 1,
        name: "Test App",
        createdAt: now,
        matchedChatTitle: null,
        matchedChatMessage: null,
      },
    ]),
    listAppScreenshots: vi.fn(async () => ({ screenshots: [] })),
    listAppThumbnails: vi.fn(async () => ({
      thumbnails: [{ appId: 1, thumbnailUrl: null }],
    })),
    getChat: vi.fn(async () => createChat()),
    getChats: vi.fn(async () => [
      {
        id: 7,
        appId: 1,
        title: "Chat",
        createdAt: now,
        chatMode: "build" as const,
      },
    ]),
    getChatMetadata: vi.fn(async () => ({
      id: 7,
      appId: 1,
      title: "Chat",
      createdAt: now,
      chatMode: "build" as const,
    })),
    startChatStream: vi.fn(async (event, params) => {
      event.sender.send("chat:response:chunk", {
        chatId: params.chatId,
        messages: [{ id: 11, role: "assistant", content: "hello web" }],
      });
      event.sender.send("agent-tool:consent-request", {
        requestId: "consent-1",
        chatId: params.chatId,
        toolName: "write_file",
        toolDescription: "Write a file",
        inputPreview: "src/App.tsx",
      });
      event.sender.send("agent-tool:todos-update", {
        chatId: params.chatId,
        todos: [
          {
            id: "todo-1",
            content: "Check Web event bridge",
            status: "in_progress",
          },
        ],
      });
      event.sender.send("agent-tool:problems-update", {
        appId: 1,
        problems: {
          problems: [
            {
              file: "src/App.tsx",
              line: 1,
              column: 7,
              message: "Type mismatch",
              code: 2322,
              snippet: "const value: string = 1;",
            },
          ],
        },
      });
      event.sender.send("plan:update", {
        chatId: params.chatId,
        title: "Web Plan",
        summary: "Verify event bridge",
        plan: "## Verify",
      });
      event.sender.send("plan:questionnaire", {
        chatId: params.chatId,
        requestId: "question-1",
        questions: [
          {
            id: "scope",
            type: "text",
            question: "What should Web verify?",
            required: true,
          },
        ],
      });
      event.sender.send("integration:prompt", {
        chatId: params.chatId,
        requestId: "integration-1",
        provider: "supabase",
      });
      event.sender.send("app-blueprint:update", {
        chatId: params.chatId,
        data: {
          appName: "Test App",
          userPrompt: "Build a Web app",
          attachments: [],
          templateId: "react",
          themeId: "default",
          designDirection: "Focused",
          primaryColor: "#2563eb",
          visuals: [],
        },
      });
      return params.chatId;
    }),
    cancelChatStream: vi.fn(async () => true),
    acknowledgeChatResponse: vi.fn(() => undefined),
    countTokens: vi.fn(async () => ({
      estimatedTotalTokens: 42,
      actualMaxTokens: null,
      messageHistoryTokens: 10,
      codebaseTokens: 11,
      mentionedAppsTokens: 0,
      inputTokens: 5,
      systemPromptTokens: 16,
      contextWindow: 100_000,
    })),
    getProposal: vi.fn(async () => ({
      chatId: 7,
      messageId: 11,
      proposal: {
        type: "tip-proposal" as const,
        title: "Tip",
        description: "Try it",
      },
    })),
    approveProposal: vi.fn(async () => ({ success: true })),
    rejectProposal: vi.fn(async () => undefined),
    getAgentTools: vi.fn(async () => []),
    setAgentConsent: vi.fn(async () => undefined),
    respondToAgentConsent: vi.fn(async () => undefined),
    startHelpChat: vi.fn(async () => ({ ok: true as const })),
    cancelHelpChat: vi.fn(async () => ({ ok: true as const })),
    createPlan: vi.fn(async () => "plan-1"),
    getPlan: vi.fn(async () => createPlan()),
    getPlanForChat: vi.fn(async () => createPlan()),
    updatePlan: vi.fn(async () => undefined),
    deletePlan: vi.fn(async () => undefined),
    respondToQuestionnaire: vi.fn(() => undefined),
    respondToIntegration: vi.fn(() => undefined),
    approveAppBlueprint: vi.fn(async (event, params) => {
      event.sender.send("app-blueprint:approved", { chatId: params.chatId });
    }),
    editAppBlueprintField: vi.fn(() => undefined),
    editAppBlueprintVisual: vi.fn(() => undefined),
    addAppBlueprintVisual: vi.fn(() => ({ visualId: "visual-1" })),
    removeAppBlueprintVisual: vi.fn(() => undefined),
    getTemplates: vi.fn(async () => [
      {
        id: "react",
        title: "React.js Template",
        description: "React template",
        imageUrl: "https://example.com/template.png",
        isOfficial: true,
      },
    ]),
    applyAppTemplate: vi.fn(async () => ({
      applied: true,
      needsRestart: false,
    })),
    getThemes: vi.fn(async () => [
      {
        id: "default",
        name: "Default Theme",
        description: "Default",
        icon: "palette",
        prompt: "<theme></theme>",
      },
    ]),
    getCustomThemes: vi.fn(async () => []),
    getThemeGenerationModelOptions: vi.fn(async () => [
      { id: "dyad/theme-generator/openai", label: "OpenAI" },
    ]),
    saveThemeImage: vi.fn(async () => ({ path: "/tmp/reference.png" })),
    cleanupThemeImages: vi.fn(async () => undefined),
    generateThemePrompt: vi.fn(async () => ({
      prompt: "<theme>generated</theme>",
    })),
    generateThemeFromUrl: vi.fn(async () => {
      throw new DyadError(
        "Website URL theme generation is not available in Local Web mode yet.",
        DyadErrorKind.Precondition,
      );
    }),
    getAppTheme: vi.fn(async () => null),
    listPrompts: vi.fn(async () => []),
    listAppCollections: vi.fn(async () => []),
    getLanguageModelProviders: vi.fn(async () => [
      { id: "openai", name: "OpenAI", type: "cloud" as const },
    ]),
    getLanguageModels: vi.fn(async () => [
      { apiName: "gpt-5", displayName: "GPT 5", type: "cloud" as const },
    ]),
    getLanguageModelsByProviders: vi.fn(async () => ({
      openai: [
        { apiName: "gpt-5", displayName: "GPT 5", type: "cloud" as const },
      ],
    })),
    getFreeAgentQuotaStatus: vi.fn(async () => ({
      messagesUsed: 0,
      messagesLimit: 5,
      isQuotaExceeded: false,
      windowStartTime: null,
      resetTime: null,
      hoursUntilReset: null,
    })),
    getAppEnvVars: vi.fn(async () => [{ key: "VITE_FLAG", value: "true" }]),
    setAppEnvVars: vi.fn(async () => undefined),
    createApp: vi.fn(async () => ({
      app: { ...createListedApp(), id: 2, name: "New App" },
      chatId: 8,
    })),
    deleteApp: vi.fn(async () => undefined),
    deleteApps: vi.fn(async () => ({
      results: [{ appId: 1, success: true }],
    })),
    copyApp: vi.fn(async () => ({
      app: { ...createListedApp(), id: 2, name: "Copied App" },
    })),
    renameApp: vi.fn(async () => undefined),
    runApp: vi.fn(async () => undefined),
    stopApp: vi.fn(async () => undefined),
    restartApp: vi.fn(async () => undefined),
    getRunningAppPreview: vi.fn(async () => ({
      appId: 1,
      appUrl: "http://localhost:42101",
      originalUrl: "http://localhost:32101",
      mode: "host" as const,
    })),
    respondToAppInput: vi.fn(async () => undefined),
    selectAppForPreview: vi.fn(async () => undefined),
    editAppFile: vi.fn(async () => ({})),
    readAppFile: vi.fn(async () => "export default function App() {}"),
    searchAppFiles: vi.fn(async () => []),
    changeAppLocation: vi.fn(async () => ({ resolvedPath: "/apps/test-app" })),
    toggleFavorite: vi.fn(async () => ({ isFavorite: true })),
    selectAppLocation: vi.fn(() => ({ path: null, canceled: true })),
    checkAppName: vi.fn(async () => ({ exists: false })),
    updateAppCommands: vi.fn(async () => undefined),
    selectAppFolder: vi.fn(() => ({ path: null, name: null })),
    createChat: vi.fn(async () => 8),
    updateChat: vi.fn(async () => undefined),
    deleteChat: vi.fn(async () => undefined),
    deleteMessages: vi.fn(async () => undefined),
    searchChats: vi.fn(async () => []),
    importApp: vi.fn(async () => ({ appId: 1, chatId: 8 })),
    checkAiRules: vi.fn(async () => ({ exists: false })),
    getContextPaths: vi.fn(async () => ({
      contextPaths: [],
      smartContextAutoIncludes: [],
      excludePaths: [],
    })),
    setContextPaths: vi.fn(async () => undefined),
    createPrompt: vi.fn(async () => ({
      id: 1,
      title: "Prompt",
      description: null,
      content: "Use this",
      slug: null,
      createdAt: now,
      updatedAt: now,
    })),
    updatePrompt: vi.fn(async () => undefined),
    deletePrompt: vi.fn(async () => undefined),
    createAppCollection: vi.fn(async () => ({
      id: 1,
      name: "Favorites",
      appIds: [1],
      createdAt: now,
      updatedAt: now,
    })),
    updateAppCollection: vi.fn(async () => undefined),
    deleteAppCollection: vi.fn(async () => undefined),
    assignApps: vi.fn(async () => undefined),
    setAppTheme: vi.fn(async () => undefined),
    createCustomTheme: vi.fn(async () => ({
      id: 1,
      name: "Theme",
      description: null,
      prompt: "<theme></theme>",
      createdAt: now,
      updatedAt: now,
    })),
    updateCustomTheme: vi.fn(async () => ({
      id: 1,
      name: "Theme",
      description: null,
      prompt: "<theme></theme>",
      createdAt: now,
      updatedAt: now,
    })),
    deleteCustomTheme: vi.fn(async () => undefined),
    renameMediaFile: vi.fn(async () => undefined),
    deleteMediaFile: vi.fn(async () => undefined),
    moveMediaFile: vi.fn(async () => undefined),
    openTerminal: vi.fn(async () => ({
      sessionId: "term-1",
      shell: "/bin/zsh",
      cwd: "/apps/test-app",
      appName: "Test App",
      scrollback: "",
      created: true,
    })),
    closeTerminal: vi.fn(async () => ({ ok: true as const })),
    killTerminal: vi.fn(async () => ({ ok: true as const })),
    writeTerminal: vi.fn(async () => ({ ok: true as const })),
    resizeTerminal: vi.fn(async () => ({ ok: true as const })),
    serializeTerminal: vi.fn(async () => ({
      scrollback: "ready\n",
      scrollbackEndOffset: 6,
    })),
    listAllMedia: vi.fn(async () => ({ apps: [] })),
    listVersions: vi.fn(async () => []),
    getCurrentCommitHash: vi.fn(async () => ({ commitHash: null })),
    saveAppScreenshot: vi.fn(async () => undefined),
    getCurrentBranch: vi.fn(async () => ({ branch: "main" })),
    revertVersion: vi.fn(async () => ({ successMessage: "Restored version" })),
    checkoutVersion: vi.fn(async () => undefined),
    checkProblems: vi.fn(async () => ({ problems: [] })),
    addLog: vi.fn(() => undefined),
    clearLogs: vi.fn(() => undefined),
    listMcpServers: vi.fn(async () => []),
    listMcpToolConsents: vi.fn(async () => []),
    listMcpTools: vi.fn(async () => ({ tools: [], status: "error" as const })),
    isMcpOauthStorageEncrypted: vi.fn(async () => ({ available: false })),
    probeMcpCallbackPort: vi.fn(async () => ({ port: 53682 })),
    rendererErrorToastReady: vi.fn(() => undefined),
  } as unknown as LocalWebRpcService;
  return Object.assign(service, overrides);
}

function rpcHeaders(): Record<string, string> {
  return {
    authorization: "Bearer local-token",
    "content-type": "application/json",
    origin,
  };
}

function createApp() {
  return {
    id: 1,
    name: "Test App",
    path: "test-app",
    createdAt: now,
    updatedAt: now,
    githubOrg: null,
    githubRepo: null,
    githubBranch: null,
    supabaseProjectId: null,
    supabaseParentProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonDevelopmentBranchId: null,
    neonPreviewBranchId: null,
    neonActiveBranchId: null,
    neonProductionAuthCookieSecret: null,
    neonDevelopmentAuthCookieSecret: null,
    selectedDatabaseBranchType: null,
    vercelProjectId: null,
    vercelProjectName: null,
    vercelDeploymentUrl: null,
    vercelTeamId: null,
    installCommand: null,
    startCommand: null,
    chatContext: null,
    isFavorite: false,
    themeId: null,
    needsAppBlueprint: false,
    collectionId: null,
    files: ["src/App.tsx"],
    frameworkType: "vite" as const,
    resolvedPath: "/apps/test-app",
    supabaseProjectName: null,
    vercelTeamSlug: null,
  };
}

function createListedApp() {
  const { files, frameworkType, supabaseProjectName, vercelTeamSlug, ...app } =
    createApp();
  void files;
  void frameworkType;
  void supabaseProjectName;
  void vercelTeamSlug;
  return app;
}

function createChat() {
  return {
    id: 7,
    appId: 1,
    title: "Chat",
    initialCommitHash: null,
    dbTimestamp: null,
    chatMode: "build" as const,
    messages: [
      {
        id: 10,
        role: "user" as const,
        content: "hello",
        approvalState: null,
        commitHash: null,
        sourceCommitHash: null,
        dbTimestamp: null,
        createdAt: now,
        requestId: null,
        totalTokens: null,
        model: null,
      },
    ],
  };
}

function createPlan() {
  return {
    id: "plan-1",
    appId: 1,
    chatId: 7,
    title: "Plan",
    summary: null,
    content: "Do it",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

async function nodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  const body =
    typeof init?.body === "string" || init?.body instanceof Buffer
      ? init.body
      : undefined;

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: init?.headers as http.OutgoingHttpHeaders | undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage,
              headers: response.headers as HeadersInit,
            }),
          );
        });
      },
    );
    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function streamingNodeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input.toString());
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: {
          origin,
          ...(init?.headers as http.OutgoingHttpHeaders | undefined),
        },
      },
      (response) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on("data", (chunk: Buffer | string) => {
              controller.enqueue(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
              );
            });
            response.on("end", () => controller.close());
            response.on("error", (error) => controller.error(error));
          },
          cancel() {
            request.destroy();
          },
        });
        resolve(
          new Response(body, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers: response.headers as HeadersInit,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
