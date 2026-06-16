# Local Web Portal

This guide documents the local Web Portal. The portal is the Bzyai React UI
running in a browser and talking to a Bzyai-owned loopback HTTP server on the
same machine. Electron desktop remains IPC-first; Web mode selects the HTTP/SSE
transport through the shared runtime client.

## Current Scope

The current local Web runtime exposes:

- health and browser bootstrap metadata on `GET /api/health` and
  `GET /api/config`;
- authenticated contract RPC calls on `POST /api/rpc/:channel`;
- authenticated Server-Sent Events on `GET /api/events?channel=...`;
- an explicit RPC allowlist for shell reads, app/chat mutations, runtime
  preview/terminal streams, chat/agent workflows, and integration surfaces;
- browser-safe host capability fallbacks for desktop-only operations.

Unsupported IPC channels fail closed because they are not registered in the
local Web RPC registry.

## Starting A Local Server

For development, run the complete Web UI:

```sh
npm run dev:web
```

`npm run start:web` is an alias for the same local development launcher.

The launcher starts:

- the browser page server, normally `http://127.0.0.1:5173`;
- the loopback API/SSE server on a random local port unless
  `DYAD_LOCAL_WEB_API_PORT` is set;
- the full React app from `web.html` / `src/renderer.tsx`.

Startup output includes the Web UI URL and API base URL:

```text
Bzyai Web UI is running
Web UI: http://127.0.0.1:5173
API:    http://127.0.0.1:<port>
Token:  generated for this local session
```

The bearer token is generated per process and injected into the served HTML as
`globalThis.__DYAD_LOCAL_WEB_CONFIG__`. The token is intentionally not printed
or returned by `/api/health` or `/api/config`.

The runtime entrypoint is `startLocalWebRuntime` in
`src/server/local_web_runtime.ts`. Lower-level tests can still call
`startLocalServer` directly:

```ts
const server = await startLocalServer({
  allowedOrigins: ["http://localhost:5173"],
  host: "127.0.0.1",
});
```

The returned `server.info` contains:

- `baseUrl`, for example `http://127.0.0.1:49152`;
- a per-process bearer `token`;
- non-secret `config` metadata for browser setup.

The trusted launcher is responsible for passing the token to the browser client,
for example through the development HTML bootstrap above or a future pairing
flow.

Always close the server when the owning process exits:

```ts
await server.close();
```

## Pairing A Browser Client

Browser/local-server mode is selected by `src/lib/local_web_transport.ts`.
Provide either a global config or Vite env values:

```ts
globalThis.__DYAD_LOCAL_WEB_CONFIG__ = {
  mode: "local-web",
  baseUrl: server.info.baseUrl,
  token: server.info.token,
};
```

The client uses `createHttpInvokeTransport` with an `Authorization: Bearer`
header. Missing `baseUrl` or token raises `LocalWebTransportConfigError` and
does not fall back to Electron IPC.

`smokeLocalWebConnection` can verify the local path by calling `/api/health`
and one allowlisted RPC endpoint. Phase smoke scripts under `.supergoal/` start
short-lived local runtimes and are not used by the real Web UI.

## Runtime Operations

Runtime operations are separated from HTTP routing:

- `LocalRuntimeProvider` owns path resolution and command execution policy;
- `LocalRuntimeOperations` owns operation-level read/write/command methods;
- `InMemoryLocalOperationAuditLog` records operation id, type, target,
  decision, timestamp, outcome, and optional error.

State-changing operations such as `writeFile` and `runTypecheck` require an
allowing consent state before the provider is called. Denied operations record a
`skipped` audit entry and do not resolve paths, write files, or spawn commands.

## Local Runtime Bootstrap

The full local Web runtime starts through `startLocalWebRuntime` in
`src/server/local_web_runtime.ts`. It initializes:

- a per-user `userData` directory;
- SQLite migrations and the Drizzle database singleton;
- Node-safe settings through `LocalWebSettingsStore`;
- local Web app path resolution;
- browser-safe host capability fallbacks;
- the local HTTP server plus SSE event stream.

Local Web settings intentionally use `plaintext` secret storage. This keeps the
plain Node server independent from Electron `safeStorage`; existing
`electron-safe-storage` secrets are ignored in local Web mode instead of
crashing. Electron desktop continues to use the existing `safeStorage` behavior
in `src/main/settings.ts`.

Local Web project paths are resolved under the local runtime's `userData`
directory by default (`dyad-apps`), or through `customAppsFolder` when that
setting is present. SQLite remains per local user/tenant at `sqlite.db` in the
same `userData` directory.

## Browser Host Capabilities

Browser mode does not expose Electron window controls. The desktop title bar is
hidden and the app uses normal browser chrome.

Zoom is applied in `src/app/layout.tsx`. Electron uses `webFrame` when present;
local Web applies `document.documentElement.style.zoom`, so the Settings zoom
selector and keyboard shortcuts work in both modes.

Desktop-only host actions are routed through browser-safe fallbacks:

- external HTTPS links open with `window.open(..., "_blank",
"noopener,noreferrer")`;
- local path reveal/open actions show a clear unavailable state because browsers
  cannot reveal arbitrary local paths in the OS file manager;
- screenshot-to-clipboard, restart, and reset-all are unavailable in local Web
  with actionable copy;
- folder selection uses browser file input semantics where useful, but browsers
  cannot grant the local server a stable writable directory path yet. New local
  Web apps therefore use the runtime's default app directory.

These behaviors live in `src/lib/web_host_capabilities.ts` and are covered by
`src/lib/web_host_capabilities.test.ts`.

## Security Checklist

- The local server binds only loopback hosts by default and rejects non-loopback
  host configuration.
- Tokens use at least 32 random bytes and are generated per process unless
  injected by tests.
- Bootstrap routes return metadata but not the raw bearer token.
- RPC and event routes require an allowed `Origin` and bearer token.
- CORS responses are limited to configured origins.
- RPC handlers are registered from an explicit allowlist.
- Local file paths and command working directories go through
  `LocalRuntimeProvider`.
- Commands are allowlisted and executed without a shell.

## Limitations

- Cloud runtime providers.
- Persistent audit storage.
- User-facing pairing UI.
- Stable browser-granted custom apps folder paths.
- OS file reveal/open, desktop restart, and screenshot-to-clipboard in Web mode.
