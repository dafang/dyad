---
type: architecture
topic: local-web-portal-foundation
date: 2026-06-11
status: current
---

# Local Web Portal Foundation Architecture

## Scope

This note records the foundation boundary for the local Web Portal migration. It is intentionally narrower than full Web parity: it covers the reusable transport contract primitives, the local RPC server boundary, and the runtime provider boundary that later service slices must depend on.

## Current Boundaries

- `src/ipc/contracts/core.ts` remains the contract and client primitive layer. Existing Electron clients still default to `createElectronIpcTransport()`, so desktop code can continue to call `createClient`, `createEventClient`, and `createStreamClient` without passing a transport.
- `createHttpInvokeTransport()` is the browser/local-server invoke adapter. It POSTs to `/api/rpc/:channel`, sends the bearer token when configured, accepts `{ ok: true, data }` envelopes, and turns HTTP or envelope failures into thrown errors for the existing client shape.
- `src/server/local_rpc_server.ts` is the local HTTP RPC boundary. It binds only loopback hosts, requires an allowed Origin and bearer token, validates registered handler input/output with the same Zod contract schemas, and maps classified `DyadError` failures to stable HTTP statuses.
- `src/server/local_server.ts` owns the process-local server lifecycle. It generates a per-process high-entropy token, exposes non-secret health/config metadata, and returns the raw token only to the trusted launcher through `server.info`.
- `src/server/local_web_rpc_registry.ts` is the first HTTP service registry. It intentionally exposes only `get-app` and `get-chat`; unsupported IPC channels fail closed until explicitly migrated.
- `src/server/local_event_stream.ts` is the initial browser push boundary. It exposes authenticated SSE event subscriptions for contract events and rejects unsupported stream invoke calls explicitly.
- `src/runtime/runtime_provider.ts` defines local execution capabilities independent of HTTP and Electron. Services should depend on this interface instead of calling `fs`, `child_process`, or Electron APIs directly.
- `src/runtime/local_runtime_provider.ts` is the first runtime implementation. It resolves paths within explicit workspace roots, checks real paths to guard symlink escape, runs allowlisted commands with `shell: false`, and bounds timeout/output size.
- `src/runtime/local_runtime_operations.ts` adds operation-level read/write/command methods above the provider. State-changing operations are audited and require allowing consent before any filesystem or process side effect.
- `src/server/local_operation_audit.ts` is the MVP audit/consent skeleton. It maps existing agent tool consent concepts (`always`, `ask`, `never`, `accept-once`, `accept-always`, `decline`, read-only, plan-only) into operation-level `allowed`/`denied` decisions and records operation id, type, target, decision, timestamp, outcome, and errors.

## Design Rules

- Do not copy Electron IPC handlers into HTTP handlers. Extract pure services, keep IPC wrappers for desktop, and register explicit HTTP allowlist handlers for the local Web Portal.
- Do not route the Electron desktop through the local HTTP server. Desktop remains IPC-first; browser/local-server mode opts into HTTP transport at the client layer.
- Do not let HTTP route code own filesystem/process policy. Route handlers should call services that receive a `RuntimeProvider`.
- Do not treat the local Web Portal as full IPC parity. Every HTTP endpoint must be allowlisted and covered by contract/integration tests before exposure.
- Do not leak local bearer tokens through `/api/health`, `/api/config`, committed config, or client bundles. The trusted launcher owns pairing/token handoff.
- Unsupported events and streams must fail explicitly unless registered through a Web-compatible push transport.

## Verification

Phase 1 focused tests cover:

- transport defaulting and HTTP invoke envelopes in `src/ipc/contracts/core.test.ts`;
- local RPC auth, Origin, input/output validation, and loopback host rejection in `src/server/local_rpc_server.test.ts`;
- runtime path guardrails, command allowlist, no-shell execution, timeout, and output bounding in `src/runtime/local_runtime_provider.test.ts`.
- lifecycle/token/bootstrap behavior in `src/server/local_server.test.ts`;
- shared app/chat service extraction in `src/ipc/services/local_web_core_service.test.ts`;
- HTTP registry allowlist and envelope behavior in `src/server/local_web_rpc_registry.test.ts`;
- local browser transport selection in `src/lib/local_web_transport.test.ts`;
- SSE auth, event delivery, and cleanup in `src/server/local_event_stream.test.ts`;
- runtime operation audit and denied no-side-effect behavior in `src/runtime/local_runtime_operations.test.ts` and `src/server/local_operation_audit.test.ts`.
