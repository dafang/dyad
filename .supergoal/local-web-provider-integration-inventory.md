# Local Web Provider Integration Inventory

Generated during Supergoal phase 1 for GitHub, Supabase, and Neon Local Web parity.

## Current Boundary

- Contracts are already exposed by `src/server/local_web_rpc_registry.ts` and allowed by `LOCAL_WEB_RPC_ALLOWLIST`.
- Default Local Web behavior lives in `src/ipc/services/default_local_web_integration_service.ts`.
- Electron behavior currently lives in:
  - `src/ipc/handlers/github_handlers.ts`
  - `src/ipc/handlers/supabase_handlers.ts`
  - `src/ipc/handlers/neon_handlers.ts`
- Local Web event transport is available through `src/server/local_web_ipc_event.ts` and `src/server/local_event_stream.ts`.

## GitHub

| Local Web method                                                                                 | Current status           | Target service/dependency                                   | Touches                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------- | ------------------------------------------------- |
| `startGithubFlow`                                                                                | unsupported precondition | shared GitHub device-flow service with Local Web SSE sender | credentials, external network, events             |
| `listGithubRepos`                                                                                | auth-gated empty list    | shared GitHub API service                                   | credentials, external network                     |
| `getGithubRepoBranches`                                                                          | auth-gated empty list    | shared GitHub API service                                   | credentials, external network                     |
| `isGithubRepoAvailable`                                                                          | optimistic stub          | shared GitHub API service                                   | credentials, external network                     |
| `createGithubRepo`                                                                               | unsupported precondition | shared GitHub repo/link service                             | credentials, app DB, git remote, external network |
| `connectExistingGithubRepo`                                                                      | unsupported precondition | shared GitHub repo/link service                             | credentials, app DB, git remote, external network |
| `pushGithub` / `fetchGithub` / `pullGithub` / `rebaseGithub`                                     | unsupported precondition | shared GitHub git operation service                         | credentials, app files, external network          |
| `abortGithubRebase` / `abortGithubMerge` / `continueGithubRebase`                                | unsupported precondition | shared Git operation service                                | app files                                         |
| `listLocalGitBranches`                                                                           | empty stub               | shared Git operation service with `LocalWebPathResolver`    | app files                                         |
| `listRemoteGitBranches`                                                                          | empty stub               | shared Git operation service                                | credentials, app files, external network          |
| `createGitBranch` / `switchGitBranch` / `deleteGitBranch` / `renameGitBranch` / `mergeGitBranch` | unsupported precondition | shared Git operation service                                | app files                                         |
| `getGitConflicts`                                                                                | empty stub               | shared Git operation service                                | app files                                         |
| `getGitState`                                                                                    | false-state stub         | shared Git operation service                                | app files                                         |
| `disconnectGithubRepo`                                                                           | unsupported precondition | shared GitHub repo/link service                             | app DB, git remote                                |
| `listGithubCollaborators`                                                                        | auth-gated empty list    | shared GitHub API service                                   | credentials, external network                     |
| `inviteGithubCollaborator` / `removeGithubCollaborator`                                          | unsupported precondition | shared GitHub API service                                   | credentials, external network                     |
| `cloneGithubRepoFromUrl`                                                                         | error-return stub        | shared clone/import service                                 | credentials, app DB, app files, external network  |
| `getGitUncommittedFiles`                                                                         | empty stub               | shared Git operation service                                | app files                                         |
| `commitGitChanges` / `discardGitChanges`                                                         | unsupported precondition | shared Git operation service                                | app files                                         |

## Supabase

| Local Web method             | Current status           | Target service/dependency                         | Touches                                     |
| ---------------------------- | ------------------------ | ------------------------------------------------- | ------------------------------------------- |
| `listSupabaseOrganizations`  | empty stub               | shared Supabase management service                | credentials, external network               |
| `deleteSupabaseOrganization` | unsupported precondition | shared Supabase settings/service                  | credentials/settings                        |
| `listSupabaseProjects`       | empty stub               | shared Supabase management service                | credentials, external network               |
| `listSupabaseBranches`       | empty stub               | shared Supabase management service                | credentials, external network               |
| `getSupabaseEdgeLogs`        | empty stub               | shared Supabase management service                | credentials, external network, runtime logs |
| `setSupabaseAppProject`      | unsupported precondition | shared Supabase app binding service               | app DB                                      |
| `unsetSupabaseAppProject`    | unsupported precondition | shared Supabase app binding service               | app DB                                      |
| `fakeConnectSupabaseProject` | unsupported precondition | test-only only; do not use for production success | settings, app DB                            |

## Neon

| Local Web method                | Current status           | Target service/dependency                                | Touches                                             |
| ------------------------------- | ------------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| `createNeonProject`             | unsupported precondition | shared Neon project service with Local Web path resolver | credentials, app DB, app files, external network    |
| `getNeonProject`                | unsupported precondition | shared Neon project service                              | credentials, app DB, external network               |
| `listNeonProjects`              | empty stub               | shared Neon management service                           | credentials, external network                       |
| `setNeonAppProject`             | unsupported precondition | shared Neon project binding service                      | app DB, app files, external network                 |
| `unsetNeonAppProject`           | optimistic success stub  | shared Neon unlink/env cleanup service                   | app DB, app files, optional Vercel external network |
| `setNeonActiveBranch`           | unsupported precondition | shared Neon branch/env service                           | app DB, app files, external network                 |
| `getNeonEmailPasswordConfig`    | unsupported precondition | shared Neon auth config service                          | credentials, external network                       |
| `updateNeonEmailVerification`   | unsupported precondition | shared Neon auth config service                          | credentials, external network                       |
| `fakeConnectNeon`               | unsupported precondition | test-only only; do not use for production success        | settings                                            |
| `getNeonBranchEnvVars`          | unsupported precondition | shared Neon env var resolver                             | credentials, app DB, external network               |
| `setSelectedDatabaseBranchType` | optimistic success stub  | shared app DB setting service                            | app DB                                              |

## Production Rule

Fake connect contracts remain test-only compatibility surfaces. Production Local Web success must come from real stored credentials, real provider APIs, or a classified `DyadError` explaining why the operation cannot proceed.
