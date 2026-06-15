SUPERGOAL_PHASE_START
Phase: 3 of 5 — Implement Supabase Local Web
Task: Add Local Web Supabase credential entry and real project/branch/log/binding support.
Mandatory commands:

- npm test -- src/ipc/services/default_local_web_integration_service.test.ts
- npm test -- src/supabase_admin/supabase_utils.test.ts src/supabase_admin/supabase_management_client_queue.test.ts
- npm run ts
  Acceptance criteria: 8
  Evidence required:
- Test output excerpts for mandatory commands.
- UI/RPC transcript for manual Supabase credential save and project listing, or credential-gated real smoke skip.
- Diff snippets for Supabase shared service/client changes and connector UI changes.
  Depends on phases: 1

## Work

Implement Supabase Local Web support without relying on Electron deep links. Prefer reusing the existing `settings.supabase` schema; add a narrow provider credential RPC only if direct settings writes would produce poor UX or unsafe validation.

Update `SupabaseConnector` and any settings integration surface so Local Web users can provide a Supabase access token/PAT-style credential, save it locally, refresh queries, and then select a project. Preserve Electron OAuth behavior for Electron builds.

Move reusable Supabase handler logic into a shared service if needed so both Electron and Local Web use the same:

- organization listing and delete
- project listing
- branch listing
- edge log retrieval
- app project set/unset
- mutual exclusion with Neon

## Acceptance criteria

1. Local Web UI exposes a clear manual Supabase credential path instead of opening an Electron-only OAuth flow.
2. Saving credentials writes only to the existing settings shape or a deliberately added validated contract; secrets are never printed.
3. `listSupabaseOrganizations` and `listSupabaseProjects` call real Supabase Management APIs when credentials exist.
4. Manual/non-refreshable credentials do not go through a broken OAuth refresh path; missing/expired/invalid tokens return classified auth/external errors with actionable copy.
5. Selecting a Supabase project updates `apps.supabaseProjectId`, `supabaseParentProjectId`, and `supabaseOrganizationSlug` as appropriate.
6. Branch listing and edge log polling work for linked projects or degrade with classified errors.
7. Supabase remains mutually exclusive with Neon.
8. Mandatory commands exit 0.

## Mandatory commands

- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`
- `npm test -- src/supabase_admin/supabase_utils.test.ts src/supabase_admin/supabase_management_client_queue.test.ts`
- `npm run ts`

## Evidence required

- Test output excerpts for mandatory commands.
- UI/RPC transcript for manual Supabase credential save and project listing, or credential-gated real smoke skip.
- Diff snippets for Supabase shared service/client changes and connector UI changes.

## Verification Notes

Print `SUPERGOAL_PHASE_VERIFY` with pass/fail for each criterion and command summaries, then update `.supergoal/STATE.md` and print `SUPERGOAL_PHASE_DONE`.
