# Stack context

_Generated 2026-06-15 17:25:37_

## Language signals

- **Node/JS/TS** — package.json present
  - Name: `dyad`, version: `1.3.0`
  - Top dependencies: @ai-sdk/amazon-bedrock, @ai-sdk/anthropic, @ai-sdk/azure, @ai-sdk/google, @ai-sdk/google-vertex, @ai-sdk/mcp, @ai-sdk/openai, @ai-sdk/openai-compatible, @ai-sdk/provider-utils, @ai-sdk/xai, @babel/parser, @base-ui/react, @biomejs/biome, @dyad-sh/supabase-management-js, @electron-forge/cli

## Package manager

- **npm** (package-lock.json)

## Likely commands

From package.json scripts:

- `bump` → `node scripts/bump-version.mjs`
- `clean` → `rimraf out scaffold/node_modules`
- `start` → `electron-forge start`
- `dev` → `cross-env NODE_ENV=development npm start`
- `dev:engine` → `cross-env DYAD_ENGINE_URL=http://localhost:8080/v1 npm start`
- `dev:web` → `cross-env NODE_ENV=development npx vite-node --config vite.main.config.mts scripts/start-local-web-dev.ts`
- `dev:local-web` → `npm run dev:web`
- `start:web` → `npm run dev:web`
- `build:web` → `vite build --config vite.web.config.mts`
- `staging:engine` → `cross-env DYAD_ENGINE_URL=https://staging---dyad-llm-engine-kq7pivehnq-uc.a.run.app/v1 npm start`
- `package` → `npm run clean && electron-forge package`
- `make` → `npm run clean && electron-forge make`
- `publish` → `npm run clean && electron-forge publish`
- `verify-release` → `node scripts/verify-release-assets.js`
- `ts` → `npm run ts:main && npm run ts:workers`
- `ts:main` → `npx tsgo -p tsconfig.app.json --noEmit --incremental`
- `ts:workers` → `npx tsc -p workers/tsc/tsconfig.json --noEmit --incremental`
- `lint` → `npx oxlint --fix`
- `lint:fix` → `npx oxlint --fix --fix-suggestions --fix-dangerously`
- `db:generate` → `drizzle-kit generate`
- `db:push` → `drizzle-kit push`
- `db:studio` → `drizzle-kit studio`
- `fmt:check` → `npx oxfmt --check`
- `fmt` → `npx oxfmt`
- `presubmit` → `npm run fmt:check && npm run lint`

## Git

- Branch: `feature/web-portal`
- Remote: https://ghfast.top/https://github.com/dyad-sh/dyad.git
- Working tree: 25 files changed

## Test / lint heuristics

- Has script: `build`
- Has script: `test`
- Has script: `lint`
- Has script: `dev`
- Has script: `start`
- TypeScript present (tsconfig.json)

_End stack context._
