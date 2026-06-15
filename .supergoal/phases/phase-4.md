SUPERGOAL_PHASE_START
Phase: 4 of 5 — Implement Neon Local Web
Task: Add Local Web Neon credential entry and real project create/list/link/branch/env support.
Mandatory commands:

- npm test -- src/ipc/services/default_local_web_integration_service.test.ts
- npm test -- src/ipc/utils/neon_utils.test.ts src/neon_admin/neon_context.test.ts src/neon_admin/neon_prompt_context.test.ts
- npm run ts
  Acceptance criteria: 9
  Evidence required:
- Test output excerpts for mandatory commands.
- UI/RPC transcript for manual Neon credential save and project listing, or credential-gated real smoke skip.
- Diff snippets for Neon shared service/client changes, rollback handling, and connector UI changes.
  Depends on phases: 1

## Work

Implement Neon Local Web support without relying on Electron deep links. Prefer reusing the existing `settings.neon` schema; add a narrow provider credential RPC only if direct settings writes would produce poor UX or unsafe validation.

Extract reusable logic from `src/ipc/handlers/neon_handlers.ts` into a shared service with injected dependencies for:

- settings read/write and Neon client construction
- app lookup and app DB updates
- app path resolution through `LocalWebPathResolver`
- env file reads/writes and Nitro setup rollback
- Vercel cleanup calls where needed

Wire Local Web service methods for:

- `listNeonProjects`
- `getNeonProject`
- `createNeonProject`
- `setNeonAppProject`
- `unsetNeonAppProject`
- `setNeonActiveBranch`
- `getNeonEmailPasswordConfig`
- `updateNeonEmailVerification`
- `getNeonBranchEnvVars`
- selected database branch type

## Acceptance criteria

1. Local Web UI exposes a clear manual Neon credential path instead of opening an Electron-only OAuth flow.
2. Saving credentials writes only to the existing settings shape or a deliberately added validated contract; secrets are never printed.
3. `listNeonProjects` calls the real Neon API when credentials exist and classifies missing/invalid credentials.
4. Linking an existing Neon project updates app DB fields and injects branch env vars through the same semantics as Electron.
5. Creating a Neon project creates production/development/preview branches where supported and rolls back app/Nitro/env mutations on failure.
6. Switching active branch updates app DB/env state and invalidates UI queries.
7. Unlinking clears app DB/env state and handles optional Vercel cleanup without making unlink fail for non-fatal Vercel errors.
8. Unsupported Neon capabilities are disabled in Local Web UI or return `DyadErrorKind.Precondition`, never silent empty success.
9. Mandatory commands exit 0.

## Mandatory commands

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/ipc/utils/neon_utils.test.ts src/neon_admin/neon_context.test.ts src/neon_admin/neon_prompt_context.test.ts`
- `npm run ts`

## Evidence required

- Test output excerpts for mandatory commands.
- UI/RPC transcript for manual Neon credential save and project listing, or credential-gated real smoke skip.
- Diff snippets for Neon shared service/client changes, rollback handling, and connector UI changes.

## Verification Notes

Print `SUPERGOAL_PHASE_VERIFY` with pass/fail for each criterion and command summaries, then update `.supergoal/STATE.md` and print `SUPERGOAL_PHASE_DONE`.
