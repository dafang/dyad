---
name: project_local_web_provider_integrations
description: Local Web provider integration parity notes for GitHub, Supabase, and Neon.
metadata:
  type: project
---

# Local Web Provider Integrations

Dyad Local Web now routes GitHub, Supabase, and Neon provider operations through the same contract-driven IPC surface as Electron, exposed over authenticated local HTTP RPC.

Durable implementation notes:

- GitHub uses `src/ipc/services/github_service.ts` with injected settings, app lookup/create/update, path resolution, fetch, and logger dependencies. Local Web starts GitHub device flow and bridges progress events through `LocalEventStream`.
- Supabase uses `src/ipc/services/supabase_service.ts`. Local Web saves a manual organization access token via `supabase:save-organization-token`, reusing the existing `settings.supabase.organizations` shape. Manual token credentials intentionally use a long expiry and do not depend on Electron OAuth refresh.
- Neon uses `src/ipc/services/neon_service.ts`. Local Web saves a manual API key via `neon:save-api-key`, reusing `settings.neon` so existing Neon API client code can create the real Neon client. Project create/link/unlink, active branch switching, branch env vars, and email/password config share the service used by Electron.
- `src/server/local_web_rpc_registry.ts` must include any new provider contract in `LOCAL_WEB_RPC_ALLOWLIST`, the `LocalWebRpcService` interface, and `registerLocalWebRpcHandlers`.
- Local Web runtime startup configures the global settings store and path providers before deep provider utilities run, so utilities that still call `readSettings()` or `getDyadAppPath()` resolve against the Local Web user data path.
- Browser UI should replace Electron-only OAuth/deep-link affordances with manual credential entry only when `isLocalWebRuntime()` is true. Electron UI keeps OAuth behavior.

Verification notes:

- Focused tests live in `src/ipc/services/default_local_web_integration_service.test.ts` and cover manual credential persistence, missing credential Auth errors, Supabase project listing, Neon project listing/linking/switching/env preview/unlink, and local git operations.
- Registry tests in `src/server/local_web_integration_registry.test.ts` verify allowlisted contracts and authenticated HTTP routing.
- `.supergoal/local-web-provider-smoke.mjs` starts the real Local Web runtime and verifies provider auth gates over HTTP. It only runs real provider listing when explicit environment credentials are present and never prints secret values.
- Large generated `.supergoal` files can break Tailwind/Vite scans. Delete generated repo-state dumps before `npm run build:web` if they grow unexpectedly.
