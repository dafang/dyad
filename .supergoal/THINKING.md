# Thinking: Web Mobile + PC Access

## Goals

- Make the Local Web UI usable from both desktop and mobile browsers without changing the Electron-first architecture.
- On mobile widths, users can navigate core routes, chat comfortably, watch streamed responses appear in the message list, and reach common chat controls.
- On mobile widths, users can switch between chat and preview, see the preview iframe fill the available area, and access refresh/restart/open/mode controls without overlap.
- Preserve current desktop split-pane behavior, existing Electron IPC semantics, and the Local Web HTTP/RPC/SSE runtime boundary.
- Add durable browser validation for desktop and mobile viewports using real Local Web server flows; key chat/preview checks should not rely only on fake provider paths.

## Constraints

- Dyad is still an Electron app with a secure IPC boundary; Web support must stay behind the current client adapter and Local Web server rather than rewriting main-process contracts.
- Existing Local Web runtime, provider configuration, preview path proxy, multiplexed SSE, and real-provider Web E2E from the prior parity run should be treated as baseline.
- The UI is desktop-first today: `src/pages/chat.tsx` uses a horizontal `react-resizable-panels` split; `src/components/app-sidebar.tsx` uses hover-expanded sidebar behavior; preview toolbar and iframe controls have many fixed desktop affordances.
- Use Base UI primitives and existing UI components; do not introduce Radix or a new design system.
- Keep the experience utilitarian and app-like. Avoid marketing layouts or decorative redesign.
- Repository is dirty from ongoing Web migration work; do not revert unrelated changes.

## Risks

1. **Desktop split-pane assumptions break mobile.** Chat and preview currently share a horizontal resizable layout that can collapse into unusable slivers on narrow screens. Mitigation: introduce a mobile-specific view mode/switching path while preserving desktop `PanelGroup`.
2. **Navigation/sidebar hover behavior is inaccessible on touch.** The sidebar relies on hover expansion and wide contextual lists. Mitigation: audit all primary routes at mobile width, then add touch-friendly shell navigation or drawer behavior with explicit buttons.
3. **Preview toolbar and iframe controls overflow.** The preview header has many actions and device controls; mobile can hide key actions or produce horizontal scroll. Mitigation: compact toolbars with overflow menus, stable dimensions, and screenshot checks at 390px width.

## Dependencies

- Phase 1 must capture current desktop/mobile evidence before redesigning. This prevents accidental desktop regressions and tells later phases which elements overflow.
- Shell navigation must be fixed before chat and preview polish, because mobile users need a reliable way to reach `/chat`, `/apps`, `/settings`, and library routes.
- Mobile chat must land before preview switching, since preview switching depends on the selected chat/app state and the chat header affordance.
- E2E hardening comes last, after selectors and layout contracts settle.

## Open Questions Already Assumed

- The target mobile baseline is modern mobile Safari/Chrome sized around 390x844 CSS pixels, with desktop baseline around 1440x900.
- Mobile Web does not need every desktop power-user control visible at once; compact menus are acceptable if the core action remains reachable.
- The preview can be a full-screen or tabbed mobile panel rather than a simultaneous side-by-side pane.
- Real-provider checks may use the existing Codex/OpenAI-compatible configuration when present; tests should clearly fail or skip with an actionable message if no real provider is configured.

## Memory Hits Applied

- `project_dyad_local_web_runtime`: preserve the local server + IPC adapter boundary and existing HTTP/RPC/SSE contracts.
- `project_dyad_local_web_e2e`: extend the Web E2E harness with browser viewport coverage instead of relying only on unit tests.
- `project_local_web_parity`: build on the stabilized chat/preview/runtime/provider parity baseline and avoid re-solving provider or runtime issues.

## Tools / Skills Relied On

- `supergoal` for auditable phased execution and final audit.
- `agent-browser` or Playwright browser automation for desktop/mobile screenshots and interaction evidence.
- Repo rules: `e2e-testing`, `ui-styling`, `base-ui-components`, `jotai-state`; add `electron-ipc` only if implementation changes RPC/IPC contracts.

## Best Practices Applied

- Use responsive layout switches at component boundaries instead of global CSS hacks.
- Keep entity-specific UI state keyed by app/chat id where state survives unmounts.
- Prefer compact icon controls with tooltips/labels and Base UI menus for mobile overflow.
- Verify visual behavior with screenshots plus DOM assertions: no horizontal overflow, visible chat input, visible messages, visible preview iframe content, no console/RPC failures.
