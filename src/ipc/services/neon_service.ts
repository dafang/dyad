import fs from "node:fs/promises";

import { EndpointType, type Api } from "@neondatabase/api-client";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";
import type {
  NeonAuthEmailAndPasswordConfig,
  NeonBranch,
  GetNeonBranchEnvVarsResponse,
  GetNeonProjectResponse,
  ListNeonProjectsResponse,
  NeonProject,
} from "@/ipc/types/neon";
import {
  getCachedEmailPasswordConfig,
  getNeonClient,
  getNeonErrorMessage,
  getNeonOrganizationId,
  invalidateEmailPasswordConfigCache,
} from "@/neon_admin/neon_management_client";
import {
  getEnvFilePath,
  readEnvFileIfExists,
  removeNeonEnvVars,
} from "@/ipc/utils/app_env_var_utils";
import {
  logger,
  combineWarnings,
  buildNeonAuthActivationWarning,
  getAppWithNeonBranch,
  ensureNeonAuth,
  autoInjectNeonEnvVars,
  assertNoSupabaseProject,
  assertNoNeonProject,
  getOrCreateNeonAuthCookieSecret,
  syncActiveNeonAuthCookieSecretFromEnv,
  resolveNeonBranchEnvVars,
  type NeonBranchType,
} from "@/ipc/utils/neon_utils";
import {
  ensureNitroIfVite,
  type EnsureNitroResult,
} from "@/ipc/utils/nitro_setup";
import { retryOnLocked } from "@/ipc/utils/retryOnLocked";
import { getDyadAppPath } from "@/paths/paths";

const MANUAL_API_KEY_EXPIRES_IN_SECONDS = 10 * 365 * 24 * 60 * 60;

type AppRow = typeof apps.$inferSelect;

export interface NeonServiceSettings {
  readSettings(): UserSettings;
  writeSettings(settings: Partial<UserSettings>): void;
}

export interface NeonServiceDeps {
  settings: NeonServiceSettings;
  getClient?: () => Promise<Api<unknown>>;
  getOrganizationId?: () => Promise<string>;
  ensureNitroIfVite?: typeof ensureNitroIfVite;
  autoInjectNeonEnvVars?: typeof autoInjectNeonEnvVars;
  ensureNeonAuth?: typeof ensureNeonAuth;
  getCachedEmailPasswordConfig?: typeof getCachedEmailPasswordConfig;
  invalidateEmailPasswordConfigCache?: typeof invalidateEmailPasswordConfigCache;
  resolveNeonBranchEnvVars?: typeof resolveNeonBranchEnvVars;
}

export class NeonService {
  constructor(private readonly deps: NeonServiceDeps) {}

  saveApiKey(params: { apiKey: string }): void {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new DyadError(
        "Neon API key is required.",
        DyadErrorKind.Validation,
      );
    }

    this.deps.settings.writeSettings({
      neon: {
        accessToken: { value: apiKey },
        refreshToken: { value: apiKey },
        expiresIn: MANUAL_API_KEY_EXPIRES_IN_SECONDS,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  }

  async createProject(params: {
    name: string;
    appId: number;
  }): Promise<NeonProject> {
    const { name, appId } = params;
    const neonClient = await this.getClient();

    logger.info(`Creating Neon project: ${name} for app ${appId}`);

    await assertNoSupabaseProject(appId);
    await assertNoNeonProject(appId);

    const appPath = await this.getAppPath(appId);
    const resolvedAppPath = getDyadAppPath(appPath);
    const ensureNitro = this.deps.ensureNitroIfVite ?? ensureNitroIfVite;
    const nitroSetup = await ensureNitro(resolvedAppPath);
    const nitroWarnings = nitroSetup.warningMessages;
    let nitroRolledBack = false;
    const rollbackNitroOnce = async () => {
      if (nitroRolledBack) return;
      nitroRolledBack = true;
      try {
        await nitroSetup.rollback();
      } catch (rollbackError) {
        logger.error(
          `Failed to roll back Nitro setup for app ${appId}: ${rollbackError}`,
        );
      }
    };

    try {
      const orgId = await this.getOrganizationId();
      const response = await retryOnLocked(
        () =>
          neonClient.createProject({
            project: {
              name,
              org_id: orgId,
            },
          }),
        `Create project ${name} for app ${appId}`,
      );

      if (!response.data.project) {
        throw new DyadError(
          "Failed to create project: No project data returned.",
          DyadErrorKind.External,
        );
      }

      if (!response.data.branch) {
        throw new DyadError(
          "Failed to create project: No branch data returned.",
          DyadErrorKind.External,
        );
      }

      const project = response.data.project;
      const mainBranch = response.data.branch;
      const authWarnings: string[] = [];
      let envFileSnapshot: string | null | undefined = undefined;

      try {
        envFileSnapshot = await readEnvFileIfExists({ appPath });
        if (
          !(await this.ensureNeonAuth({
            projectId: project.id,
            branchId: mainBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("production"));
        }

        const developmentBranchResponse = await retryOnLocked(
          () =>
            neonClient.createProjectBranch(project.id, {
              endpoints: [{ type: EndpointType.ReadWrite }],
              branch: {
                name: "development",
                parent_id: mainBranch.id,
              },
            }),
          `Create development branch for project ${project.id}`,
        );

        if (
          !developmentBranchResponse.data.branch ||
          !developmentBranchResponse.data.connection_uris ||
          developmentBranchResponse.data.connection_uris.length === 0
        ) {
          throw new DyadError(
            "Failed to create development branch: No branch data returned.",
            DyadErrorKind.External,
          );
        }

        const developmentBranch = developmentBranchResponse.data.branch;
        if (
          !(await this.ensureNeonAuth({
            projectId: project.id,
            branchId: developmentBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("development"));
        }

        const previewBranchResponse = await retryOnLocked(
          () =>
            neonClient.createProjectBranch(project.id, {
              endpoints: [{ type: EndpointType.ReadWrite }],
              branch: {
                name: "preview",
                parent_id: developmentBranch.id,
              },
            }),
          `Create preview branch for project ${project.id}`,
        );

        if (
          !previewBranchResponse.data.branch ||
          !previewBranchResponse.data.connection_uris ||
          previewBranchResponse.data.connection_uris.length === 0
        ) {
          throw new DyadError(
            "Failed to create preview branch: No branch data returned.",
            DyadErrorKind.External,
          );
        }

        const previewBranch = previewBranchResponse.data.branch;
        if (
          !(await this.ensureNeonAuth({
            projectId: project.id,
            branchId: previewBranch.id,
          }))
        ) {
          authWarnings.push(buildNeonAuthActivationWarning("preview"));
        }

        await db
          .update(apps)
          .set({
            neonProjectId: project.id,
            neonDevelopmentBranchId: developmentBranch.id,
            neonPreviewBranchId: previewBranch.id,
            neonActiveBranchId: developmentBranch.id,
          })
          .where(eq(apps.id, appId));

        const connectionUri =
          developmentBranchResponse.data.connection_uris[0].connection_uri;

        const warning = combineWarnings(
          ...nitroWarnings,
          ...authWarnings,
          await this.autoInjectNeonEnvVars({
            appId,
            appPath,
            projectId: project.id,
            branchId: developmentBranch.id,
            branchType: "development",
          }),
        );

        logger.info(
          `Successfully created Neon project: ${project.id} with main branch: ${mainBranch.id} and development branch: ${developmentBranch.id} for app ${appId}`,
        );
        return {
          id: project.id,
          name: project.name,
          connectionString: connectionUri,
          branchId: developmentBranch.id,
          warning,
        };
      } catch (postCreateError) {
        logger.warn(
          `Post-creation step failed for project ${project.id}, attempting cleanup: ${postCreateError}`,
        );
        try {
          await neonClient.deleteProject(project.id);
          logger.info(
            `Successfully cleaned up orphan Neon project ${project.id}`,
          );
        } catch (deleteError) {
          logger.error(
            `Failed to clean up orphan Neon project ${project.id}: ${deleteError}`,
          );
        }
        await this.clearAppNeonFields(appId);
        try {
          await restoreEnvFileSnapshot({
            appPath,
            snapshot: envFileSnapshot,
          });
        } catch (envCleanupError) {
          logger.error(
            `Failed to restore .env.local for app ${appId} after project cleanup: ${envCleanupError}`,
          );
        }
        await rollbackNitroOnce();
        throw postCreateError;
      }
    } catch (error: unknown) {
      await rollbackNitroOnce();
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      const message = `Failed to create Neon project for app ${appId}: ${errorMessage}`;
      logger.error(message);
      throw new DyadError(message, DyadErrorKind.External);
    }
  }

  async getProject(params: { appId: number }): Promise<GetNeonProjectResponse> {
    const { appId } = params;
    logger.info(`Getting Neon project info for app ${appId}`);

    const appData = await this.getApp(appId);
    if (!appData.neonProjectId) {
      throw new DyadError(
        `No Neon project found for app ${appId}`,
        DyadErrorKind.External,
      );
    }

    const neonClient = await this.getClient();
    const projectResponse = await neonClient.getProject(appData.neonProjectId);

    if (!projectResponse.data.project) {
      throw new DyadError(
        "Failed to get project: No project data returned.",
        DyadErrorKind.External,
      );
    }

    const branchesResponse = await neonClient.listProjectBranches({
      projectId: appData.neonProjectId,
    });

    if (!branchesResponse.data.branches) {
      throw new DyadError(
        "Failed to get branches: No branch data returned.",
        DyadErrorKind.External,
      );
    }

    const branches: NeonBranch[] = branchesResponse.data.branches.map(
      (branch) => {
        let type: NeonBranch["type"];

        if (branch.id === appData.neonDevelopmentBranchId) {
          type = "development";
        } else if (branch.id === appData.neonPreviewBranchId) {
          type = "preview";
        } else if (branch.default) {
          type = "production";
        } else {
          type = "snapshot";
        }

        const parentBranchName = branch.parent_id
          ? branchesResponse.data.branches?.find(
              (candidate) => candidate.id === branch.parent_id,
            )?.name
          : undefined;

        return {
          type,
          branchId: branch.id,
          branchName: branch.name,
          lastUpdated: branch.updated_at,
          parentBranchId: branch.parent_id,
          parentBranchName,
        };
      },
    );

    logger.info(`Successfully retrieved Neon project info for app ${appId}`);

    const project = projectResponse.data.project;
    return {
      projectId: project.id,
      projectName: project.name,
      orgId: project.org_id ?? "<unknown_org_id>",
      branches,
    };
  }

  async listProjects(): Promise<ListNeonProjectsResponse> {
    this.assertHasCredentials();
    logger.info("Listing Neon projects");

    try {
      const neonClient = await this.getClient();
      const orgId = await this.getOrganizationId();
      const response = await neonClient.listProjects({
        org_id: orgId,
        limit: 100,
      });

      if (!response.data.projects) {
        return { projects: [] };
      }

      if (response.data.projects.length >= 100) {
        logger.warn(
          "Neon project list may be truncated — returned 100 projects (the maximum). Some projects may not be shown.",
        );
      }

      return {
        projects: response.data.projects.map((project) => ({
          id: project.id,
          name: project.name,
          regionId: project.region_id,
          createdAt: project.created_at,
        })),
      };
    } catch (error: unknown) {
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(`Failed to list Neon projects: ${errorMessage}`);
      throw new DyadError(
        `Failed to list Neon projects: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  }

  async setAppProject(params: {
    appId: number;
    projectId: string;
  }): Promise<{ success: boolean; warning?: string }> {
    const { appId, projectId } = params;
    logger.info(`Setting Neon project ${projectId} for app ${appId}`);

    await assertNoSupabaseProject(appId);
    await assertNoNeonProject(appId);

    const appPath = await this.getAppPath(appId);
    const resolvedAppPath = getDyadAppPath(appPath);
    const envFileSnapshot = await readEnvFileIfExists({ appPath });
    let nitroSetup: EnsureNitroResult | null = null;

    try {
      const neonClient = await this.getClient();
      const branchesResponse = await neonClient.listProjectBranches({
        projectId,
      });

      const ensureNitro = this.deps.ensureNitroIfVite ?? ensureNitroIfVite;
      nitroSetup = await ensureNitro(resolvedAppPath);

      if (!branchesResponse.data.branches) {
        throw new DyadError(
          "Failed to get branches for project",
          DyadErrorKind.External,
        );
      }

      const branches = branchesResponse.data.branches;
      const defaultBranch = branches.find((branch) => branch.default);
      const dedicatedDevBranch = branches.find(
        (branch) => branch.name === "development",
      );
      const previewBranch = branches.find(
        (branch) => branch.name === "preview",
      );
      const activeBranchId =
        dedicatedDevBranch?.id ?? defaultBranch?.id ?? null;

      if (!activeBranchId) {
        throw new DyadError(
          "Linked Neon project has no writable branch. Create a development branch in Neon before connecting this app.",
          DyadErrorKind.Precondition,
        );
      }

      await db
        .update(apps)
        .set({
          neonProjectId: projectId,
          neonDevelopmentBranchId: dedicatedDevBranch?.id ?? null,
          neonPreviewBranchId: previewBranch?.id ?? null,
          neonActiveBranchId: activeBranchId,
        })
        .where(eq(apps.id, appId));

      const branchType: NeonBranchType =
        activeBranchId === dedicatedDevBranch?.id
          ? "development"
          : "production";
      let warning: string | undefined;
      try {
        warning = await this.autoInjectNeonEnvVars({
          appId,
          appPath,
          projectId,
          branchId: activeBranchId,
          branchType,
        });
      } catch (envError) {
        logger.warn(
          `autoInjectNeonEnvVars failed for app ${appId}, reverting DB update: ${envError}`,
        );
        await this.clearAppNeonFields(appId);
        try {
          await restoreEnvFileSnapshot({
            appPath,
            snapshot: envFileSnapshot,
          });
        } catch (restoreError) {
          logger.error(
            `Failed to restore .env.local for app ${appId}: ${restoreError}`,
          );
        }
        throw envError;
      }

      logger.info(
        `Successfully linked Neon project ${projectId} to app ${appId}`,
      );
      return {
        success: true,
        warning: combineWarnings(...nitroSetup.warningMessages, warning),
      };
    } catch (error: unknown) {
      if (nitroSetup) {
        try {
          await nitroSetup.rollback();
        } catch (rollbackError) {
          logger.error(
            `Failed to roll back Nitro setup for app ${appId}: ${rollbackError}`,
          );
        }
      }
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to set Neon project for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  }

  async unsetAppProject(params: {
    appId: number;
  }): Promise<{ success: boolean }> {
    const { appId } = params;
    logger.info(`Unsetting Neon project for app ${appId}`);

    try {
      const appRecord = await db
        .select()
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);

      await this.clearAppNeonFields(appId);

      if (appRecord.length > 0) {
        await removeNeonEnvVars({ appPath: appRecord[0].path });
      }

      logger.info(`Successfully unlinked Neon project from app ${appId}`);
      return { success: true };
    } catch (error: unknown) {
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to unset Neon project for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to unset Neon project for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  }

  async setActiveBranch(params: {
    appId: number;
    branchId: string;
  }): Promise<{ success: boolean; warning?: string }> {
    const { appId, branchId } = params;
    logger.info(`Setting active Neon branch ${branchId} for app ${appId}`);

    try {
      const appData = await this.getApp(appId);
      const envFileSnapshot = await readEnvFileIfExists({
        appPath: appData.path,
      });

      if (!appData.neonProjectId) {
        throw new DyadError(
          `No Neon project found for app ${appId}`,
          DyadErrorKind.Precondition,
        );
      }

      const neonClient = await this.getClient();
      const branchResponse = await neonClient.getProjectBranch(
        appData.neonProjectId,
        branchId,
      );
      if (branchResponse.data.branch?.project_id !== appData.neonProjectId) {
        throw new DyadError(
          `Branch ${branchId} does not belong to Neon project ${appData.neonProjectId}`,
          DyadErrorKind.Precondition,
        );
      }

      if (branchId === appData.neonPreviewBranchId) {
        throw new DyadError(
          "Preview branches are used for historical rollback and cannot be selected as the active Neon branch.",
          DyadErrorKind.Precondition,
        );
      }

      const branchType: NeonBranchType =
        branchId === appData.neonDevelopmentBranchId
          ? "development"
          : "production";

      const outgoingBranchId =
        appData.neonActiveBranchId ?? appData.neonDevelopmentBranchId;
      if (
        outgoingBranchId &&
        outgoingBranchId !== appData.neonPreviewBranchId
      ) {
        const outgoingBranchType: NeonBranchType =
          outgoingBranchId === appData.neonDevelopmentBranchId
            ? "development"
            : "production";
        await syncActiveNeonAuthCookieSecretFromEnv({
          appData,
          branchType: outgoingBranchType,
        });
      }

      await getOrCreateNeonAuthCookieSecret({ appData, branchType });

      const previousActiveBranchId = appData.neonActiveBranchId;
      const previousSelectedDatabaseBranchType =
        appData.selectedDatabaseBranchType;
      await db
        .update(apps)
        .set({
          neonActiveBranchId: branchId,
          ...(branchType === "production"
            ? { selectedDatabaseBranchType: null }
            : {}),
        })
        .where(eq(apps.id, appId));

      let warning: string | undefined;
      try {
        warning = await this.autoInjectNeonEnvVars({
          appId,
          appPath: appData.path,
          projectId: appData.neonProjectId,
          branchId,
          branchType,
        });
      } catch (envError) {
        logger.warn(
          `autoInjectNeonEnvVars failed for app ${appId}, reverting active branch: ${envError}`,
        );
        try {
          await db
            .update(apps)
            .set({
              neonActiveBranchId: previousActiveBranchId,
              selectedDatabaseBranchType: previousSelectedDatabaseBranchType,
            })
            .where(eq(apps.id, appId));
        } catch (revertError) {
          logger.error(
            `Failed to revert active branch for app ${appId}: ${revertError}`,
          );
        }
        try {
          await restoreEnvFileSnapshot({
            appPath: appData.path,
            snapshot: envFileSnapshot,
          });
        } catch (restoreError) {
          logger.error(
            `Failed to restore .env.local for app ${appId}: ${restoreError}`,
          );
        }
        throw envError;
      }

      logger.info(
        `Successfully set active branch ${branchId} for app ${appId}`,
      );
      return { success: true, warning };
    } catch (error: unknown) {
      if (error instanceof DyadError) throw error;
      const errorMessage = getNeonErrorMessage(error);
      logger.error(
        `Failed to set active branch for app ${appId}: ${errorMessage}`,
      );
      throw new DyadError(
        `Failed to set active branch for app ${appId}: ${errorMessage}`,
        DyadErrorKind.External,
      );
    }
  }

  async getEmailPasswordConfig(params: {
    appId: number;
  }): Promise<NeonAuthEmailAndPasswordConfig> {
    const { appData, branchId } = await getAppWithNeonBranch(params.appId);
    const getter =
      this.deps.getCachedEmailPasswordConfig ?? getCachedEmailPasswordConfig;
    return getter(appData.neonProjectId!, branchId);
  }

  async updateEmailVerification(params: {
    appId: number;
    requireEmailVerification: boolean;
  }): Promise<NeonAuthEmailAndPasswordConfig> {
    const { appData, branchId } = await getAppWithNeonBranch(params.appId);
    const neonClient = await this.getClient();

    const response = await neonClient.updateNeonAuthEmailAndPasswordConfig(
      appData.neonProjectId!,
      branchId,
      {
        require_email_verification: params.requireEmailVerification,
        send_verification_email_on_sign_up: params.requireEmailVerification,
      },
    );
    (
      this.deps.invalidateEmailPasswordConfigCache ??
      invalidateEmailPasswordConfigCache
    )(appData.neonProjectId!, branchId);
    return response.data as NeonAuthEmailAndPasswordConfig;
  }

  async getBranchEnvVars(params: {
    appId: number;
    branchType: NeonBranchType;
  }): Promise<GetNeonBranchEnvVarsResponse> {
    const appData = await this.getApp(params.appId);
    const resolver =
      this.deps.resolveNeonBranchEnvVars ?? resolveNeonBranchEnvVars;
    const { databaseUrl, neonAuthBaseUrl, neonAuthCookieSecret } =
      await resolver({
        appData,
        branchType: params.branchType,
      });

    return { databaseUrl, neonAuthBaseUrl, neonAuthCookieSecret };
  }

  async setSelectedDatabaseBranchType(params: {
    appId: number;
    branchType: NeonBranchType | null;
  }): Promise<{ success: boolean }> {
    const { appId, branchType } = params;
    logger.info(
      `Setting selected database branch type for app ${appId}: ${branchType}`,
    );

    if (branchType === "development") {
      const rows = await db
        .select({ neonDevelopmentBranchId: apps.neonDevelopmentBranchId })
        .from(apps)
        .where(eq(apps.id, appId))
        .limit(1);
      if (rows.length === 0) {
        throw new DyadError(
          `App with ID ${appId} not found`,
          DyadErrorKind.NotFound,
        );
      }
      if (!rows[0].neonDevelopmentBranchId) {
        throw new DyadError(
          "This app has no development branch, so it can't be selected for deployment. Create one in Neon first.",
          DyadErrorKind.Precondition,
        );
      }
    }

    const updated = await db
      .update(apps)
      .set({ selectedDatabaseBranchType: branchType })
      .where(eq(apps.id, appId))
      .returning({ id: apps.id });

    if (updated.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }

    return { success: true };
  }

  private assertHasCredentials(): void {
    if (!this.deps.settings.readSettings().neon?.accessToken?.value) {
      throw new DyadError("Not authenticated with Neon.", DyadErrorKind.Auth);
    }
  }

  private async getClient(): Promise<Api<unknown>> {
    return (this.deps.getClient ?? getNeonClient)();
  }

  private async getOrganizationId(): Promise<string> {
    return (this.deps.getOrganizationId ?? getNeonOrganizationId)();
  }

  private ensureNeonAuth(params: {
    projectId: string;
    branchId: string;
  }): Promise<string | undefined> {
    return (this.deps.ensureNeonAuth ?? ensureNeonAuth)(params);
  }

  private autoInjectNeonEnvVars(
    params: Parameters<typeof autoInjectNeonEnvVars>[0],
  ): Promise<string | undefined> {
    return (this.deps.autoInjectNeonEnvVars ?? autoInjectNeonEnvVars)(params);
  }

  private async getApp(appId: number): Promise<AppRow> {
    const app = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    if (app.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }
    return app[0];
  }

  private async getAppPath(appId: number): Promise<string> {
    const rows = await db
      .select({ path: apps.path })
      .from(apps)
      .where(eq(apps.id, appId))
      .limit(1);
    if (rows.length === 0) {
      throw new DyadError(
        `App with ID ${appId} not found`,
        DyadErrorKind.NotFound,
      );
    }
    return rows[0].path;
  }

  private async clearAppNeonFields(appId: number): Promise<void> {
    await db
      .update(apps)
      .set({
        neonProjectId: null,
        neonDevelopmentBranchId: null,
        neonPreviewBranchId: null,
        neonActiveBranchId: null,
        neonProductionAuthCookieSecret: null,
        neonDevelopmentAuthCookieSecret: null,
        selectedDatabaseBranchType: null,
      })
      .where(eq(apps.id, appId));
  }
}

async function restoreEnvFileSnapshot({
  appPath,
  snapshot,
}: {
  appPath: string;
  snapshot: string | null | undefined;
}): Promise<void> {
  if (snapshot === undefined) {
    return;
  }
  const envFilePath = getEnvFilePath({ appPath });
  if (snapshot === null) {
    await fs.rm(envFilePath, { force: true });
    return;
  }

  await fs.writeFile(envFilePath, snapshot);
}
