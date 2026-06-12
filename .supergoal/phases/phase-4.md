SUPERGOAL_PHASE_START
Phase: 4 of 5 — Switch Mobile Preview
Task: Add usable mobile chat-to-preview switching and compact preview controls without breaking desktop preview.
Type: brownfield, ui, responsive, web-parity
Mandatory commands: npm test -- src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts, npm run ts, npm run build:web
Acceptance criteria: 6
Evidence required: mobile preview screenshots, desktop preview screenshot, iframe src/body evidence, command output
Depends on phases: 1, 2, 3

## Why

Mobile Web must let users move between conversation and live app preview without relying on an unusable desktop side-by-side layout.

## Work

- Review Phase 1 preview findings and the Phase 3 mobile chat layout before editing.
- Update `src/pages/chat.tsx`, `src/components/ChatPanel.tsx`, `src/components/preview_panel/PreviewPanel.tsx`, `src/components/preview_panel/PreviewToolbar.tsx`, `src/components/preview_panel/PreviewIframe.tsx`, or related state helpers as needed.
- Implement a mobile behavior that lets users switch between chat and preview as full-width panes or equivalent compact views.
- Keep desktop `react-resizable-panels` split-pane behavior and preview resize handle intact.
- Compact preview toolbar actions using existing UI primitives and lucide icons. Put secondary actions behind Base UI overflow menus when necessary.
- Keep preview iframe `src` generation on the existing Local Web public/path proxy behavior. Do not add tunnel-domain-specific product branches.
- Verify refresh, restart, open-in-browser, device mode, preview/code/problems/configure/security/publish mode access, and return-to-chat controls at mobile width.

## Acceptance criteria (all must pass — verify each in transcript)

- At 390x844, a user can switch from chat to preview and back using visible/touchable controls.
- Mobile preview mode renders the app iframe with non-empty body content and no parent page horizontal overflow.
- Preview refresh, restart, open-in-browser, device mode, and mode selection controls are reachable through visible buttons or Base UI overflow menus.
- Desktop preview split-pane, resize handle, preview toolbar, and open-in-browser behavior remain unchanged at 1440x900.
- Preview console/status affordance does not cover the iframe or toolbar in mobile view.
- Public/tunneled Local Web URLs continue to use the existing preview path proxy; no tunnel-specific special case is added.

## Mandatory commands (run each, surface last ~10 lines + exit code)

- `npm test -- src/components/preview_panel/PreviewPanel.test.tsx src/components/preview_panel/previewBrowserUrl.test.ts src/components/preview_panel/previewUrl.test.ts`
- `npm run ts`
- `npm run build:web`

## Evidence required in transcript

- Mobile screenshots for chat view, preview view with iframe content, compact preview controls, and back-to-chat.
- Desktop screenshot showing split-pane preview still works.
- Sampled iframe `src`, body text presence, and current preview address bar path.
- Mandatory command exit codes and last ~10 lines.

## Notes

- Follow `rules/base-ui-components.md` for any tooltip/dropdown composition; avoid nested buttons with `TooltipTrigger`.
- For preview toolbar actions, keep the existing `MoreHorizontal` / `MoreVertical` distinction from `rules/ui-styling.md`.
- If runtime startup fails because dependencies are missing in a generated app, classify that separately from a mobile UI failure and use existing install/run paths rather than adding fake previews.

---

The agent will, during execution, print SUPERGOAL_PHASE_START (above),
do the work, then print SUPERGOAL_PHASE_VERIFY, MEMORY_SAVED, and
SUPERGOAL_PHASE_DONE in order. On failure, the agent follows the
3-strike recovery protocol in .supergoal/PROTOCOL.md without further
instruction needed here.
