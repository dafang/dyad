# Repo map

_Generated 2026-06-12 19:51:56_

## Top-level layout

- AGENTS.md
- CLA.md
- CLAUDE.md
- CONTRIBUTING.md
- LICENSE
- NOTICE
- README.md
- SECURITY.md
- assets
- biome.json
- components.json
- dist-web
- docs
- dogfood-output
- drizzle
- drizzle.config.ts
- e2e-tests
- forge.config.ts
- forge.env.d.ts
- index.html
- lint-staged.config.js
- makers
- merge.config.ts
- node_modules
- out
- package-lock.json
- package.json
- packages
- plans
- playwright-report
- playwright.config.ts
- rules
- scaffold
- scripts
- shared
- src
- test-results
- testing
- tools
- tsconfig.app.json

## Source directories (depth 2)

### `src/`

- src/supabase_admin
- src/atoms
- src/contexts
- src/app
- src/pro
- src/pro/ui
- src/pro/shared
- src/pro/main
- src/test
- src/constants
- src/runtime
- src/paths
- src/server
- src/utils
- src/shared
- src/shared/**snapshots**
- src/styles
- src/components
- src/components/ui
- src/components/settings
- src/components/home
- src/components/chat
- src/components/media-library
- src/components/preview_panel
- src/neon_admin
- src/**tests**
- src/**tests**/evals
- src/hooks
- src/lib
- src/prompts

### `packages/`

- packages/@dyad-sh
- packages/@dyad-sh/nextjs-webpack-component-tagger
- packages/@dyad-sh/react-vite-component-tagger
- packages/pg-schema-classifier
- packages/pg-schema-classifier/test
- packages/pg-schema-classifier/src
- packages/ts-pg-schema-diff
- packages/ts-pg-schema-diff/test
- packages/ts-pg-schema-diff/src

## File counts (top extensions)

- `.ts`: 866 files
- `.tsx`: 379 files
- `.md`: 169 files
- `.yml`: 161 files
- `.txt`: 135 files
- `.json`: 111 files
- `.sql`: 34 files
- `.js`: 18 files
- `.mjs`: 12 files
- `.svg`: 10 files

## Largest source files (top 15 by line count)

- `e2e-tests/fixtures/titanic-large.csv` (10001 lines)
- `e2e-tests/snapshots/capacitor.spec.ts_upgraded-capacitor.txt` (7847 lines)
- `e2e-tests/snapshots/copy_app.spec.ts_app.txt` (5890 lines)
- `e2e-tests/snapshots/edit_code.spec.ts_edited-mde-with-dyad.txt` (5857 lines)
- `packages/ts-pg-schema-diff/test/integration.test.ts` (4973 lines)
- `src/prompts/__snapshots__/neon_prompt.test.ts.snap` (4189 lines)
- `src/pro/main/ipc/handlers/local_agent/local_agent_handler.test.ts` (2278 lines)
- `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` (2267 lines)
- `src/ipc/handlers/chat_stream_handlers.ts` (2238 lines)
- `assets/icon/logo.icns` (2050 lines)
- `src/components/preview_panel/PreviewIframe.tsx` (1990 lines)
- `src/ipc/handlers/app_handlers.ts` (1975 lines)
- `packages/ts-pg-schema-diff/src/generators/schema.ts` (1755 lines)
- `src/ipc/utils/git_utils.ts` (1676 lines)
- `src/components/chat/ChatInput.tsx` (1662 lines)

## Test surface

- Directories named `test`: 40
- Directories named `tests`: 6
- Directories named `__tests__`: 19
- Directories named `spec`: 1
- Test files (by name pattern): 730

## Notable config / infra

- `.eslintrc.json`
- `.github/workflows`
- `.prettierrc`
- `drizzle.config.ts`
- `playwright.config.ts`
- `tsconfig.json`
- `vitest.config.ts`

## Recent activity (last 10 commits)

- `90854928` 2026-06-09 feat(telemetry): capture and report native crashes via Crashpad (#3614)
- `31bae4d6` 2026-06-08 Show release notes when restoring chat on startup (#3616)
- `6f50c815` 2026-06-08 chore: remove session debug skill (#3615)
- `37e61d4b` 2026-06-06 fix(preview): rewrite Set-Cookie to SameSite=None in the proxy (#3592)
- `535a6163` 2026-06-05 Pin release tag during dispatch (#3604)
- `5a4d1553` 2026-06-05 Fix plan acceptance wrong-app race (#3601)
- `7d06d9e0` 2026-06-05 Show rename dialog on app blueprint name conflict (#3593)
- `61c6d2c5` 2026-06-05 Improve bump version (#3603)
- `c26db445` 2026-06-05 Bump to v1.3.0 (#3602)
- `9de6dbac` 2026-06-05 Fix failing e2e tests (#3599)

## Files churned in last 20 commits (top 10)

- `package.json` (3×)
- `src/pro/main/ipc/handlers/local_agent/local_agent_handler.test.ts` (2×)
- `src/lib/windows_signing.test.ts` (2×)
- `src/ipc/utils/sandbox/sandbox.test.ts` (2×)
- `src/ipc/utils/sandbox/limits.ts` (2×)
- `src/ipc/utils/git_utils.test.ts` (2×)
- `src/hooks/usePlanEvents.ts` (2×)
- `rules/native-modules.md` (2×)
- `forge.config.ts` (2×)
- `e2e-tests/snapshots/local_agent_persistent_todos.spec.ts_local-agent---persistent-todos-across-turns-1.aria.yml` (2×)

_End repo map._
