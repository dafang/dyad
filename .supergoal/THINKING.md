# Local Web GitHub, Supabase, and Neon Parity Thinking

## Goals

- Make Local Web integration buttons and panels usable for GitHub, Supabase, and Neon without depending on Electron deep-link-only behavior.
- Preserve Electron behavior by moving reusable logic into shared services and keeping Electron handlers as thin wrappers.
- Use real provider APIs and local credentials for verification where available; do not introduce fake-only success paths that hide broken wiring.
- Keep secrets out of source, logs, screenshots, and test artifacts.

## Constraints

- Current branch is `feature/web-portal`; keep work on this branch.
- Existing app is Electron-first with contract-driven IPC under `src/ipc/types/*`; Local Web bridges the same contracts over HTTP RPC and SSE.
- Local Web settings store persists secrets as plaintext locally by design, while Electron settings may use `safeStorage`; shared code must be careful about settings write merges.
- Supabase and Neon OAuth return handlers currently assume Electron/deep-link behavior; Local Web v1 should provide a browser-friendly/manual credential path instead of requiring deep links.
- Neon project creation/linking mutates app files (`.env.local`, Nitro setup) and app DB rows, so rollback and path resolution are part of correctness.

## Risks

1. **GitHub connect appears idle because device-flow events never reach the browser.** Mitigation: implement Local Web GitHub service with `createLocalWebIpcEvent`/SSE event emissions and add tests proving `github:flow-update|success|error` publish.
2. **Manual Supabase/Neon credentials break refresh assumptions.** Mitigation: explicitly support non-refreshable local tokens/API keys and classify expired/missing refresh token paths as auth/precondition errors with actionable UI copy.
3. **Extracting Neon/GitHub logic can regress Electron.** Mitigation: keep Electron handler contracts intact, add service-level unit tests, and run targeted existing handler/service tests plus `npm run ts`/`npm run build:web`.

## Dependencies

- Phase 1 must characterize current gaps before extraction so tests fail for the right reasons.
- GitHub service extraction should land before UI smoke because GitHub's existing device flow depends on events, not just invoke/response.
- Supabase and Neon credential UX can reuse settings persistence, but may require small dedicated RPC helpers if raw `settings.setUserSettings` is too broad for good UX.
- Neon Local Web implementation depends on `LocalWebPathResolver.getDyadAppPath` so file mutations hit the correct app directory.

## Open Questions Already Assumed

- Local Web v1 can use manual Supabase token/PAT and Neon API key/access token entry instead of full hosted OAuth callback.
- GitHub should use device flow because it is browser/local-server friendly and already matches the UI model.
- We should not add cloud portal multi-tenant account sync in this task.

## Memory Hits Applied

- `project_local_web_parity`: favor real E2E/smoke when credentials exist; fake-only tests are insufficient.
- `project_local_web_visual_editing_adapter`: extract Electron-free service and inject dependencies from Electron/Local Web wrappers.
- `project_local_web_theme_generation`: Local Web services should return typed `DyadError` failures and should avoid committing provider secrets.

## Tools And Skills Relied On

- Supergoal planning workflow.
- Local repository source, tests, and shell commands.
- No current-doc MCP was detected; implementation should verify provider behavior with real API calls when credentials are provided via environment/local settings.

## Best Practices Applied

- Preserve existing IPC contracts unless a new contract is materially better than overloading settings writes.
- Use TanStack Query invalidation patterns already present in `useSupabase` and `useNeon`.
- Treat user/environment failures as `DyadErrorKind.Auth`, `Precondition`, `Validation`, or `External` rather than generic bugs.
- Avoid logging credentials; smoke scripts may print only host/model/provider/token-present metadata.
