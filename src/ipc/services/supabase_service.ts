import { SupabaseManagementAPI } from "@dyad-sh/supabase-management-js";

import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";
import { assertNoNeonProject } from "@/ipc/utils/neon_utils";
import { extractFunctionName } from "@/supabase_admin/supabase_utils";
import type {
  ConsoleEntry,
  SupabaseBranch,
  SupabaseOrganizationInfo,
  SupabaseProject,
} from "@/ipc/types/supabase";
import type {
  SupabaseProjectBranch,
  SupabaseProjectLog,
} from "@/supabase_admin/supabase_management_client";
import {
  getOrganizationDetails,
  getOrganizationMembers,
  getSupabaseClientForOrganization,
  getSupabaseProjectLogs,
  listSupabaseBranches,
} from "@/supabase_admin/supabase_management_client";
import { eq } from "drizzle-orm";

const MANUAL_TOKEN_EXPIRES_IN_SECONDS = 10 * 365 * 24 * 60 * 60;

export interface SupabaseServiceSettings {
  readSettings(): UserSettings;
  writeSettings(settings: Partial<UserSettings>): void;
}

export interface SupabaseServiceDeps {
  settings: SupabaseServiceSettings;
  clientFactory?: (organizationSlug: string) => Promise<SupabaseManagementAPI>;
  listBranches?: (params: {
    supabaseProjectId: string;
    organizationSlug: string | null;
  }) => Promise<SupabaseProjectBranch[]>;
  getProjectLogs?: (
    projectId: string,
    timestampStart: number | undefined,
    organizationSlug: string | undefined,
  ) => Promise<{ result?: SupabaseProjectLog[]; error?: unknown }>;
  getOrganizationDetails?: typeof getOrganizationDetails;
  getOrganizationMembers?: typeof getOrganizationMembers;
}

export class SupabaseService {
  constructor(private readonly deps: SupabaseServiceDeps) {}

  saveOrganizationToken(params: {
    organizationSlug: string;
    accessToken: string;
  }): void {
    const organizationSlug = params.organizationSlug.trim();
    const accessToken = params.accessToken.trim();
    if (!organizationSlug) {
      throw new DyadError(
        "Supabase organization slug is required.",
        DyadErrorKind.Validation,
      );
    }
    if (!accessToken) {
      throw new DyadError(
        "Supabase access token is required.",
        DyadErrorKind.Validation,
      );
    }

    const settings = this.deps.settings.readSettings();
    const existingOrganizations = settings.supabase?.organizations ?? {};
    this.deps.settings.writeSettings({
      supabase: {
        ...settings.supabase,
        organizations: {
          ...existingOrganizations,
          [organizationSlug]: {
            accessToken: { value: accessToken },
            refreshToken: { value: accessToken },
            expiresIn: MANUAL_TOKEN_EXPIRES_IN_SECONDS,
            tokenTimestamp: Math.floor(Date.now() / 1000),
          },
        },
      },
    });
  }

  async listOrganizations(): Promise<SupabaseOrganizationInfo[]> {
    const organizations = this.getOrganizationCredentials();
    const getDetails =
      this.deps.getOrganizationDetails ?? getOrganizationDetails;
    const getMembers =
      this.deps.getOrganizationMembers ?? getOrganizationMembers;

    const results: SupabaseOrganizationInfo[] = [];
    for (const organizationSlug of Object.keys(organizations)) {
      try {
        const [details, members] = await Promise.all([
          getDetails(organizationSlug),
          getMembers(organizationSlug),
        ]);
        const owner = members.find((member) => member.role === "Owner");
        results.push({
          organizationSlug,
          name: details.name,
          ownerEmail: owner?.email,
        });
      } catch {
        results.push({ organizationSlug });
      }
    }
    return results;
  }

  deleteOrganization({ organizationSlug }: { organizationSlug: string }): void {
    const settings = this.deps.settings.readSettings();
    const organizations = { ...settings.supabase?.organizations };
    if (!organizations[organizationSlug]) {
      throw new DyadError(
        `Supabase organization ${organizationSlug} not found`,
        DyadErrorKind.NotFound,
      );
    }
    delete organizations[organizationSlug];
    this.deps.settings.writeSettings({
      supabase: {
        ...settings.supabase,
        organizations,
      },
    });
  }

  async listProjects(): Promise<SupabaseProject[]> {
    const organizations = this.getOrganizationCredentials();
    const projects: SupabaseProject[] = [];
    for (const organizationSlug of Object.keys(organizations)) {
      const client = await this.getClient(organizationSlug);
      const organizationProjects = await client.getProjects();
      for (const project of organizationProjects ?? []) {
        projects.push({
          id: project.id,
          name: project.name,
          region: project.region,
          organizationSlug:
            (project as { organization_slug?: string }).organization_slug ||
            project.organization_id,
        });
      }
    }
    return projects;
  }

  async listBranches(params: {
    projectId: string;
    organizationSlug?: string | null;
  }): Promise<SupabaseBranch[]> {
    const branches = await (this.deps.listBranches ?? listSupabaseBranches)({
      supabaseProjectId: params.projectId,
      organizationSlug: params.organizationSlug ?? null,
    });
    return branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      isDefault: branch.is_default,
      projectRef: branch.project_ref,
      parentProjectRef: branch.parent_project_ref,
    }));
  }

  async getEdgeLogs(params: {
    projectId: string;
    timestampStart?: number;
    appId: number;
    organizationSlug: string | null;
  }): Promise<ConsoleEntry[]> {
    const response = await (this.deps.getProjectLogs ?? getSupabaseProjectLogs)(
      params.projectId,
      params.timestampStart,
      params.organizationSlug ?? undefined,
    );
    if (response.error) {
      const errorMsg =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error);
      throw new DyadError(
        `Failed to fetch logs: ${errorMsg}`,
        DyadErrorKind.External,
      );
    }

    return (response.result ?? []).map((logEntry) => {
      const metadata = logEntry.metadata?.[0] || {};
      const level = metadata.level || "info";
      const eventMessage = logEntry.event_message || "";
      return {
        level: level === "error" ? "error" : level === "warn" ? "warn" : "info",
        type: "edge-function",
        message: eventMessage,
        timestamp: logEntry.timestamp / 1000,
        sourceName: extractFunctionName(eventMessage),
        appId: params.appId,
      };
    });
  }

  async setAppProject(params: {
    appId: number;
    projectId?: string | null;
    parentProjectId?: string | null;
    organizationSlug?: string | null;
  }): Promise<void> {
    await assertNoNeonProject(params.appId);
    await db
      .update(apps)
      .set({
        supabaseProjectId: params.projectId ?? null,
        supabaseParentProjectId: params.parentProjectId ?? null,
        supabaseOrganizationSlug: params.organizationSlug ?? null,
      })
      .where(eq(apps.id, params.appId));
  }

  async unsetAppProject({ app }: { app: number }): Promise<void> {
    await db
      .update(apps)
      .set({
        supabaseProjectId: null,
        supabaseParentProjectId: null,
        supabaseOrganizationSlug: null,
      })
      .where(eq(apps.id, app));
  }

  private getOrganizationCredentials(): NonNullable<
    NonNullable<UserSettings["supabase"]>["organizations"]
  > {
    const organizations =
      this.deps.settings.readSettings().supabase?.organizations ?? {};
    if (Object.keys(organizations).length === 0) {
      throw new DyadError(
        "Not authenticated with Supabase.",
        DyadErrorKind.Auth,
      );
    }
    return organizations;
  }

  private async getClient(
    organizationSlug: string,
  ): Promise<SupabaseManagementAPI> {
    if (this.deps.clientFactory) {
      return this.deps.clientFactory(organizationSlug);
    }
    return getSupabaseClientForOrganization(organizationSlug);
  }
}
