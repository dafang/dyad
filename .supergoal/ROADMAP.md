# Supergoal Roadmap — Local Web GitHub/Supabase/Neon Integration Parity

## Objective

Complete the remaining Local Web migration gaps for GitHub connection, Supabase connection/project binding, and Neon database connection/project binding while preserving Electron behavior.

## Stack

- TypeScript, React, TanStack Query/Router, Electron IPC contracts.
- Local Web HTTP RPC + SSE event bridge.
- SQLite/Drizzle for app metadata.
- npm scripts: `npm test`, `npm run ts`, `npm run build:web`, `npm run fmt:check`, `npm run lint`.

## Assumptions

- GitHub Local Web uses GitHub device flow and emits existing `github:flow-*` events over SSE.
- Supabase Local Web v1 uses a manual Supabase access token/PAT-style credential entry and then calls real Supabase Management APIs.
- Neon Local Web v1 uses a manual Neon API key/access-token credential entry and then calls real Neon Management APIs.
- No fake connect path counts as done except existing test-only contracts for automated tests.
- No secrets are committed, printed, or stored in Supergoal artifacts.

## Phases

### Phase 1 — Characterize Integration Gaps

**Why:** Lock down current Local Web gaps with tests and inventory so implementation does not accidentally pass through stubs.

**Deliverables:**

- Updated Local Web integration tests around `src/server/local_web_integration_registry.test.ts` and/or `src/server/local_web_rpc_registry.test.ts`.
- A short inventory file under `.supergoal/` listing GitHub/Supabase/Neon unsupported methods and target services.

**Acceptance Criteria:**

- Tests prove Local Web RPC exposes GitHub/Supabase/Neon channels.
- Tests prove current/expected GitHub flow events can be published through `createLocalWebIpcEvent`.
- Tests assert unauthenticated provider calls return classified auth/precondition failures, not silent empty success.
- Inventory maps Electron handlers to Local Web service methods for all three providers.

**Mandatory Commands:**

- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm test -- src/server/local_web_rpc_registry.test.ts`

### Phase 2 — Implement GitHub Local Web

**Why:** The GitHub connect button currently does not complete because Local Web lacks real device-flow and Git operation service support.

**Deliverables:**

- Shared GitHub integration service under `src/ipc/services/` or equivalent.
- Electron GitHub handler delegates to the shared service without behavior changes.
- `createDefaultLocalWebIntegrationService` implements GitHub device flow, repository listing/availability, repo creation/linking, push/fetch/pull/rebase, branch operations, collaborator operations, clone, commit, and discard using Local Web path/settings dependencies.

**Acceptance Criteria:**

- Clicking Connect to GitHub in Local Web emits device code/update events visible to the browser event client.
- Stored GitHub token is used for list repos, branch fetch, repository create/link, and push.
- Local git branch operations resolve app paths through `LocalWebPathResolver`.
- Missing token, missing app, dirty/conflict states return classified `DyadError` kinds.
- Electron handler tests or existing behavior still compile against unchanged IPC contracts.

**Mandatory Commands:**

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm run ts`

### Phase 3 — Implement Supabase Local Web

**Why:** Supabase currently depends on external OAuth/deep-link behavior and Local Web service stubs, so project listing/binding cannot work reliably in browser mode.

**Deliverables:**

- Local Web-friendly Supabase credential entry flow in UI or dedicated RPC, using existing settings shape where possible.
- Shared Supabase service reused by Electron handlers and Local Web service.
- Local Web implementation for organization listing, organization delete, project listing, branch listing, edge logs, set/unset app project, with real management client calls.
- User-facing loading/error/empty states for manual token auth and project binding.

**Acceptance Criteria:**

- Local Web can save a Supabase credential without Electron deep links.
- Project and branch lists come from real Supabase Management APIs when credentials are present.
- Selecting/unsetting a Supabase project updates the app row and refreshes UI queries.
- Manual/non-refreshable credentials do not trigger broken refresh calls; auth failures tell the user to reconnect/update the token.
- Supabase and Neon mutual exclusion remains enforced.

**Mandatory Commands:**

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/supabase_admin/supabase_utils.test.ts src/supabase_admin/supabase_management_client_queue.test.ts`
- `npm run ts`

### Phase 4 — Implement Neon Local Web

**Why:** Neon database connection is currently mostly unsupported in Local Web even though the UI exposes the same integration surface.

**Deliverables:**

- Local Web-friendly Neon credential entry flow in UI or dedicated RPC, using existing settings shape where possible.
- Shared Neon service reused by Electron handlers and Local Web service.
- Local Web implementation for list projects, get project/branches, create project, link/unlink project, switch branch, branch env vars, email/password config read/update where Neon supports it.
- Rollback-safe app file/env mutations using `LocalWebPathResolver`.

**Acceptance Criteria:**

- Local Web can save a Neon credential without Electron deep links.
- Neon project list comes from the real Neon API when credentials are present.
- Create/link project updates app DB fields and injects env vars exactly like Electron, including rollback on failure.
- Unlink and branch switching clear/update app DB/env state consistently.
- Unsupported Neon API capabilities are disabled or return classified actionable errors, not empty success.

**Mandatory Commands:**

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/ipc/utils/neon_utils.test.ts src/neon_admin/neon_context.test.ts src/neon_admin/neon_prompt_context.test.ts`
- `npm run ts`

### Phase 5 — Polish & Harden

**Why:** The integrations touch credentials, external APIs, app files, and browser UX; final parity needs real verification, copy, and regression checks.

**Deliverables:**

- Local Web browser smoke script or manual transcript covering GitHub connect, Supabase connect/select project, and Neon connect/list/link where credentials are available.
- UI copy/i18n updates for new Local Web credential paths in English and zh-CN.
- Final diff review and hardening of secrets, logging, error classification, loading/empty/error states.
- Updated Supergoal memory with durable Local Web integration notes.

**Acceptance Criteria:**

- Browser smoke verifies the integration panels do not dead-click and show progress/error/success states.
- Real provider smoke runs when `DYAD_TEST_GITHUB_TOKEN`, `DYAD_TEST_SUPABASE_TOKEN`, or `DYAD_TEST_NEON_API_KEY` are present; if absent, transcript records skipped real smoke without fake success.
- No credentials or token values appear in committed files, logs, screenshots, or test artifacts.
- `npm run fmt:check`, `npm run lint`, `npm run ts`, `npm run build:web`, and targeted tests pass.
- Final audit confirms every phase deliverable exists and Electron IPC contracts remain compatible.

**Mandatory Commands:**

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- `npm run build:web`
- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`

## Completion Definition

The task is complete when Local Web users can initiate GitHub connection, save/connect Supabase credentials and bind projects, save/connect Neon credentials and bind/create projects, all through real Local Web RPC/service paths with no Electron-only dependency, and final verification passes or records explicit credential-gated smoke skips without fake success.
