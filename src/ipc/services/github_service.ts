import fs from "node:fs";
import path from "node:path";
import type { IpcInvokeEventLike } from "@/ipc/utils/ipc_event";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";
import { slugifyAppPath } from "@/shared/slugify";
import {
  gitAddAll,
  gitCheckout,
  gitClone,
  gitCommit,
  gitCreateBranch,
  gitCurrentBranch,
  gitDeleteBranch,
  gitDiscardAllChanges,
  gitFetch,
  gitGetMergeConflicts,
  GitConflictError,
  GIT_ERROR_CODES,
  gitListBranches,
  gitListRemoteBranches,
  gitMerge,
  gitMergeAbort,
  gitPull,
  gitPush,
  gitRebase,
  gitRebaseAbort,
  gitRebaseContinue,
  gitRenameBranch,
  gitSetRemoteUrl,
  getCurrentCommitHash,
  getGitUncommittedFilesWithStatus,
  isGitMergeInProgress,
  isGitRebaseInProgress,
  isGitStatusClean,
  GitStateError,
} from "@/ipc/utils/git_utils";
import type {
  CloneRepoParams,
  CloneRepoResult,
  CommitChangesParams,
  CreateGitBranchParams,
  GitBranchAppIdParams,
  GitBranchParams,
  ListRemoteGitBranchesParams,
  RenameGitBranchParams,
  UncommittedFile,
} from "@/ipc/types/github";
import type { App } from "@/ipc/types/app";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { withLock } from "@/ipc/utils/lock_utils";

export interface GithubServiceSettings {
  readSettings(): UserSettings;
  writeSettings(settings: Partial<UserSettings>): void;
}

export interface GithubServiceAppRecord {
  id: number;
  name: string;
  path: string;
  githubOrg: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
}

export interface GithubServiceAppCreateInput {
  name: string;
  path: string;
  githubOrg: string;
  githubRepo: string;
  githubBranch: string;
  installCommand?: string | null;
  startCommand?: string | null;
}

export interface GithubServiceDeps {
  settings: GithubServiceSettings;
  findAppById(appId: number): Promise<GithubServiceAppRecord | undefined>;
  findAppByName(name: string): Promise<GithubServiceAppRecord | undefined>;
  createApp(input: GithubServiceAppCreateInput): Promise<App>;
  updateAppGithubRepo(params: {
    appId: number;
    org?: string | null;
    repo?: string | null;
    branch?: string | null;
  }): Promise<void>;
  resolveAppPath(appPath: string): string;
  isAppLocationAccessible(resolvedPath: string): boolean;
  fetch: typeof fetch;
  logger?: GithubServiceLogger;
  githubClientId?: string;
  githubDeviceCodeUrl?: string;
  githubAccessTokenUrl?: string;
  githubApiBase?: string;
  githubGitBase?: string;
  isTestBuild?: boolean;
}

export interface GithubServiceLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  log(...args: unknown[]): void;
}

interface DeviceFlowState {
  deviceCode: string;
  interval: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  isPolling: boolean;
}

const noopLogger: GithubServiceLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  log: () => undefined,
};

const GITHUB_SCOPES = "repo,user,workflow";

export class GithubService {
  private currentFlowState: DeviceFlowState | null = null;
  private readonly logger: GithubServiceLogger;
  private readonly githubClientId: string;
  private readonly githubDeviceCodeUrl: string;
  private readonly githubAccessTokenUrl: string;
  private readonly githubApiBase: string;
  private readonly githubGitBase: string;
  private readonly isTestBuild: boolean;

  constructor(private readonly deps: GithubServiceDeps) {
    this.logger = deps.logger ?? noopLogger;
    this.githubClientId =
      deps.githubClientId ??
      process.env.GITHUB_CLIENT_ID ??
      "Ov23liWV2HdC0RBLecWx";
    this.githubDeviceCodeUrl =
      deps.githubDeviceCodeUrl ?? "https://github.com/login/device/code";
    this.githubAccessTokenUrl =
      deps.githubAccessTokenUrl ??
      "https://github.com/login/oauth/access_token";
    this.githubApiBase = deps.githubApiBase ?? "https://api.github.com";
    this.githubGitBase = deps.githubGitBase ?? "https://github.com";
    this.isTestBuild = deps.isTestBuild ?? false;
  }

  normalizeRepoName(repoName: string): string {
    return slugifyAppPath(repoName);
  }

  async getGithubUser(): Promise<{ email: string } | null> {
    const settings = this.deps.settings.readSettings();
    const email = settings.githubUser?.email;
    if (email) return { email };
    try {
      const accessToken = settings.githubAccessToken?.value;
      if (!accessToken) return null;
      const res = await this.deps.fetch(`${this.githubApiBase}/user/emails`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const emails = (await res.json()) as Array<{
        primary?: boolean;
        email?: string;
      }>;
      const primaryEmail = emails.find((item) => item.primary)?.email;
      if (!primaryEmail) return null;

      this.deps.settings.writeSettings({
        githubUser: {
          email: primaryEmail,
        },
      });
      return { email: primaryEmail };
    } catch (err) {
      this.logger.error("[GitHub Service] Failed to get GitHub user:", err);
      return null;
    }
  }

  startFlow(event: IpcInvokeEventLike): void {
    if (this.currentFlowState?.isPolling) {
      this.logger.warn("Another GitHub flow is already in progress.");
      event.sender.send("github:flow-error", {
        error: "Another connection process is already active.",
      });
      return;
    }

    this.currentFlowState = {
      deviceCode: "",
      interval: 5,
      timeoutId: null,
      isPolling: false,
    };

    event.sender.send("github:flow-update", {
      message: "Requesting device code from GitHub...",
    });

    void this.requestDeviceCode(event);
  }

  async listRepos(): Promise<
    { name: string; full_name: string; private: boolean }[]
  > {
    const accessToken = this.requireAccessToken();
    try {
      const response = await this.deps.fetch(
        `${this.githubApiBase}/user/repos?per_page=100&sort=updated`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as any;
        throw new DyadError(
          `GitHub API error: ${errorData.message || response.statusText}`,
          DyadErrorKind.External,
        );
      }

      const repos = (await response.json()) as any[];
      return repos.map((repo) => ({
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
      }));
    } catch (err) {
      if (err instanceof DyadError) throw err;
      this.logger.error("[GitHub Service] Failed to list repos:", err);
      throw new DyadError(
        err instanceof Error
          ? err.message
          : "Failed to list GitHub repositories.",
        DyadErrorKind.External,
      );
    }
  }

  async getRepoBranches({
    owner,
    repo,
  }: {
    owner: string;
    repo: string;
  }): Promise<{ name: string; commit: { sha: string } }[]> {
    const accessToken = this.requireAccessToken();
    try {
      const response = await this.deps.fetch(
        `${this.githubApiBase}/repos/${owner}/${repo}/branches`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as any;
        throw new DyadError(
          `GitHub API error: ${errorData.message || response.statusText}`,
          DyadErrorKind.External,
        );
      }

      const branches = (await response.json()) as any[];
      return branches.map((branch) => ({
        name: branch.name,
        commit: { sha: branch.commit.sha },
      }));
    } catch (err) {
      if (err instanceof DyadError) throw err;
      this.logger.error("[GitHub Service] Failed to get repo branches:", err);
      throw new DyadError(
        err instanceof Error
          ? err.message
          : "Failed to get repository branches.",
        DyadErrorKind.External,
      );
    }
  }

  async isRepoAvailable({
    org,
    repo,
  }: {
    org: string;
    repo: string;
  }): Promise<{ available: boolean; error?: string }> {
    const normalizedRepo = this.normalizeRepoName(repo);
    try {
      const accessToken =
        this.deps.settings.readSettings().githubAccessToken?.value;
      if (!accessToken) {
        return { available: false, error: "Not authenticated with GitHub." };
      }
      const owner =
        org ||
        (await this.deps
          .fetch(`${this.githubApiBase}/user`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .then((response) => response.json() as Promise<{ login?: string }>)
          .then((user) => user.login ?? ""));

      const url = `${this.githubApiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(normalizedRepo)}`;
      const res = await this.deps.fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 404) return { available: true };
      if (res.ok) {
        return { available: false, error: "Repository already exists." };
      }
      const data = (await res.json()) as any;
      return { available: false, error: data.message || "Unknown error" };
    } catch (err) {
      return {
        available: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async createRepo({
    org,
    repo,
    appId,
    branch,
  }: {
    org: string;
    repo: string;
    appId: number;
    branch?: string;
  }): Promise<void> {
    const normalizedRepo = this.normalizeRepoName(repo);
    const accessToken = this.requireAccessToken();
    let owner = org;
    if (!owner) {
      const userRes = await this.deps.fetch(`${this.githubApiBase}/user`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = (await userRes.json()) as { login?: string };
      owner = user.login ?? "";
    }
    const createUrl = org
      ? `${this.githubApiBase}/orgs/${owner}/repos`
      : `${this.githubApiBase}/user/repos`;
    const res = await this.deps.fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name: normalizedRepo,
        private: true,
      }),
    });
    if (!res.ok) {
      throw new DyadError(
        await this.formatGithubError(res, "Failed to create repository"),
        DyadErrorKind.External,
      );
    }

    const remoteUrl = this.buildAuthenticatedRemoteUrl(
      owner,
      normalizedRepo,
      accessToken,
    );
    await this.prepareLocalBranch({
      appId,
      branch,
      remoteUrl,
      accessToken,
    });
    await this.deps.updateAppGithubRepo({
      appId,
      org: owner,
      repo: normalizedRepo,
      branch,
    });
  }

  async connectExistingRepo({
    owner,
    repo,
    branch,
    appId,
  }: {
    owner: string;
    repo: string;
    branch: string;
    appId: number;
  }): Promise<void> {
    const accessToken = this.requireAccessToken();
    try {
      const repoResponse = await this.deps.fetch(
        `${this.githubApiBase}/repos/${owner}/${repo}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      if (!repoResponse.ok) {
        const errorData = (await repoResponse.json()) as { message?: string };
        throw new DyadError(
          `Repository not found or access denied: ${errorData.message}`,
          DyadErrorKind.External,
        );
      }

      const remoteUrl = this.buildAuthenticatedRemoteUrl(
        owner,
        repo,
        accessToken,
      );
      await this.prepareLocalBranch({
        appId,
        branch,
        remoteUrl,
        accessToken,
      });
      await this.deps.updateAppGithubRepo({ appId, org: owner, repo, branch });
    } catch (err) {
      if (err instanceof DyadError) throw err;
      this.logger.error("[GitHub Service] Failed to connect repo:", err);
      throw new DyadError(
        err instanceof Error
          ? err.message
          : "Failed to connect to existing repository.",
        DyadErrorKind.External,
      );
    }
  }

  async push({
    appId,
    force,
    forceWithLease,
  }: {
    appId: number;
    force?: boolean;
    forceWithLease?: boolean;
  }): Promise<void> {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const branch = app.githubBranch || "main";

    await gitSetRemoteUrl({
      path: appPath,
      remoteUrl: this.buildAuthenticatedRemoteUrl(
        app.githubOrg!,
        app.githubRepo!,
        accessToken,
      ),
    });

    if (!force && !forceWithLease) {
      try {
        await gitPull({
          path: appPath,
          remote: "origin",
          branch,
          accessToken,
        });
      } catch (pullError: any) {
        if (pullError?.name === "GitConflictError") {
          throw GitConflictError(
            "Merge conflict detected during pull. Please resolve conflicts before pushing.",
          );
        }
        if (!isMissingRemoteBranchError(pullError)) {
          throw pullError;
        }
        this.logger.debug(
          "[GitHub Service] Remote branch missing during pull, continuing with push",
          pullError?.message,
        );
      }
    }

    await gitPush({
      path: appPath,
      branch,
      accessToken,
      force,
      forceWithLease,
    });
  }

  async fetchFromGithub({ appId }: GitBranchAppIdParams): Promise<void> {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    await gitFetch({
      path: this.deps.resolveAppPath(app.path),
      remote: "origin",
      accessToken,
    });
  }

  async pullFromGithub({ appId }: GitBranchAppIdParams): Promise<void> {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const currentBranch = await gitCurrentBranch({ path: appPath });

    try {
      await gitPull({
        path: appPath,
        remote: "origin",
        branch: currentBranch || "main",
        accessToken,
      });
    } catch (pullError) {
      if (!isMissingRemoteBranchError(pullError)) {
        throw pullError;
      }
      this.logger.debug(
        "[GitHub Service] Remote branch missing during pull, continuing",
        pullError instanceof Error ? pullError.message : pullError,
      );
    }
  }

  async rebase({ appId }: GitBranchAppIdParams): Promise<void> {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const branch = app.githubBranch || "main";

    await gitSetRemoteUrl({
      path: appPath,
      remoteUrl: this.buildAuthenticatedRemoteUrl(
        app.githubOrg!,
        app.githubRepo!,
        accessToken,
      ),
    });
    await gitFetch({ path: appPath, remote: "origin", accessToken });
    await withLock(appId, async () => {
      await this.ensureCleanWorkspace(appPath, "rebase");
    });
    await gitRebase({ path: appPath, branch });
  }

  async abortRebase({ appId }: GitBranchAppIdParams): Promise<void> {
    const appPath = await this.requireAppPath(appId);
    await gitRebaseAbort({ path: appPath });
  }

  async continueRebase({ appId }: GitBranchAppIdParams): Promise<void> {
    const appPath = await this.requireAppPath(appId);
    await gitRebaseContinue({ path: appPath });
  }

  async abortMerge({ appId }: GitBranchAppIdParams): Promise<void> {
    const appPath = await this.requireAppPath(appId);
    await gitMergeAbort({ path: appPath });
  }

  async createBranch({
    appId,
    branch,
    from,
  }: CreateGitBranchParams): Promise<void> {
    validateBranchName(branch);
    const appPath = await this.requireAppPath(appId);
    await gitCreateBranch({ path: appPath, branch, from });
  }

  async deleteBranch({ appId, branch }: GitBranchParams): Promise<void> {
    const app = await this.requireApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const localBranches = await gitListBranches({ path: appPath });
    if (localBranches.includes(branch)) {
      await gitDeleteBranch({ path: appPath, branch });
      return;
    }

    let remoteBranches: string[];
    try {
      remoteBranches = await gitListRemoteBranches({ path: appPath });
    } catch (error) {
      this.logger.warn(
        `Failed to list remote branches while checking branch '${branch}'.`,
        error,
      );
      throw new DyadError(
        `Branch '${branch}' does not exist locally and remote branches could not be checked. Please try again later.`,
        DyadErrorKind.Conflict,
      );
    }

    if (!remoteBranches.includes(branch)) return;

    if (app.githubOrg && app.githubRepo) {
      throw new DyadError(
        `Branch '${branch}' only exists on the remote. To delete it, please delete the branch on GitHub directly. Visit https://github.com/${app.githubOrg}/${app.githubRepo}/branches to manage remote branches.`,
        DyadErrorKind.Conflict,
      );
    }
    throw new DyadError(
      `Branch '${branch}' only exists on the remote and cannot be deleted locally. Please delete it from your remote Git hosting provider.`,
      DyadErrorKind.Conflict,
    );
  }

  async switchBranch({ appId, branch }: GitBranchParams): Promise<void> {
    const app = await this.requireApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    this.assertNoGitOperationInProgress(appPath, "switch branches");
    await withLock(appId, async () => {
      await this.ensureCleanWorkspace(
        appPath,
        `switching to branch '${branch}'`,
      );
    });

    try {
      await gitCheckout({ path: appPath, ref: branch });
    } catch (checkoutError: any) {
      if (isLocalChangesError(checkoutError)) {
        throw new DyadError(
          `Failed to switch branch: uncommitted changes detected. ` +
            "Please commit or stash your changes manually and try again.",
          DyadErrorKind.Conflict,
        );
      }
      throw checkoutError;
    }

    await this.deps.updateAppGithubRepo({
      appId,
      org: app.githubOrg,
      repo: app.githubRepo,
      branch,
    });
  }

  async renameBranch({
    appId,
    oldBranch,
    newBranch,
  }: RenameGitBranchParams): Promise<void> {
    const app = await this.requireApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const currentBranch = await gitCurrentBranch({ path: appPath });
    const isRenamingCurrentBranch = currentBranch === oldBranch;
    await gitRenameBranch({ path: appPath, oldBranch, newBranch });
    if (isRenamingCurrentBranch) {
      await this.deps.updateAppGithubRepo({
        appId,
        org: app.githubOrg,
        repo: app.githubRepo,
        branch: newBranch,
      });
    }
  }

  async mergeBranch({ appId, branch }: GitBranchParams): Promise<void> {
    const app = await this.requireApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const localBranches = await gitListBranches({ path: appPath });
    let remoteBranches: string[] = [];
    try {
      remoteBranches = await gitListRemoteBranches({ path: appPath });
    } catch (error) {
      this.logger.warn("Failed to list remote branches:", error);
    }

    const mergeBranchRef =
      !localBranches.includes(branch) && remoteBranches.includes(branch)
        ? `origin/${branch}`
        : branch;

    await withLock(appId, async () => {
      await this.ensureCleanWorkspace(appPath, `merging branch '${branch}'`);
    });
    try {
      await gitMerge({ path: appPath, branch: mergeBranchRef });
    } catch (mergeError: any) {
      if (mergeError?.name === "GitConflictError") {
        throw new MergeConflictError(mergeError.message);
      }
      if (isLocalChangesError(mergeError)) {
        throw new DyadError(
          `Failed to merge branch: uncommitted changes detected. ` +
            "Please commit or stash your changes manually and try again.",
          DyadErrorKind.Conflict,
        );
      }
      throw mergeError;
    }
  }

  async listLocalBranches({ appId }: GitBranchAppIdParams): Promise<{
    branches: string[];
    current: string | null;
  }> {
    const appPath = await this.requireAppPath(appId);
    const branches = await gitListBranches({ path: appPath });
    const current = await gitCurrentBranch({ path: appPath });
    return { branches, current: current || null };
  }

  async listRemoteBranches({
    appId,
    remote = "origin",
  }: ListRemoteGitBranchesParams): Promise<string[]> {
    const appPath = await this.requireAppPath(appId);
    return gitListRemoteBranches({ path: appPath, remote });
  }

  async getUncommittedFiles({
    appId,
  }: GitBranchAppIdParams): Promise<UncommittedFile[]> {
    const appPath = await this.requireAppPath(appId);
    return getGitUncommittedFilesWithStatus({ path: appPath });
  }

  async commitChanges({
    appId,
    message,
  }: CommitChangesParams): Promise<string> {
    return this.withAppGitOp(appId, "commit", async (appPath) => {
      await ensureDyadGitignored(appPath);
      await gitAddAll({ path: appPath });
      return gitCommit({ path: appPath, message });
    });
  }

  async discardChanges({ appId }: GitBranchAppIdParams): Promise<void> {
    await this.withAppGitOp(appId, "discard changes", async (appPath) => {
      await gitDiscardAllChanges({ path: appPath });
    });
  }

  async getConflicts({ appId }: GitBranchAppIdParams): Promise<string[]> {
    const appPath = await this.requireAppPath(appId);
    return gitGetMergeConflicts({ path: appPath });
  }

  async getGitState({ appId }: GitBranchAppIdParams): Promise<{
    mergeInProgress: boolean;
    rebaseInProgress: boolean;
  }> {
    const appPath = await this.requireAppPath(appId);
    return {
      mergeInProgress: isGitMergeInProgress({ path: appPath }),
      rebaseInProgress: isGitRebaseInProgress({ path: appPath }),
    };
  }

  async disconnectRepo({ appId }: GitBranchAppIdParams): Promise<void> {
    await this.requireApp(appId);
    await this.deps.updateAppGithubRepo({
      appId,
      org: null,
      repo: null,
      branch: null,
    });
  }

  async listCollaborators({
    appId,
  }: GitBranchAppIdParams): Promise<
    { login: string; avatar_url: string; permissions: any }[]
  > {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    try {
      const response = await this.deps.fetch(
        `${this.githubApiBase}/repos/${app.githubOrg}/${app.githubRepo}/collaborators`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (!response.ok) {
        throw new DyadError(
          `Failed to list collaborators: ${response.status} ${response.statusText}`,
          DyadErrorKind.External,
        );
      }
      const collaborators = (await response.json()) as any[];
      return collaborators.map((collaborator) => ({
        login: collaborator.login,
        avatar_url: collaborator.avatar_url,
        permissions: collaborator.permissions,
      }));
    } catch (err) {
      if (err instanceof DyadError) throw err;
      this.logger.error("[GitHub Service] Failed to list collaborators:", err);
      throw new DyadError(
        err instanceof Error ? err.message : "Failed to list collaborators.",
        DyadErrorKind.External,
      );
    }
  }

  async inviteCollaborator({
    appId,
    username,
  }: {
    appId: number;
    username: string;
  }): Promise<void> {
    const trimmedUsername = validateGithubUsername(username);
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    const response = await this.deps.fetch(
      `${this.githubApiBase}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(trimmedUsername)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ permission: "push" }),
      },
    );
    if (!response.ok) {
      const data = (await response.json()) as { message?: string };
      throw new DyadError(
        data.message ||
          `Failed to invite collaborator: ${response.status} ${response.statusText}`,
        DyadErrorKind.External,
      );
    }
  }

  async removeCollaborator({
    appId,
    username,
  }: {
    appId: number;
    username: string;
  }): Promise<void> {
    const accessToken = this.requireAccessToken();
    const app = await this.requireLinkedGithubApp(appId);
    const response = await this.deps.fetch(
      `${this.githubApiBase}/repos/${app.githubOrg}/${app.githubRepo}/collaborators/${encodeURIComponent(username)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) {
      const data = (await response.json()) as { message?: string };
      throw new DyadError(
        data.message ||
          `Failed to remove collaborator: ${response.status} ${response.statusText}`,
        DyadErrorKind.External,
      );
    }
  }

  async cloneRepoFromUrl(params: CloneRepoParams): Promise<CloneRepoResult> {
    const { url, installCommand, startCommand, appName } = params;
    try {
      const settings = this.deps.settings.readSettings();
      const accessToken = settings.githubAccessToken?.value;
      const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!match) {
        return {
          error:
            "Invalid GitHub URL. Expected format: https://github.com/owner/repo.git",
        };
      }
      const [, owner, repoName] = match;
      if (accessToken) {
        const repoResponse = await this.deps.fetch(
          `${this.githubApiBase}/repos/${owner}/${repoName}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/vnd.github+json",
            },
          },
        );
        if (!repoResponse.ok) {
          return {
            error: "Repository not found or you do not have access to it.",
          };
        }
      }
      const finalAppName = appName?.trim() ? appName.trim() : repoName;
      const existingApp = await this.deps.findAppByName(finalAppName);
      if (existingApp) {
        return { error: `An app named "${finalAppName}" already exists.` };
      }

      const appPath = this.deps.resolveAppPath(finalAppName);
      if (!this.deps.isAppLocationAccessible(appPath)) {
        throw new DyadError(
          `The path ${appPath} is inaccessible. Please check your custom apps folder setting.`,
          DyadErrorKind.Precondition,
        );
      }
      if (!settings.enableNativeGit && !fs.existsSync(appPath)) {
        fs.mkdirSync(appPath, { recursive: true });
      }
      const cloneUrl = accessToken
        ? this.buildAuthenticatedRemoteUrl(owner, repoName, accessToken)
        : `https://github.com/${owner}/${repoName}.git`;
      try {
        await gitClone({
          path: appPath,
          url: cloneUrl,
          accessToken,
          singleBranch: false,
        });
      } catch (cloneErr) {
        this.logger.error("[GitHub Service] Clone failed:", cloneErr);
        return {
          error:
            "Failed to clone repository. Please check the URL and try again.",
        };
      }
      const aiRulesPath = path.join(appPath, "AI_RULES.md");
      const hasAiRules = fs.existsSync(aiRulesPath);
      const newApp = await this.deps.createApp({
        name: finalAppName,
        path: finalAppName,
        githubOrg: owner,
        githubRepo: repoName,
        githubBranch: "main",
        installCommand: installCommand || null,
        startCommand: startCommand || null,
      });
      return {
        app: {
          ...newApp,
          files: [],
          supabaseProjectName: null,
          supabaseOrganizationSlug: null,
          vercelTeamSlug: null,
        },
        hasAiRules,
      };
    } catch (err) {
      this.logger.error(
        "[GitHub Service] Unexpected error in clone flow:",
        err,
      );
      return {
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during cloning.",
      };
    }
  }

  async prepareLocalBranch({
    appId,
    branch,
    remoteUrl,
    accessToken,
  }: {
    appId: number;
    branch?: string;
    remoteUrl?: string;
    accessToken?: string;
  }): Promise<void> {
    const app = await this.requireApp(appId);
    const appPath = this.deps.resolveAppPath(app.path);
    const targetBranch = branch || "main";

    try {
      if (remoteUrl) {
        await gitSetRemoteUrl({ path: appPath, remoteUrl });
        if (accessToken) {
          try {
            await gitFetch({ path: appPath, remote: "origin", accessToken });
          } catch (fetchError) {
            this.logger.debug(
              "[GitHub Service] Fetch failed while preparing branch:",
              fetchError,
            );
          }
        }
      }

      await withLock(appId, async () => {
        const isClean = await isGitStatusClean({ path: appPath });
        if (!isClean) {
          if (isGitMergeInProgress({ path: appPath })) {
            throw new DyadError(
              "Cannot auto-commit changes because a merge is in progress. Please complete or abort the merge and try again.",
              DyadErrorKind.Precondition,
            );
          }
          if (isGitRebaseInProgress({ path: appPath })) {
            throw new DyadError(
              "Cannot auto-commit changes because a rebase is in progress. Please complete or abort the rebase and try again.",
              DyadErrorKind.Precondition,
            );
          }
          try {
            await gitAddAll({ path: appPath });
            await gitCommit({
              path: appPath,
              message:
                "chore: auto-commit local changes before connecting to GitHub",
            });
          } catch {
            throw new DyadError(
              "Failed to auto-commit uncommitted changes. Please commit or stash your changes manually and try again.",
              DyadErrorKind.Conflict,
            );
          }
        }

        await this.ensureCleanWorkspace(
          appPath,
          `preparing branch '${targetBranch}'`,
        );
        const localBranches = await gitListBranches({ path: appPath });
        let remoteBranches: string[] = [];
        if (remoteUrl && accessToken) {
          remoteBranches = await gitListRemoteBranches({
            path: appPath,
            remote: "origin",
          });
        }

        if (!localBranches.includes(targetBranch)) {
          if (remoteBranches.includes(targetBranch)) {
            if (this.deps.settings.readSettings().enableNativeGit) {
              await gitCreateBranch({
                path: appPath,
                branch: targetBranch,
                from: `origin/${targetBranch}`,
              });
              await gitCheckout({ path: appPath, ref: targetBranch });
            } else {
              const remoteRef = `refs/remotes/origin/${targetBranch}`;
              let commitSha: string;
              try {
                commitSha = await getCurrentCommitHash({
                  path: appPath,
                  ref: remoteRef,
                });
              } catch {
                commitSha = await getCurrentCommitHash({
                  path: appPath,
                  ref: `origin/${targetBranch}`,
                });
              }
              const previousBranch = await gitCurrentBranch({ path: appPath });
              try {
                await gitCheckout({ path: appPath, ref: commitSha });
                await gitCreateBranch({ path: appPath, branch: targetBranch });
                await gitCheckout({ path: appPath, ref: targetBranch });
              } catch (error) {
                if (previousBranch) {
                  try {
                    await gitCheckout({ path: appPath, ref: previousBranch });
                  } catch (restoreError) {
                    this.logger.error(
                      `Failed to restore branch '${previousBranch}' after error:`,
                      restoreError,
                    );
                  }
                }
                throw error;
              }
            }
          } else {
            await gitCreateBranch({ path: appPath, branch: targetBranch });
            await gitCheckout({ path: appPath, ref: targetBranch });
          }
        } else {
          await gitCheckout({ path: appPath, ref: targetBranch });
        }
      });
    } catch (gitError: any) {
      const errorMessage =
        gitError?.message ||
        "Failed to prepare local branch for the connected repository.";
      if (isLocalChangesError(gitError)) {
        throw new DyadError(
          `Failed to prepare local branch: uncommitted changes detected. Unable to automatically handle uncommitted changes. Please commit or stash your changes manually and try again.`,
          DyadErrorKind.Conflict,
        );
      }
      if (gitError instanceof DyadError) throw gitError;
      throw new DyadError(errorMessage, DyadErrorKind.External);
    }
  }

  private async requestDeviceCode(event: IpcInvokeEventLike): Promise<void> {
    try {
      const response = await this.deps.fetch(this.githubDeviceCodeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.githubClientId,
          scope: GITHUB_SCOPES,
        }),
      });
      if (!response.ok) {
        const errData = (await response.json()) as any;
        throw new DyadError(
          `GitHub API Error: ${errData.error_description || response.statusText}`,
          DyadErrorKind.External,
        );
      }
      const data = (await response.json()) as {
        device_code: string;
        interval?: number;
        user_code: string;
        verification_uri: string;
      };
      if (!this.currentFlowState) return;
      this.currentFlowState.deviceCode = data.device_code;
      this.currentFlowState.interval = data.interval ?? 5;
      this.currentFlowState.isPolling = true;
      event.sender.send("github:flow-update", {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        message: "Please authorize in your browser.",
      });
      this.currentFlowState.timeoutId = setTimeout(
        () => void this.pollForAccessToken(event),
        this.currentFlowState.interval * 1000,
      );
    } catch (error) {
      this.logger.error("Error initiating GitHub device flow:", error);
      event.sender.send("github:flow-error", {
        error: `Failed to start GitHub connection: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      this.stopPolling();
      this.currentFlowState = null;
    }
  }

  private async pollForAccessToken(event: IpcInvokeEventLike): Promise<void> {
    if (!this.currentFlowState?.isPolling) return;
    const { deviceCode, interval } = this.currentFlowState;
    event.sender.send("github:flow-update", {
      message: "Polling GitHub for authorization...",
    });

    try {
      const response = await this.deps.fetch(this.githubAccessTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.githubClientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (response.ok && data.access_token) {
        event.sender.send("github:flow-success", {
          message: "Successfully connected!",
        });
        this.deps.settings.writeSettings({
          githubAccessToken: { value: data.access_token },
        });
        this.stopPolling();
        return;
      }

      if (data.error) {
        this.handlePollError(
          event,
          data.error,
          data.error_description,
          interval,
        );
        return;
      }

      throw new DyadError(
        `Unknown response structure: ${JSON.stringify(data)}`,
        DyadErrorKind.External,
      );
    } catch (error) {
      this.logger.error("Error polling for GitHub access token:", error);
      event.sender.send("github:flow-error", {
        error: `Network or unexpected error during polling: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      this.stopPolling();
    }
  }

  private handlePollError(
    event: IpcInvokeEventLike,
    error: string,
    errorDescription: string | undefined,
    interval: number,
  ): void {
    if (!this.currentFlowState) return;
    switch (error) {
      case "authorization_pending":
        event.sender.send("github:flow-update", {
          message: "Waiting for user authorization...",
        });
        this.currentFlowState.timeoutId = setTimeout(
          () => void this.pollForAccessToken(event),
          interval * 1000,
        );
        break;
      case "slow_down": {
        const newInterval = interval + 5;
        this.currentFlowState.interval = newInterval;
        event.sender.send("github:flow-update", {
          message: `GitHub asked to slow down. Retrying in ${newInterval}s...`,
        });
        this.currentFlowState.timeoutId = setTimeout(
          () => void this.pollForAccessToken(event),
          newInterval * 1000,
        );
        break;
      }
      case "expired_token":
        event.sender.send("github:flow-error", {
          error: "Verification code expired. Please try again.",
        });
        this.stopPolling();
        break;
      case "access_denied":
        event.sender.send("github:flow-error", {
          error: "Authorization denied by user.",
        });
        this.stopPolling();
        break;
      default:
        event.sender.send("github:flow-error", {
          error: `GitHub authorization error: ${errorDescription || error}`,
        });
        this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (!this.currentFlowState) return;
    if (this.currentFlowState.timeoutId) {
      clearTimeout(this.currentFlowState.timeoutId);
    }
    this.currentFlowState.isPolling = false;
    this.currentFlowState.timeoutId = null;
  }

  private requireAccessToken(): string {
    const accessToken =
      this.deps.settings.readSettings().githubAccessToken?.value;
    if (!accessToken) {
      throw new DyadError("Not authenticated with GitHub.", DyadErrorKind.Auth);
    }
    return accessToken;
  }

  private async requireApp(appId: number): Promise<GithubServiceAppRecord> {
    const app = await this.deps.findAppById(appId);
    if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
    return app;
  }

  private async requireLinkedGithubApp(
    appId: number,
  ): Promise<GithubServiceAppRecord> {
    const app = await this.requireApp(appId);
    if (!app.githubOrg || !app.githubRepo) {
      throw new DyadError(
        "App is not linked to a GitHub repo.",
        DyadErrorKind.Precondition,
      );
    }
    return app;
  }

  private async requireAppPath(appId: number): Promise<string> {
    const app = await this.requireApp(appId);
    return this.deps.resolveAppPath(app.path);
  }

  private buildAuthenticatedRemoteUrl(
    owner: string,
    repo: string,
    accessToken: string,
  ): string {
    if (this.isTestBuild) {
      return `${this.githubGitBase}/${owner}/${repo}.git`;
    }
    return `https://${accessToken}:x-oauth-basic@github.com/${owner}/${repo}.git`;
  }

  private async ensureCleanWorkspace(
    appPath: string,
    operationDescription: string,
  ): Promise<void> {
    const isClean = await isGitStatusClean({ path: appPath });
    if (isClean) return;
    throw new DyadError(
      `Workspace is not clean before ${operationDescription}. Please commit or stash your changes manually and try again.`,
      DyadErrorKind.Conflict,
    );
  }

  private assertNoGitOperationInProgress(
    appPath: string,
    operation: string,
  ): void {
    if (isGitMergeInProgress({ path: appPath })) {
      throw GitStateError(
        `Cannot ${operation}: merge in progress. Please complete or abort the merge first.`,
        GIT_ERROR_CODES.MERGE_IN_PROGRESS,
      );
    }
    if (isGitRebaseInProgress({ path: appPath })) {
      throw GitStateError(
        `Cannot ${operation}: rebase in progress. Please complete or abort the rebase first.`,
        GIT_ERROR_CODES.REBASE_IN_PROGRESS,
      );
    }
  }

  private async withAppGitOp<T>(
    appId: number,
    operation: string,
    fn: (appPath: string) => Promise<T>,
  ): Promise<T> {
    const appPath = await this.requireAppPath(appId);
    return withLock(appId, async () => {
      this.assertNoGitOperationInProgress(appPath, operation);
      return fn(appPath);
    });
  }

  private async formatGithubError(
    response: Response,
    fallback: string,
  ): Promise<string> {
    let errorMessage = `${fallback} (${response.status} ${response.statusText})`;
    try {
      const data = (await response.json()) as any;
      if (data.message) errorMessage = data.message;
      if (data.errors && Array.isArray(data.errors)) {
        const errorDetails = data.errors
          .map((err: any) => {
            if (typeof err === "string") return err;
            if (err.message) return err.message;
            if (err.code) return `${err.field || "field"}: ${err.code}`;
            return JSON.stringify(err);
          })
          .join(", ");
        errorMessage = `${data.message || fallback}: ${errorDetails}`;
      }
    } catch {
      errorMessage = `GitHub API error: ${response.status} ${response.statusText}`;
    }
    return errorMessage;
  }
}

class MergeConflictError extends DyadError {
  constructor(message: string) {
    super(message, DyadErrorKind.Conflict);
    this.name = "MergeConflictError";
  }
}

function isMissingRemoteBranchError(error: unknown): boolean {
  const anyError = error as { code?: string; message?: string } | undefined;
  const message = anyError?.message || "";
  return (
    anyError?.code === "MissingRefError" ||
    (anyError?.code === "NotFoundError" &&
      (message.includes("remote ref") || message.includes("remote branch"))) ||
    message.includes("couldn't find remote ref") ||
    message.includes("Cannot read properties of null")
  );
}

function isLocalChangesError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : "";
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("local changes") ||
    lowerMessage.includes("would be overwritten") ||
    lowerMessage.includes("please commit or stash")
  );
}

function validateBranchName(branch: string): void {
  if (!branch || branch.length === 0 || branch.length > 255) {
    throw new DyadError(
      "Branch name must be between 1 and 255 characters",
      DyadErrorKind.Validation,
    );
  }
  if (!/^[a-zA-Z0-9/_.-]+$/.test(branch) || /\.\./.test(branch)) {
    throw new DyadError(
      "Branch name contains invalid characters",
      DyadErrorKind.Validation,
    );
  }
  if (
    branch.startsWith("-") ||
    branch === "HEAD" ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("@{")
  ) {
    throw new DyadError("Invalid branch name", DyadErrorKind.Validation);
  }
}

function validateGithubUsername(username: string): string {
  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    throw new DyadError("Username cannot be empty.", DyadErrorKind.Validation);
  }
  if (trimmedUsername.length > 39) {
    throw new DyadError(
      "GitHub username cannot exceed 39 characters.",
      DyadErrorKind.Validation,
    );
  }
  if (trimmedUsername.length === 1) {
    if (!/^[a-zA-Z0-9]$/.test(trimmedUsername)) {
      throw new DyadError(
        "Invalid GitHub username format. Single-character usernames must be alphanumeric.",
        DyadErrorKind.Validation,
      );
    }
  } else if (
    !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(trimmedUsername)
  ) {
    throw new DyadError(
      "Invalid GitHub username format. Usernames can only contain alphanumeric characters and hyphens, and cannot start or end with a hyphen.",
      DyadErrorKind.Validation,
    );
  }
  return trimmedUsername;
}
