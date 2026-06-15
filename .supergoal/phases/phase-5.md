SUPERGOAL_PHASE_START
Phase: 5 of 5 — Polish & Harden
Task: Verify Local Web integration UX end to end, harden secrets/errors/i18n, and run final regression checks.
Mandatory commands:

- npm run fmt:check
- npm run lint
- npm run ts
- npm run build:web
- npm test -- src/server/local_web_integration_registry.test.ts
- npm test -- src/ipc/services/default_local_web_integration_service.test.ts
  Acceptance criteria: 10
  Evidence required:
- Command output excerpts for all mandatory commands.
- Browser smoke screenshots or transcript paths for GitHub, Supabase, and Neon panels.
- Secret scan evidence showing no provider tokens in committed files or Supergoal artifacts.
- Final diff review summary and memory writeback path.
  Depends on phases: 1, 2, 3, 4

## Work

Run a final Local Web integration QA pass across the app details/publish/configure surfaces:

- GitHub connect/device flow progress and error states.
- Supabase credential entry, organization/project/branch listing, project set/unset.
- Neon credential entry, project list, create/link/unlink, branch switching, env vars, email config.
- Settings pages that display connected provider status.
- Chinese and English copy for all new UI strings.

Create or update a `.supergoal/local-web-provider-smoke.mjs` script when practical. It must use the real Local Web dev server and real provider credentials only when present in environment variables or existing local settings. It must not fake provider success.

## Acceptance criteria

1. GitHub, Supabase, and Neon panels have visible loading, success, empty, auth error, and external API error states.
2. Browser smoke verifies buttons do not dead-click in Local Web.
3. Real GitHub smoke runs when `DYAD_TEST_GITHUB_TOKEN` or an existing local token is available; otherwise skip is recorded as credential-gated.
4. Real Supabase smoke runs when `DYAD_TEST_SUPABASE_TOKEN` or an existing local token is available; otherwise skip is recorded as credential-gated.
5. Real Neon smoke runs when `DYAD_TEST_NEON_API_KEY` or an existing local token is available; otherwise skip is recorded as credential-gated.
6. New visible strings have English and zh-CN translations.
7. No provider token value appears in source, Supergoal artifacts, command logs, screenshots, or final transcript.
8. Final diff contains no session debug prints, commented-out code, or accidental fake-only production paths.
9. Mandatory commands exit 0.
10. A new `.supergoal/memory/project_local_web_provider_integrations.md` memory records durable implementation and verification notes without secrets.

## Mandatory commands

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- `npm run build:web`
- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm test -- src/ipc/services/default_local_web_integration_service.test.ts`

## Evidence required

- Command output excerpts for all mandatory commands.
- Browser smoke screenshots or transcript paths for GitHub, Supabase, and Neon panels.
- Secret scan evidence showing no provider tokens in committed files or Supergoal artifacts.
- Final diff review summary and memory writeback path.

## Verification Notes

Print `SUPERGOAL_PHASE_VERIFY` with pass/fail for each criterion and command summaries, then update `.supergoal/STATE.md`, write memory if useful, and print `SUPERGOAL_PHASE_DONE`.
