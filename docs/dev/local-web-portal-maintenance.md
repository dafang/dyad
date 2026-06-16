---
doc_type: dev-guide
slug: local-web-portal-maintenance
component: local-web-portal
status: current
summary: How to maintain the customized local Web Portal while upstream Bzyai continues to ship Electron-first changes.
tags:
  - web
  - electron
  - ipc
  - local-runtime
  - maintenance
last_reviewed: 2026-06-12
---

# Local Web Portal Maintenance

## Overview

This guide is for maintainers of the customized Bzyai Web UI. Upstream Bzyai is
still Electron-first: new product work usually lands as renderer changes plus
Electron IPC handlers. The customized Web version keeps the same React renderer,
but swaps the host boundary from Electron IPC to a browser page talking to a
loopback Node HTTP server.

Use this guide when rebasing or merging a newer official Bzyai release into this
Web branch. It summarizes the Web-specific changes that must be preserved and
the steps required to expose new upstream Electron capabilities in Web mode.

## Current Web Architecture

The current Web edition is a local Web Portal, not the cloud-hosted product.
The browser loads the normal Bzyai renderer and calls a Bzyai-owned local server
on the same machine.

The main runtime path is:

1. `scripts/start-local-web-dev.ts` starts a Vite page server and
   `startLocalWebRuntime`.
2. `startLocalWebRuntime` initializes local Web settings, SQLite, path
   resolution, media routes, preview proxy routes, stream routes, event routes,
   and the RPC registry.
3. `src/lib/runtime_client.ts` selects Electron transport or local Web
   transport.
4. Local Web invoke calls go through `POST /api/rpc/:channel`.
5. Push events and stream updates go through `/api/events` or invoke-stream
   forwarding.
6. Runtime and preview operations are served by local Web services that wrap the
   existing Bzyai app runtime, process, git, preview, terminal, and workflow
   code.

Electron desktop remains IPC-first. Do not convert desktop to the local HTTP
server as part of Web maintenance.

## Web-Specific Change Map

### Browser Entrypoint

- `web.html` is the Web page shell.
- `vite.web.config.mts` defines browser-mode build/runtime globals.
- `scripts/start-local-web-dev.ts` starts the local Web dev server, injects
  `globalThis.__DYAD_LOCAL_WEB_CONFIG__`, writes a config file, supports
  `DYAD_LOCAL_WEB_PUBLIC_BASE_URL`, and proxies preview/API requests when the
  UI is accessed through a public tunnel.
- `package.json` exposes `npm run dev:web` and `npm run dev:local-web`.

### Runtime Client And Transport

- `src/ipc/contracts/core.ts` contains the transport abstraction and
  `createHttpInvokeTransport`.
- `src/lib/local_web_transport.ts` reads local Web bootstrap config, creates the
  HTTP invoke transport, creates SSE/WebSocket event transports, and maps public
  URLs for browser use.
- `src/lib/runtime_client.ts` is the single renderer entrypoint for IPC clients.
  Components should use the exported runtime IPC object instead of directly
  assuming `window.electron`.

### Local Server Boundary

- `src/server/local_rpc_server.ts` owns loopback HTTP RPC, Origin/CORS checks,
  bearer-token auth, request body limits, typed contract validation, and
  structured error envelopes.
- `src/server/local_server.ts` owns local server lifecycle and per-process token
  generation.
- `src/server/local_event_stream.ts` owns authenticated SSE/WebSocket push
  events. Its `/api/events` route may accept same-origin requests with no
  `Origin` header, but still requires the bearer token.
- `src/server/local_web_runtime.ts` composes the local Web runtime and cleans up
  process-wide local Web overrides on close.

### RPC Registry And Services

- `src/server/local_web_rpc_registry.ts` is the Web RPC allowlist and
  registration point. A channel is not available in Web mode until it is in
  `LOCAL_WEB_RPC_ALLOWLIST` and registered with a typed handler.
- `src/ipc/services/local_web_core_service.ts`,
  `src/ipc/services/default_local_web_core_service.ts`,
  `src/ipc/services/local_web_mutation_service.ts`,
  `src/ipc/services/default_local_web_mutation_service.ts`,
  `src/ipc/services/local_web_runtime_service.ts`, and
  `src/ipc/services/default_local_web_integration_service.ts` provide
  browser-safe service implementations.
- Some existing Electron handlers now export reusable handler functions so both
  Electron IPC and local Web RPC can call the same logic. Recent examples are
  `revertVersionHandler` and `checkoutVersionHandler` in
  `src/ipc/handlers/version_handlers.ts`.

### Data, Settings, Paths, And Secrets

- Local Web uses a per-user local data directory under the local Web path
  resolver. SQLite remains local and per user/tenant.
- `src/server/local_web_settings.ts` stores Node-safe settings. In local Web
  mode, `src/main/settings.ts` is configured with this store so code paths that
  call `readSettings` do not require Electron `safeStorage`.
- `src/server/local_web_paths.ts` and the path-resolution hooks in
  `src/paths/paths.ts` ensure app paths and TypeScript cache paths resolve for
  the local Web runtime.
- `src/ipc/utils/read_env.ts` reads environment variables differently when the
  runtime context is local Web.

### Preview, Media, And Terminal

- `src/server/local_web_preview_proxy.ts` exposes preview proxy routes under the
  local Web server.
- `src/server/local_web_media_routes.ts` exposes screenshots and media through
  local Web-safe URLs.
- `src/ipc/services/local_web_runtime_service.ts` wraps app run/stop/restart,
  preview selection, input responses, terminal sessions, and terminal output for
  Web callers.
- Renderer callers use `toLocalWebPublicUrl` when a local API URL must become a
  browser-visible public tunnel URL.

### Chat, Agent, Plans, Blueprint, And Streaming

- `chat:stream` is registered as a local Web stream-capable RPC. Stream events
  are bridged through `createLocalWebIpcEvent` and event transports so the
  renderer receives the same `chat:response:*` semantics it receives in
  Electron.
- Proposal, plan, questionnaire, integration, app blueprint, agent tool consent,
  and help-chat endpoints are registered in `local_web_rpc_registry`.
- `src/hooks/useStreamChat.ts`, `src/hooks/usePlanEvents.ts`,
  `src/hooks/useAppBlueprintEvents.ts`, and related hooks should stay
  transport-neutral.

### Host Capability Fallbacks

- `src/lib/web_host_capabilities.ts` and
  `src/server/local_web_host_capabilities.ts` provide browser-safe behavior for
  desktop-only operations.
- Browser mode hides Electron window chrome and avoids direct use of Electron
  APIs.
- Unsupported OS operations should fail visibly and intentionally, not by
  surfacing missing Electron IPC.

### Provider And Model Configuration

- OpenAI-compatible providers must preserve custom `baseURL` handling and
  `store: false` provider options.
- `OPENAI_BASE_URL` support and custom provider base URL normalization live in
  `src/ipc/utils/get_model_client.ts`.
- Provider options that affect model requests live in
  `src/ipc/utils/provider_options.ts`.
- Model constants, including custom large-context models such as `gpt-5.5`, live
  in `src/ipc/shared/language_model_constants.ts`.

## Upstream Sync Workflow

Follow this process when official Bzyai publishes a new Electron-first version
and you need to bring it into the Web branch.

### 1. Prepare The Merge

1. Record the upstream version or commit range being merged.
2. Save the current local Web smoke command and tunnel command if a public test
   URL is running.
3. Check the working tree and separate unrelated local edits from Web
   maintenance edits.
4. Read upstream release notes or PR summaries for IPC, chat, preview,
   settings, model-provider, and runtime changes.

### 2. Merge Or Rebase

Merge upstream normally, but treat these files as Web conflict hotspots:

- `src/ipc/contracts/core.ts`
- `src/ipc/types/**`
- `src/ipc/handlers/**`
- `src/ipc/ipc_host.ts`
- `src/ipc/preload/channels.ts`
- `src/lib/runtime_client.ts`
- `src/lib/local_web_transport.ts`
- `src/server/local_web_rpc_registry.ts`
- `src/server/local_web_runtime.ts`
- `src/ipc/services/**local_web**`
- `src/main/settings.ts`
- `src/paths/paths.ts`
- `src/ipc/services/app_runtime_service.ts`
- `src/ipc/utils/get_model_client.ts`
- `src/ipc/utils/provider_options.ts`
- `src/components/preview_panel/**`
- `src/hooks/useRunApp.ts`
- `src/hooks/useStreamChat.ts`
- `scripts/start-local-web-dev.ts`
- `vite.web.config.mts`
- `web.html`

When a conflict touches a renderer component, prefer preserving upstream UI and
keeping Web behavior behind runtime/host capability helpers. Avoid copying a
component just for Web mode.

### 3. Rebuild The Web RPC Surface

After any upstream IPC contract or handler change:

1. Run `node scripts/audit-web-parity.mjs`.
2. Inspect new or changed contracts in `src/ipc/types/**`.
3. Decide whether the new channel is:
   - already supported by an existing local Web service;
   - a browser-safe fallback;
   - Electron-only and intentionally unsupported;
   - a new service extraction task.
4. If supported, add it to `LOCAL_WEB_RPC_ALLOWLIST`.
5. Register it in `registerLocalWebRpcHandlers`.
6. Add or update the service method and default implementation.
7. Add registry tests that call the channel through HTTP.
8. If the Electron handler contains reusable business logic, extract a pure
   handler function and have both Electron IPC and local Web RPC call it.

Do not expose a new channel just because it exists in Electron. Web exposure
must be deliberate and covered by a test.

### 4. Reconcile Events And Streams

For new upstream events or stream channels:

1. Add them to the runtime client event tree if not already present.
2. Bridge them through `createLocalWebIpcEvent` or stream routes.
3. Confirm event subscriptions work over `/api/events`.
4. Verify stream calls produce incremental events, not only a final full
   refresh, unless the upstream contract intentionally changed.

For chat specifically, validate `chat:stream`, `chat:response:chunk`,
`chat:response:end`, `chat:response:error`, proposal events, plan events,
integration prompts, app blueprint events, and agent tool consent events.

### 5. Reconcile Runtime And Preview

Upstream often changes app runtime behavior in Electron. For each change:

1. Check whether it affects app install, dependency add, run, stop, restart,
   rebuild, preview proxy, terminal, logs, typecheck, or screenshot/media.
2. Update `LocalWebRuntimeService` or default local Web services if the same
   behavior must exist in Web mode.
3. Confirm public tunnel mode still works with
   `DYAD_LOCAL_WEB_PUBLIC_BASE_URL`.
4. Confirm preview URLs returned by RPC are converted through
   `toLocalWebPublicUrl` before browser display.
5. Confirm `/api/preview/**` and preview iframe document routing are still
   proxied by `scripts/start-local-web-dev.ts`.

### 6. Reconcile Settings, Secrets, And Providers

For upstream settings or provider changes:

1. Add defaults to local Web settings if the upstream setting is user-visible.
2. Confirm `readSettings` and `writeSettings` still work without Electron
   `safeStorage` in local Web mode.
3. Keep API keys out of documentation and committed files.
4. Re-test OpenAI-compatible providers with custom base URLs.
5. Preserve `store: false` for OpenAI/OpenAI-compatible requests where the
   provider supports it.

### 7. Re-run The Web Smoke Matrix

Run the checks in the verification section before handing a merged Web branch
to users.

## Adding A New Upstream IPC Feature To Web

Use this checklist when upstream adds or changes a feature that works in
Electron through IPC.

1. Find the contract in `src/ipc/types/**`.
2. Find the Electron handler in `src/ipc/handlers/**`.
3. Check whether the handler imports Electron APIs, local files, child
   processes, settings, paths, or runtime state.
4. Extract reusable logic into a service or exported handler function when
   possible.
5. Add a method to the relevant local Web service interface.
6. Implement the method in the default local Web service.
7. Add the channel to `LOCAL_WEB_RPC_ALLOWLIST`.
8. Register the channel in `registerLocalWebRpcHandlers`.
9. Add an HTTP registry test with realistic input and output.
10. Add service tests for path/settings/runtime side effects.
11. Verify the renderer can call the feature through `runtime_client`.
12. Dogfood the UI path in a browser, not only with unit tests.

## Verification

### Static Checks

Run these after a non-trivial upstream sync:

```sh
node scripts/audit-web-parity.mjs
npm run ts
npm test -- \
  src/ipc/contracts/core.test.ts \
  src/lib/runtime_client.test.ts \
  src/lib/local_web_transport.test.ts \
  src/server/local_rpc_server.test.ts \
  src/server/local_server.test.ts \
  src/server/local_event_stream.test.ts \
  src/server/local_web_stream_routes.test.ts \
  src/server/local_web_rpc_registry.test.ts \
  src/server/local_web_integration_registry.test.ts \
  src/ipc/services/local_web_core_service.test.ts \
  src/ipc/services/local_web_mutation_service.test.ts \
  src/ipc/services/local_web_runtime_service.test.ts
```

Run broader checks when the merge touched shared renderer, contracts, model
providers, or runtime code:

```sh
npm run lint
npm run build
```

### Local Web Startup

Start local Web:

```sh
npm run dev:web
```

For public tunnel testing, start with a public base URL:

```sh
DYAD_LOCAL_WEB_PUBLIC_BASE_URL=https://your-tunnel.example \
DYAD_LOCAL_WEB_TOKEN=dyad-local-web-test-token-32-bytes-minimum \
DYAD_LOCAL_WEB_CONFIG_PATH=/tmp/dyad-local-web-config.json \
./node_modules/.bin/vite-node --config vite.main.config.mts scripts/start-local-web-dev.ts
```

Then verify:

```sh
curl -i "$BASE/api/rpc/renderer%3Aerror-toast-ready" \
  -X POST \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "origin: $BASE" \
  --data ''

curl -i --max-time 3 "$BASE/api/events?channel=*" \
  -H "accept: text/event-stream" \
  -H "authorization: Bearer $TOKEN"
```

The event request should return `200 text/event-stream` and an initial
`: connected` comment. It will stay open by design.

### Browser Dogfood

Use a real browser session for the final pass. Cover these flows:

- Home loads and can list/create/open apps.
- Settings loads provider settings without Electron-only crashes.
- GPT/OpenAI-compatible chat streams incrementally.
- App blueprint display and approval works.
- Preview starts, reloads, restarts, and survives navigation.
- Problems/typecheck runs and reports useful results.
- Terminal opens and receives output.
- Media/screenshots/thumbnails load through local Web URLs.
- Version list/current branch/revert/checkout work.
- GitHub sync surfaces work for the supported GitHub-only sync path.
- Unsupported desktop-only actions show intentional browser-safe behavior.

Do not use fake model responses for final chat verification; fakes can hide
transport, provider option, and streaming bugs.

## Known Fragile Areas

- `chat:stream` can silently regress from incremental streaming to final-only
  refresh if event forwarding is broken.
- Preview proxy behavior changes easily when upstream changes app runtime,
  service workers, proxy worker scripts, or iframe URL handling.
- Public tunnel mode requires both Vite `allowedHosts` and local Web public URL
  rewriting. Do not special-case one tunnel provider in product logic; keep the
  behavior driven by `DYAD_LOCAL_WEB_PUBLIC_BASE_URL`.
- Browser requests through same-origin proxies may omit `Origin`; auxiliary
  routes that are still bearer-protected may need `requireOrigin: false`.
- Electron handler modules with top-level Electron imports can break local Web
  startup. Move those imports behind adapters or extract pure handler logic.
- Settings and secret code must not assume Electron `safeStorage` in local Web
  mode.
- Local filesystem paths must go through local Web path resolution; do not use
  Electron userData or `~/dyad-apps` assumptions directly.
- Provider additions need real remote smoke tests when possible, especially for
  OpenAI-compatible `baseURL` and provider option behavior.

## Documentation To Keep In Sync

Update these docs when Web architecture or maintenance rules change:

- `docs/local_web_portal.md` for local Web runtime usage and security boundary.
- `docs/web_parity_inventory.md` for parity counts, cluster rules, and
  Electron-only replacement policy.
- This guide for upstream sync and maintenance procedure.
- `.codestable/compound/2026-06-10-decision-local-web-portal-first.md` only if
  the architectural decision changes.
- `.codestable/compound/2026-06-11-local-web-portal-foundation-architecture.md`
  only if the architecture map changes materially.

## Related Documents

- `docs/local_web_portal.md`
- `docs/web_parity_inventory.md`
- `docs/architecture.md`
- `docs/agent_architecture.md`
- `.codestable/compound/2026-06-10-explore-web-portal-migration.md`
- `.codestable/compound/2026-06-10-decision-local-web-portal-first.md`
- `.codestable/compound/2026-06-11-local-web-portal-foundation-architecture.md`
