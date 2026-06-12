# Roadmap: Dyad Web Mobile + PC Access

**Task:** Make the Local Web version support both desktop and mobile browser access, including mobile chat and switching to preview.
**Type:** brownfield, ui, responsive, web-parity
**Created:** 2026-06-12
**Total phases:** 5

## Context summary

- **Stack:** Electron-first Dyad app with React, TanStack Router, Vite Local Web dev server, TypeScript, Tailwind v4, Base UI, Jotai, TanStack Query, Drizzle SQLite.
- **Package manager:** npm.
- **Build / test / lint commands:** `npm run fmt:check`, `npm run lint`, `npm run ts`, `npm run build:web`, targeted Vitest, and `PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/web_portal.spec.ts`.
- **Risky areas:** `src/pages/chat.tsx`, `src/app/layout.tsx`, `src/components/app-sidebar.tsx`, `src/components/ChatPanel.tsx`, `src/components/chat/ChatInput.tsx`, `src/components/chat/MessagesList.tsx`, `src/components/preview_panel/PreviewPanel.tsx`, `src/components/preview_panel/PreviewIframe.tsx`, `src/components/preview_panel/PreviewToolbar.tsx`, `e2e-tests/web_portal.spec.ts`.

## Assumptions

Non-blocking decisions recorded here so we can proceed without round-trips. If any are wrong, stop the run and tell us:

- Target support is modern desktop Chrome/Safari and mobile Chrome/Safari browser widths, with primary mobile verification at 390x844 CSS pixels and desktop verification at 1440x900.
- Mobile Web can use a single-pane chat/preview switcher rather than showing chat and preview side by side.
- Core mobile flow is: open Web UI, navigate to or create/open an app chat, send a message, see streamed assistant output, switch to preview, see the iframe render, and return to chat.
- Existing Electron desktop UI and Local Web desktop split-pane behavior must remain intact.
- Existing Local Web runtime/provider/preview path proxy fixes are baseline; do not redesign runtime provider plumbing for this task.

## Risk top 3

1. **Mobile layout inherits desktop split-pane slivers** — likelihood: high, mitigation: add explicit mobile chat/preview view behavior and verify no horizontal overflow at 390px.
2. **Touch navigation cannot use hover-expanded sidebar** — likelihood: high, mitigation: add touch-friendly shell navigation or drawer while keeping desktop hover rail unchanged.
3. **Preview controls overflow or hide required actions** — likelihood: medium, mitigation: compact actions into Base UI overflow menus and verify preview toolbar/iframe screenshots at mobile and desktop widths.

## Phase map

| #   | Phase                   | Depends on | Deliverable                                                                                                   |
| --- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Capture Mobile Baseline | —          | Browser audit report and screenshots documenting current desktop/mobile failures and stable selectors.        |
| 2   | Adapt Web Shell         | 1          | Responsive Local Web shell/navigation that works on desktop and touch mobile without horizontal overflow.     |
| 3   | Fit Mobile Chat         | 1, 2       | Mobile chat layout with reachable header controls, scrollable messages, safe composer, and visible streaming. |
| 4   | Switch Mobile Preview   | 1, 2, 3    | Mobile chat/preview switching plus compact preview toolbar and usable iframe.                                 |
| 5   | Polish & Harden         | 1..4       | Cross-device tests, accessibility/overflow hardening, and final regression evidence.                          |

---

## Phase 1 — Capture Mobile Baseline

**Why:** Establish factual desktop/mobile evidence before changing layout, so later fixes target real failures and preserve current desktop behavior.

**Deliverables:**

- `.supergoal/mobile-web-audit/phase1-report.json`
- `.supergoal/mobile-web-audit/phase1-*.png`
- Optional focused notes in `.supergoal/mobile-web-audit/phase1-notes.md` if the script finds failures not obvious from screenshots.

**Acceptance criteria:**

- [ ] A real Local Web server is launched from this repo, or an existing live Local Web server is reused with its URL/token recorded.
- [ ] Desktop viewport evidence at 1440x900 covers home/apps/chat/preview/settings with screenshots.
- [ ] Mobile viewport evidence at 390x844 covers home/apps/chat/preview/settings with screenshots.
- [ ] The audit records whether each tested route has horizontal document overflow, unreachable primary controls, console errors, failed Local Web RPC/event requests, or blank content.
- [ ] The audit identifies the exact component/file owners for each mobile issue that must be fixed in phases 2-4.
- [ ] The audit confirms the desktop baseline is currently usable before layout changes, or records existing desktop failures separately from mobile-specific failures.

**Mandatory commands:**

- `npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts`

**Evidence required:**

- Print the Local Web URL/API URL source used for audit.
- Print the desktop and mobile screenshot filenames.
- Print a concise issue inventory grouped by shell, chat, and preview.
- Print the targeted test exit code and last ~10 lines.

**Dependencies:** none

---

## Phase 2 — Adapt Web Shell

**Why:** Mobile chat and preview cannot be usable until the global Web shell provides touch-safe navigation and content viewport sizing.

**Deliverables:**

- Responsive changes in `src/app/layout.tsx`, `src/components/app-sidebar.tsx`, related sidebar state/components, or small helper modules as needed.
- Tests for any extracted shell/sidebar responsive logic.
- Updated mobile/desktop screenshots under `.supergoal/mobile-web-audit/phase2-*`.

**Acceptance criteria:**

- [ ] At 390x844 Local Web width, the root layout has no horizontal document overflow on home/apps/chat/settings/library routes.
- [ ] Mobile users can reach Apps, Settings, Library, Hub/help where currently applicable, and the selected app chat list, without relying on hover.
- [ ] Desktop sidebar hover/collapse behavior remains available and visually consistent at 1440x900.
- [ ] Mobile shell controls have stable dimensions, do not cover page content incoherently, and respect browser safe areas.
- [ ] Route identity remains owned by TanStack Router/search params; no duplicated IPC-backed data is introduced into Jotai.
- [ ] No new Radix UI primitives are introduced.

**Mandatory commands:**

- `npm test -- src/components/app-sidebar-state.test.ts`
- `npm run ts`
- `npm run fmt:check`

**Evidence required:**

- Print the files changed and why each was touched.
- Print before/after overflow measurements for desktop and mobile shell routes.
- Print screenshots proving mobile navigation and desktop sidebar behavior.
- Print mandatory command exit codes and last ~10 lines.

**Dependencies:** Phase 1

---

## Phase 3 — Fit Mobile Chat

**Why:** Mobile users must be able to hold a chat conversation without the message list, header, composer, streaming state, or controls becoming unreachable.

**Deliverables:**

- Responsive chat layout updates in `src/pages/chat.tsx`, `src/components/ChatPanel.tsx`, `src/components/chat/ChatHeader.tsx`, `src/components/chat/ChatInput.tsx`, `src/components/chat/MessagesList.tsx`, or narrow helper modules.
- Focused unit tests for any extracted responsive/mobile view logic.
- Browser evidence under `.supergoal/mobile-web-audit/phase3-*`.

**Acceptance criteria:**

- [ ] At 390x844, the chat route renders a single usable chat pane by default, with header controls, message list, and composer visible/reachable.
- [ ] The chat input accepts text and the send/cancel state is reachable without horizontal scrolling or overlap.
- [ ] During a real-provider or existing Web E2E chat stream, partial assistant output is visible before final completion when the provider/runtime emits stream deltas.
- [ ] Existing desktop chat split-pane behavior and panel resize behavior remain intact at 1440x900.
- [ ] Terminal/version pane affordances remain reachable or are intentionally compacted behind accessible mobile controls.
- [ ] Mobile browser viewport changes do not strand the user away from the latest message when following the stream.

**Mandatory commands:**

- `npm test -- src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts`
- `npm run ts`
- `npm run fmt:check`

**Evidence required:**

- Print mobile screenshots before send, during/after response, and after any compact control menu is opened.
- Print desktop chat screenshot showing split-pane behavior still works.
- Print streaming evidence from UI text/timestamps or explain if the configured real provider returned a single final chunk and which lower-level streaming contract remains covered.
- Print mandatory command exit codes and last ~10 lines.

**Dependencies:** Phases 1 and 2

---

## Phase 4 — Switch Mobile Preview

**Why:** Mobile Web must let users move between conversation and live app preview without relying on an unusable desktop side-by-side layout.

**Deliverables:**

- Responsive chat/preview switching updates in `src/pages/chat.tsx`, `src/components/ChatPanel.tsx`, `src/components/preview_panel/PreviewPanel.tsx`, `src/components/preview_panel/PreviewToolbar.tsx`, `src/components/preview_panel/PreviewIframe.tsx`, or related state helpers.
- Tests for mobile preview mode/view selection logic and compact toolbar behavior.
- Browser evidence under `.supergoal/mobile-web-audit/phase4-*`.

**Acceptance criteria:**

- [ ] At 390x844, a user can switch from chat to preview and back using visible/touchable controls.
- [ ] Mobile preview mode renders the app iframe with non-empty body content and no parent page horizontal overflow.
- [ ] Preview refresh, restart, open-in-browser, device mode, and mode selection controls are reachable through visible buttons or Base UI overflow menus.
- [ ] Desktop preview split-pane, resize handle, preview toolbar, and open-in-browser behavior remain unchanged at 1440x900.
- [ ] Preview console/status affordance does not cover the iframe or toolbar in mobile view.
- [ ] Public/tunneled Local Web URLs continue to use the existing preview path proxy; no tunnel-specific special case is added.

**Mandatory commands:**

- `npm test -- src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts`
- `npm run ts`
- `npm run build:web`

**Evidence required:**

- Print mobile screenshots for chat view, preview view with iframe content, compact preview controls, and back-to-chat.
- Print desktop screenshot showing split-pane preview still works.
- Print sampled iframe `src`, body text presence, and current preview address bar path.
- Print mandatory command exit codes and last ~10 lines.

**Dependencies:** Phases 1, 2, and 3

---

## Phase 5 — Polish & Harden

**Why:** Cross-device UI changes can pass focused checks while still leaving overflow, accessibility, runtime, or desktop regressions; this phase closes that gap.

**Deliverables:**

- Durable desktop+mobile coverage in `e2e-tests/web_portal.spec.ts` or a focused adjacent Web portal mobile spec/helper.
- Final screenshot/report artifacts under `.supergoal/mobile-web-audit/phase5-*` and `.supergoal/web-e2e/`.
- Optional project memory update documenting the responsive Web shell pattern.

**Acceptance criteria:**

- [ ] A Web E2E/browser flow verifies desktop and mobile viewports for home/apps/chat/preview/settings or a documented equivalent route set.
- [ ] The mobile flow sends or observes a real chat response through the Local Web path, then switches to preview and verifies iframe content.
- [ ] The final browser run records zero unexpected console errors, zero failed Local Web RPC/event responses, and zero blank main surfaces.
- [ ] DOM checks prove `document.documentElement.scrollWidth <= window.innerWidth + 1` for the tested mobile routes.
- [ ] Keyboard/focus or accessible-name checks cover the mobile navigation, chat send button, and preview switch controls.
- [ ] Final diff review finds no stray debug logs, temporary TODOs, fake-only testing shortcuts, or tunnel-specific product branches.
- [ ] Formatting, lint, typecheck, Web build, targeted unit tests, and Web E2E all pass or any environmental failure is clearly classified with reproduction evidence.

**Mandatory commands:**

- `npm run fmt:check`
- `npm run lint`
- `npm run ts`
- `npm run build:web`
- `npm test -- src/components/app-sidebar-state.test.ts src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts`
- `PLAYWRIGHT_HTML_OPEN=never npm run e2e -- e2e-tests/web_portal.spec.ts`

**Evidence required:**

- One paragraph each for UX/copy, states, accessibility, security/runtime, performance, and diff review.
- Final desktop and mobile screenshot list.
- Final command summary with exit codes.
- Final `git diff --stat` summary.

**Dependencies:** Phases 1 through 4
