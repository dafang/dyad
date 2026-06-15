SUPERGOAL_PHASE_START
Phase: 1 of 5 — Characterize Integration Gaps
Task: Add failing/characterization coverage for Local Web GitHub, Supabase, and Neon integration surfaces.
Mandatory commands:

- npm test -- src/server/local_web_integration_registry.test.ts
- npm test -- src/server/local_web_rpc_registry.test.ts
  Acceptance criteria: 6
  Evidence required:
- Test output excerpts for both mandatory commands.
- Inventory excerpt showing unsupported/current Local Web provider methods and target shared service owners.
- Diff snippet for the key characterization assertions.
  Depends on phases: none

## Work

Audit the Local Web integration boundary and add characterization tests before changing provider behavior. Focus on:

- `src/server/local_web_rpc_registry.ts`
- `src/server/local_web_integration_registry.test.ts`
- `src/server/local_web_rpc_registry.test.ts`
- `src/server/local_web_ipc_event.ts`
- `src/ipc/services/default_local_web_integration_service.ts`
- Electron handlers for GitHub, Supabase, and Neon

Write or update `.supergoal/local-web-provider-integration-inventory.md` with:

- Every GitHub/Supabase/Neon method exposed in Local Web.
- Whether it is implemented, stubbed, or unsupported today.
- The intended shared service or dependency needed to make it real.
- Whether the method touches credentials, app DB rows, app files, or external network.

## Acceptance criteria

1. `LOCAL_WEB_RPC_ALLOWLIST` coverage for GitHub, Supabase, and Neon is asserted in tests.
2. A test proves `createLocalWebIpcEvent` can publish `github:flow-update`, `github:flow-success`, and `github:flow-error` payloads to the Local Web event stream shape.
3. Tests distinguish auth/precondition failures from silent stub success for unauthenticated GitHub, Supabase, and Neon operations.
4. Inventory file lists all provider methods currently stubbed in `default_local_web_integration_service.ts`.
5. No fake connect behavior is marked as production success in tests or inventory.
6. Mandatory commands exit 0 after characterization updates.

## Mandatory commands

- `npm test -- src/server/local_web_integration_registry.test.ts`
- `npm test -- src/server/local_web_rpc_registry.test.ts`

## Evidence required

- Test output excerpts for both mandatory commands.
- Inventory excerpt showing unsupported/current Local Web provider methods and target shared service owners.
- Diff snippet for the key characterization assertions.

## Verification Notes

Print `SUPERGOAL_PHASE_VERIFY` with pass/fail for each criterion and command summaries, then update `.supergoal/STATE.md` and print `SUPERGOAL_PHASE_DONE`.
