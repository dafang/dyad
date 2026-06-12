---
type: security-review
topic: local-web-portal
date: 2026-06-11
status: current
---

# Local Web Portal Security Review

## Result

Pass for the local-server MVP scope. The migration exposes only a narrow
loopback HTTP surface, keeps desktop IPC as the default path, and adds an
operation-level audit skeleton before write-capable runtime operations are
exposed through browser-local flows.

## Checklist

- Loopback binding: `LocalRpcServer` defaults to `127.0.0.1` and rejects
  non-loopback host configuration.
- Token generation: `startLocalServer` generates a per-process bearer token
  with at least 32 random bytes unless tests inject a token.
- Token bootstrap: `/api/health` and `/api/config` return non-secret metadata
  and tests assert they do not include the raw token.
- Origin/CORS: RPC and event routes require configured Origins; CORS response
  headers echo only allowed Origins.
- Endpoint allowlist: `local_web_rpc_registry` registers only `get-app` and
  `get-chat`.
- Event transport: `/api/events` requires bearer token and Origin and cleans up
  subscribers on disconnect/unsubscribe.
- Runtime provider: local file paths and command working directories resolve
  through `LocalRuntimeProvider`; commands are allowlisted and executed without
  a shell.
- Operation audit: write-capable runtime operations record operation id, type,
  target, decision, timestamp, and outcome. Denied operations record `skipped`
  and do not call provider/file/process side effects.
- Client config: browser/local mode requires explicit `baseUrl` and token and
  does not silently fall back to Electron IPC.

## Verification

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- `npm test -- src/ipc/contracts/core.test.ts src/server/local_rpc_server.test.ts src/runtime/local_runtime_provider.test.ts src/server/local_server.test.ts src/ipc/services/local_web_core_service.test.ts src/server/local_web_rpc_registry.test.ts src/lib/local_web_transport.test.ts src/server/local_event_stream.test.ts src/runtime/local_runtime_operations.test.ts src/server/local_operation_audit.test.ts`
- `npm run build`
