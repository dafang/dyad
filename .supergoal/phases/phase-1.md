SUPERGOAL_PHASE_START
Phase: 1 of 5 — Capture Mobile Baseline
Task: Audit the current Local Web UI at desktop and mobile widths before making responsive changes.
Type: brownfield, ui, responsive, web-parity
Mandatory commands: npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts
Acceptance criteria: 6
Evidence required: Local Web URL/API URL, screenshot filenames, issue inventory, targeted test output
Depends on phases: none

## Why

Establish factual desktop/mobile evidence before changing layout, so later fixes target real failures and preserve current desktop behavior.

## Work

- Start or reuse a Local Web server from this repository. Record the Web URL, API URL, token source if applicable, and whether it is local or tunneled.
- Use browser automation with at least two viewport sizes: desktop 1440x900 and mobile 390x844.
- Visit home/apps/chat/preview/settings. If a test app/chat is needed, create it through the existing Local Web RPC path rather than hardcoding database state.
- Capture screenshots under `.supergoal/mobile-web-audit/` using stable names such as `phase1-mobile-chat.png` and `phase1-desktop-preview.png`.
- Measure document overflow on each route with a DOM expression equivalent to `document.documentElement.scrollWidth <= window.innerWidth + 1`.
- Capture unexpected console errors, page errors, failed `/api/rpc/*` responses, and failed `/api/events` responses.
- Map each mobile issue to likely owning components/files, especially shell/sidebar, chat, and preview modules.

## Acceptance criteria (all must pass — verify each in transcript)

- A real Local Web server is launched from this repo, or an existing live Local Web server is reused with its URL/token recorded.
- Desktop viewport evidence at 1440x900 covers home/apps/chat/preview/settings with screenshots.
- Mobile viewport evidence at 390x844 covers home/apps/chat/preview/settings with screenshots.
- The audit records whether each tested route has horizontal document overflow, unreachable primary controls, console errors, failed Local Web RPC/event requests, or blank content.
- The audit identifies the exact component/file owners for each mobile issue that must be fixed in phases 2-4.
- The audit confirms the desktop baseline is currently usable before layout changes, or records existing desktop failures separately from mobile-specific failures.

## Mandatory commands (run each, surface last ~10 lines + exit code)

- `npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts`

## Evidence required in transcript

- Local Web URL/API URL source used for audit.
- Desktop and mobile screenshot filenames.
- Concise issue inventory grouped by shell, chat, and preview.
- Targeted test exit code and last ~10 lines.

## Notes

- Prefer extending or reusing existing Web portal audit helpers before creating large one-off scripts.
- Do not fix product code in this phase unless required only to make the audit runnable; if that happens, record it as a deviation.
- Keep provider/runtime debugging out of scope unless it blocks loading the audited routes.

---

The agent will, during execution, print SUPERGOAL_PHASE_START (above),
do the work, then print SUPERGOAL_PHASE_VERIFY, MEMORY_SAVED, and
SUPERGOAL_PHASE_DONE in order. On failure, the agent follows the
3-strike recovery protocol in .supergoal/PROTOCOL.md without further
instruction needed here.
