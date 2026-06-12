---
name: project_local_web_mobile_responsive
description: Responsive Local Web shell, chat, preview, and verification pattern for Dyad.
metadata:
  type: project
---

# Dyad Local Web Mobile Responsive Notes

- Mobile Local Web should use a single active chat or preview pane instead of trying to preserve the desktop split-pane at narrow widths. Keep desktop `react-resizable-panels` behavior separate.
- Touch sidebar activation must not depend on hover. Rail taps should explicitly open the relevant panel or close non-panel items.
- Preview iframes in Local Web should continue through the existing `/api/preview/:appId/` proxy path, including public URL cases; do not add tunnel-provider-specific product branches.
- Mobile Web E2E should launch a real mobile browser context against the same Local Web server, send/observe a real provider chat response, switch to preview, verify iframe body text, record route overflow metrics, and assert accessible names for send, preview switch, back-to-chat, and preview controls.
- Keep generated audit scripts under `.supergoal/` free to print JSON evidence, but final product diff review should distinguish those evidence logs from app-code debug logs.
