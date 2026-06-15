SUPERGOAL_PHASE_START
Phase: 2 of 5 — Implement GitHub Local Web
Task: Implement real GitHub device-flow and repository/git operations in Local Web through shared service logic.
Mandatory commands:

- npm test -- src/ipc/services/default_local_web_integration_service.test.ts
- npm test -- src/server/local_web_integration_registry.test.ts
- npm run ts
  Acceptance criteria: 8
  Evidence required:
- Test output excerpts for mandatory commands.
- Browser/RPC transcript showing GitHub device-flow events or a credential-gated skip with no fake success.
- Diff snippets for shared GitHub service, Electron wrapper delegation, and Local Web service wiring.
  Depends on phases: 1

## Work

Extract GitHub logic from `src/ipc/handlers/github_handlers.ts` into an Electron-free service under `src/ipc/services/` or an equivalent shared module. The service must accept injected dependencies for:

- settings read/write
- app lookup and app path resolution
- event sender for `github:flow-*`
- host capability for opening external verification URL if needed
- logger/fetch where useful for tests

Keep the Electron handler as an IPC registration wrapper and preserve existing contract names and output schemas.

Wire `createDefaultLocalWebIntegrationService` so GitHub methods are real:

- `startGithubFlow`
- `listGithubRepos`
- `getGithubRepoBranches`
- `isGithubRepoAvailable`
- `createGithubRepo`
- `connectExistingGithubRepo`
- `pushGithub`, `fetchGithub`, `pullGithub`, `rebaseGithub`, abort/continue methods
- local/remote branch operations
- conflict/git state operations
- disconnect/collaborator/clone/commit/discard operations where the Electron implementation already supports them

## Acceptance criteria

1. `startGithubFlow` in Local Web requests a device code, publishes update events through the Local Web event bridge, polls for a token, stores it in Local Web settings, and publishes success/error events.
2. GitHub API calls use the stored access token and classify missing token as `DyadErrorKind.Auth`.
3. Repository creation/linking updates the app GitHub fields through the same DB semantics as Electron.
4. Git push/fetch/pull/rebase operations resolve app paths through `LocalWebPathResolver` and preserve conflict handling.
5. Branch list/create/switch/delete/rename/merge operations work through Local Web RPC or return a classified precondition when the app path is invalid.
6. Electron handler registration remains thin and contract-compatible.
7. Tests cover event publishing, missing-token error, and at least one app-path git operation through Local Web service dependencies.
8. Mandatory commands exit 0.

## Mandatory commands

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm run ts`

## Evidence required

- Test output excerpts for mandatory commands.
- Browser/RPC transcript showing GitHub device-flow events or a credential-gated skip with no fake success.
- Diff snippets for shared GitHub service, Electron wrapper delegation, and Local Web service wiring.

## Verification Notes

Print `SUPERGOAL_PHASE_VERIFY` with pass/fail for each criterion and command summaries, then update `.supergoal/STATE.md` and print `SUPERGOAL_PHASE_DONE`.
