SUPERGOAL_PHASE_START
Phase: 3 of 5 — Fit Mobile Chat
Task: Make the chat page comfortable on mobile while keeping desktop split-pane and streaming behavior intact.
Type: brownfield, ui, responsive, web-parity
Mandatory commands: npm test -- src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts, npm run ts, npm run fmt:check
Acceptance criteria: 6
Evidence required: mobile chat screenshots, desktop split-pane screenshot, streaming evidence, command output
Depends on phases: 1, 2

## Why

Mobile users must be able to hold a chat conversation without the message list, header, composer, streaming state, or controls becoming unreachable.

## Work

- Review Phase 1 chat findings and Phase 2 shell changes before editing.
- Update `src/pages/chat.tsx`, `src/components/ChatPanel.tsx`, `src/components/chat/ChatHeader.tsx`, `src/components/chat/ChatInput.tsx`, `src/components/chat/MessagesList.tsx`, or narrow helper modules as needed.
- For mobile widths, avoid the desktop horizontal split-pane becoming two unusable slivers. Use a responsive single-pane chat default while preserving desktop panel resize behavior.
- Keep the chat header, message list, scroll-to-bottom control, terminal/version affordances, and composer reachable on mobile.
- Ensure the composer is safe-area-aware and does not cause layout overlap at 390x844.
- Verify streaming with the existing Local Web path. Prefer real-provider evidence when available; if the provider returns one final chunk, record that and verify the UI still handles streaming state and visible completion correctly.
- Add focused tests for extracted logic only; use browser evidence for layout behavior.

## Acceptance criteria (all must pass — verify each in transcript)

- At 390x844, the chat route renders a single usable chat pane by default, with header controls, message list, and composer visible/reachable.
- The chat input accepts text and the send/cancel state is reachable without horizontal scrolling or overlap.
- During a real-provider or existing Web E2E chat stream, partial assistant output is visible before final completion when the provider/runtime emits stream deltas.
- Existing desktop chat split-pane behavior and panel resize behavior remain intact at 1440x900.
- Terminal/version pane affordances remain reachable or are intentionally compacted behind accessible mobile controls.
- Mobile browser viewport changes do not strand the user away from the latest message when following the stream.

## Mandatory commands (run each, surface last ~10 lines + exit code)

- `npm test -- src/components/chat/ChatTabs.test.ts src/components/chat/DyadAppBlueprintCard.test.ts src/components/chat/DyadAppBlueprintCard.approve.test.ts`
- `npm run ts`
- `npm run fmt:check`

## Evidence required in transcript

- Mobile screenshots before send, during/after response, and after any compact control menu is opened.
- Desktop chat screenshot showing split-pane behavior still works.
- Streaming evidence from UI text/timestamps, or a clear explanation if the configured real provider returned a single final chunk and which lower-level streaming contract remains covered.
- Mandatory command exit codes and last ~10 lines.

## Notes

- Do not fake the chat path to make mobile evidence pass. It is acceptable to create app/chat records through existing Local Web RPC helpers.
- Respect Jotai ownership rules: chat messages/streaming state are already entity-keyed; do not add singleton streaming booleans.
- Keep visible strings concise; do not add explanatory product copy about responsiveness or keyboard shortcuts.

---

The agent will, during execution, print SUPERGOAL_PHASE_START (above),
do the work, then print SUPERGOAL_PHASE_VERIFY, MEMORY_SAVED, and
SUPERGOAL_PHASE_DONE in order. On failure, the agent follows the
3-strike recovery protocol in .supergoal/PROTOCOL.md without further
instruction needed here.
