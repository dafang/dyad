---
name: project_local_web_parity
description: Lessons from stabilizing Dyad Local Web parity with real provider E2E coverage.
metadata:
  type: project
---

# Dyad Local Web Parity Notes

- Real Web chat parity should be verified with a real OpenAI-compatible provider, sourced from explicit env or Codex config, and artifacts must only record host/model/key-present.
- Local Web stream invokes can complete before the browser receives `chat:response:end`; `useStreamChat` needs a DB sync fallback after invoke completion, while normal SSE terminal events keep priority.
- `createStreamClient.start()` may return the invoke promise for Local Web fallbacks, but invoke failures should dispatch `onError` and resolve to `"error"` so existing fire-and-forget stream callers do not create unhandled rejections.
- When an E2E changes app install/start commands, stop the existing preview first. `run-app` intentionally reuses a running app and will re-emit the existing proxy URL instead of spawning the new command.
- Playwright selector strings like `[data-testid="..."]:visible` inside repo files can be scanned by Tailwind v4 and emitted as invalid production CSS. Build those selectors dynamically in test helpers.
