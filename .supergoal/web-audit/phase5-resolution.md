# Phase 5 Resolution: Local Web Parity Gaps

Date: 2026-06-11
Input report: `.supergoal/web-audit/phase4-report.json`

## Summary

- Fixed: 4
- Reclassified: 0
- Deferred: 0
- Remaining product bugs in latest Phase 4 audit: 0
- Remaining unregistered/failed Local Web RPCs: 0
- Remaining uncaught page errors: 0

## Fixed Issues

1. Preview panel restored from a persisted collapsed layout
   - Evidence: earlier Phase 4 reports showed preview toolbar clicks intercepted by `#chat-panel[data-panel-size="100.0"]`.
   - Fix: opening preview now restores chat/preview panels to a visible 50/50 split when persisted layout leaves preview too small.
   - Owner: `src/pages/chat.tsx`.

2. Preview overflow modes were not exercised through the visible Web UI path
   - Evidence: configure, problems, and security moved under the toolbar overflow menu at compact widths.
   - Fix: Phase 4 audit now opens `preview-mode-overflow-button` before clicking overflow-only modes, matching the existing E2E page-object behavior.
   - Owner: `.supergoal/web-audit/phase4-core-pages-audit.mjs`.

3. Background Local Web RPC aborts surfaced as user-facing console errors during route/page teardown
   - Evidence: Phase 4 captured `run-app net::ERR_ABORTED` as `Error running app ... Failed to fetch` during rapid visible page traversal.
   - Fix: HTTP IPC transport now wraps browser fetch aborts in `HttpInvokeAbortError`; automatic preview startup and Node setup probes ignore aborted background calls while preserving real HTTP/RPC failures.
   - Owners: `src/ipc/contracts/core.ts`, `src/hooks/useRunApp.ts`, `src/components/SetupBanner.tsx`.

4. Settings switches emitted Base UI uncontrolled-to-controlled warnings
   - Evidence: raw console showed Base UI Switch controlled-state warnings on Settings.
   - Fix: optional setting-backed switches now pass stable boolean `checked` values.
   - Owners: `src/components/AutoApproveSwitch.tsx`, `src/components/AutoFixProblemsSwitch.tsx`, `src/components/AutoExpandPreviewSwitch.tsx`, `src/components/KeepPreviewsRunningSwitch.tsx`, `src/components/settings/ProviderSettingsPage.tsx`.

## Latest Audit Classification

Latest `.supergoal/web-audit/phase4-report.json` counts:

- `productBug`: 0
- `unsupportedByDesign`: 0
- `externalSetup`: 0
- `ignoredNoise`: 9
- `rawFailures.rpcFailures`: 0
- `rawFailures.pageErrors`: 0

The ignored noise is limited to external telemetry/network aborts that do not block Local Web functionality.
