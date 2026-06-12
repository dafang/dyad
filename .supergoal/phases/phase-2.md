SUPERGOAL_PHASE_START
Phase: 2 of 5 — Adapt Web Shell
Task: Make the Local Web application shell and navigation usable on mobile touch widths while preserving desktop sidebar behavior.
Type: brownfield, ui, responsive, web-parity
Mandatory commands: npm test -- src/components/app-sidebar-state.test.ts, npm run ts, npm run fmt:check
Acceptance criteria: 6
Evidence required: changed file summary, overflow measurements, mobile/desktop screenshots, command output
Depends on phases: 1

## Why

Mobile chat and preview cannot be usable until the global Web shell provides touch-safe navigation and content viewport sizing.

## Work

- Review Phase 1 shell findings before editing.
- Update `src/app/layout.tsx`, `src/components/app-sidebar.tsx`, related sidebar components/state, or small helper modules as needed.
- Preserve existing desktop hover-expanded rail behavior and desktop contextual lists.
- Add mobile/touch behavior that does not rely on hover. Choose the smallest durable pattern that matches the current app, such as a compact top/bottom navigation affordance, drawer, or explicit expanded control.
- Ensure the main content container uses stable viewport sizing on Local Web and Electron, with safe-area-aware padding where needed.
- Add or update focused tests for any extracted pure logic. Avoid testing CSS implementation details that are better covered by browser evidence.
- Capture after screenshots for desktop and mobile routes under `.supergoal/mobile-web-audit/phase2-*`.

## Acceptance criteria (all must pass — verify each in transcript)

- At 390x844 Local Web width, the root layout has no horizontal document overflow on home/apps/chat/settings/library routes.
- Mobile users can reach Apps, Settings, Library, Hub/help where currently applicable, and the selected app chat list, without relying on hover.
- Desktop sidebar hover/collapse behavior remains available and visually consistent at 1440x900.
- Mobile shell controls have stable dimensions, do not cover page content incoherently, and respect browser safe areas.
- Route identity remains owned by TanStack Router/search params; no duplicated IPC-backed data is introduced into Jotai.
- No new Radix UI primitives are introduced.

## Mandatory commands (run each, surface last ~10 lines + exit code)

- `npm test -- src/components/app-sidebar-state.test.ts`
- `npm run ts`
- `npm run fmt:check`

## Evidence required in transcript

- Files changed and why each was touched.
- Before/after overflow measurements for desktop and mobile shell routes.
- Screenshots proving mobile navigation and desktop sidebar behavior.
- Mandatory command exit codes and last ~10 lines.

## Notes

- Read `rules/base-ui-components.md`, `rules/ui-styling.md`, `rules/jotai-state.md`, and `rules/e2e-testing.md` if not already loaded in the executing session.
- If IPC/RPC contracts become involved, stop and read `rules/electron-ipc.md` before editing that layer.
- Keep mobile-only state local to the shell unless it truly must survive unmounts; if persisted, follow entity-scoped Jotai guidance.

---

The agent will, during execution, print SUPERGOAL_PHASE_START (above),
do the work, then print SUPERGOAL_PHASE_VERIFY, MEMORY_SAVED, and
SUPERGOAL_PHASE_DONE in order. On failure, the agent follows the
3-strike recovery protocol in .supergoal/PROTOCOL.md without further
instruction needed here.
