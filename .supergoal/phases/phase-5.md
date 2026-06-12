SUPERGOAL_PHASE_START
Phase: 5 of 5 — Polish & Harden
Task: Harden the responsive Web UI with desktop/mobile E2E coverage, accessibility/overflow checks, and final regression commands.
Type: brownfield, ui, responsive, web-parity
Mandatory commands: npm run fmt:check, npm run lint, npm run ts, npm run build:web, npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts, PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/web_portal.spec.ts
Acceptance criteria: 7
Evidence required: UX/states/a11y/security/perf/diff review paragraphs, screenshot list, command summary, git diff stat
Depends on phases: 1, 2, 3, 4

## Why

Cross-device UI changes can pass focused checks while still leaving overflow, accessibility, runtime, or desktop regressions; this phase closes that gap.

## Work

- Extend `e2e-tests/web_portal.spec.ts` or add a focused adjacent Web portal mobile spec/helper that runs against Local Web and validates both desktop and mobile viewports.
- Keep the real-provider requirement for meaningful chat verification where possible; if the environment lacks provider config, fail with an actionable message rather than silently faking the flow.
- Add DOM checks for horizontal overflow on mobile routes.
- Capture desktop and mobile screenshots for the final evidence set.
- Check keyboard/focus or accessible-name coverage for mobile navigation, chat send/cancel controls, and preview switch controls.
- Review final diff for debug logs, TODOs from this run, fake-only shortcuts, unrelated churn, and tunnel-specific product branches.
- Run all mandatory commands and classify any environmental failure with concrete evidence.

## Acceptance criteria (all must pass — verify each in transcript)

- A Web E2E/browser flow verifies desktop and mobile viewports for home/apps/chat/preview/settings or a documented equivalent route set.
- The mobile flow sends or observes a real chat response through the Local Web path, then switches to preview and verifies iframe content.
- The final browser run records zero unexpected console errors, zero failed Local Web RPC/event responses, and zero blank main surfaces.
- DOM checks prove `document.documentElement.scrollWidth <= window.innerWidth + 1` for the tested mobile routes.
- Keyboard/focus or accessible-name checks cover the mobile navigation, chat send button, and preview switch controls.
- Final diff review finds no stray debug logs, temporary TODOs, fake-only testing shortcuts, or tunnel-specific product branches.
- Formatting, lint, typecheck, Web build, targeted unit tests, and Web E2E all pass or any environmental failure is clearly classified with reproduction evidence.

## Mandatory commands (run each, surface last ~10 lines + exit code)

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- `npm run build:web`
- `npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts`
- `PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/web_portal.spec.ts`

## Evidence required in transcript

- One paragraph each for UX/copy, states, accessibility, security/runtime, performance, and diff review.
- Final desktop and mobile screenshot list.
- Final command summary with exit codes.
- Final `git diff --stat` summary.

## Notes

- Read `rules/e2e-testing.md` before editing or running E2E tests.
- Do not use Playwright `:visible` as a literal CSS selector in app code or scripts; prefer role/test id locators or Playwright visibility filters.
- If Web E2E takes over an existing server, ensure cleanup does not kill unrelated user processes. Prefer test-owned Local Web processes for automated runs.

---

The agent will, during execution, print SUPERGOAL_PHASE_START (above),
do the work, then print SUPERGOAL_PHASE_VERIFY, MEMORY_SAVED, and
SUPERGOAL_PHASE_DONE in order. On failure, the agent follows the
3-strike recovery protocol in .supergoal/PROTOCOL.md without further
instruction needed here.
