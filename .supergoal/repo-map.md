# Repo map

_Generated 2026-06-15 17:25:37_

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

- `.ts`: 943 files
- `.tsx`: 383 files
- `.md`: 205 files
- `.json`: 188 files
- `.yml`: 161 files
- `.txt`: 136 files
- `.png`: 104 files
- `.sql`: 34 files
- `.mjs`: 24 files
- `.js`: 18 files

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
- `src/components/preview_panel/PreviewIframe.tsx` (2021 lines)
- `src/ipc/handlers/app_handlers.ts` (1975 lines)
- `packages/ts-pg-schema-diff/src/generators/schema.ts` (1755 lines)
- `src/ipc/utils/git_utils.ts` (1676 lines)
- `src/server/local_web_rpc_registry.test.ts` (1675 lines)

## Test surface

- Directories named `test`: 40
- Directories named `tests`: 6
- Directories named `__tests__`: 19
- Directories named `spec`: 1
- Test files (by name pattern): 735

## Notable config / infra

- `.eslintrc.json`
- `.github/workflows`
- `.prettierrc`
- `drizzle.config.ts`
- `playwright.config.ts`
- `tsconfig.json`
- `vitest.config.ts`

## Recent activity (last 10 commits)

- `51612577` 2026-06-15 Complete local web portal parity
- `859f50ae` 2026-06-13 Keep hide-menu URL query unquoted
- `e832b049` 2026-06-13 Support hide-menu chat URLs
- `3bb98db6` 2026-06-13 Hide Dyad Pro prompts in local web UI
- `d37ad5ad` 2026-06-12 Resolve scaffold path for local web templates
- `3eda5b55` 2026-06-12 Handle lenient app blueprint visuals
- `1d844a53` 2026-06-12 feat: add local web portal runtime
- `90854928` 2026-06-09 feat(telemetry): capture and report native crashes via Crashpad (#3614)
- `31bae4d6` 2026-06-08 Show release notes when restoring chat on startup (#3616)
- `6f50c815` 2026-06-08 chore: remove session debug skill (#3615)

## Files churned in last 20 commits (top 10)

- `src/pages/settings.tsx` (4×)
- `src/pages/home.tsx` (4×)
- `src/app/layout.tsx` (4×)
- `src/lib/settingsSearchIndex.ts` (3×)
- `src/hooks/usePlanEvents.ts` (3×)
- `src/components/settings/ProviderSettingsPage.tsx` (3×)
- `src/components/preview_panel/PreviewIframe.tsx` (3×)
- `src/components/chat/DyadAppBlueprintCard.tsx` (3×)
- `src/components/chat/ChatInput.tsx` (3×)
- `src/components/SetupBanner.tsx` (3×)

_End repo map._
