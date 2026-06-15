import log from "electron-log";
import { createTypedHandler } from "./base";
import { createTestOnlyLoggedHandler } from "./safe_handle";
import { safeSend } from "../utils/safe_sender";
import { readSettings, writeSettings } from "../../main/settings";
import { supabaseContracts } from "../types/supabase";
import { SupabaseService } from "../services/supabase_service";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { apps } from "../../db/schema";

const logger = log.scope("supabase_handlers");
const testOnlyHandle = createTestOnlyLoggedHandler(logger);
const supabaseService = new SupabaseService({
  settings: {
    readSettings,
    writeSettings,
  },
});

export function registerSupabaseHandlers() {
  createTypedHandler(
    supabaseContracts.saveOrganizationToken,
    async (_, params) => {
      supabaseService.saveOrganizationToken(params);
    },
  );

  // List all connected Supabase organizations with details
  createTypedHandler(supabaseContracts.listOrganizations, () =>
    supabaseService.listOrganizations(),
  );

  // Delete a Supabase organization connection
  createTypedHandler(
    supabaseContracts.deleteOrganization,
    async (_, params) => {
      supabaseService.deleteOrganization(params);
    },
  );

  // List all projects from all connected organizations
  createTypedHandler(supabaseContracts.listAllProjects, () =>
    supabaseService.listProjects(),
  );

  // List branches for a Supabase project (database branches)
  createTypedHandler(supabaseContracts.listBranches, async (_, params) => {
    return supabaseService.listBranches(params);
  });

  // Get edge function logs for a Supabase project
  createTypedHandler(supabaseContracts.getEdgeLogs, async (_, params) => {
    return supabaseService.getEdgeLogs(params);
  });

  // Set app project - links a Dyad app to a Supabase project
  createTypedHandler(supabaseContracts.setAppProject, async (_, params) => {
    await supabaseService.setAppProject(params);
    logger.info(
      `Associated app ${params.appId} with Supabase project ${params.projectId} (organization: ${params.organizationSlug})${params.parentProjectId ? ` and parent project ${params.parentProjectId}` : ""}`,
    );
  });

  // Unset app project - removes the link between a Dyad app and a Supabase project
  createTypedHandler(supabaseContracts.unsetAppProject, async (_, params) => {
    await supabaseService.unsetAppProject(params);
    logger.info(`Removed Supabase project association for app ${params.app}`);
  });

  testOnlyHandle(
    "supabase:fake-connect-and-set-project",
    async (
      event,
      { appId, fakeProjectId }: { appId: number; fakeProjectId: string },
    ) => {
      const fakeOrgId = "fake-org-id";

      // Directly store fake credentials in the organizations map
      // We don't call handleSupabaseOAuthReturn because it attempts a real API call
      // which fails with fake tokens, causing credentials to be stored in legacy format
      const settings = readSettings();
      const existingOrgs = settings.supabase?.organizations ?? {};
      writeSettings({
        supabase: {
          ...settings.supabase,
          organizations: {
            ...existingOrgs,
            [fakeOrgId]: {
              accessToken: {
                value: "fake-access-token",
              },
              refreshToken: {
                value: "fake-refresh-token",
              },
              expiresIn: 3600,
              tokenTimestamp: Math.floor(Date.now() / 1000),
            },
          },
        },
      });
      logger.info(
        `Stored fake Supabase credentials for organization ${fakeOrgId} for app ${appId} during testing.`,
      );

      // Set the supabase project for the currently selected app
      await db
        .update(apps)
        .set({
          supabaseProjectId: fakeProjectId,
          supabaseOrganizationSlug: fakeOrgId,
        })
        .where(eq(apps.id, appId));
      logger.info(
        `Set fake Supabase project ${fakeProjectId} for app ${appId} during testing.`,
      );

      // Simulate the deep link event
      safeSend(event.sender, "deep-link-received", {
        type: "supabase-oauth-return",
        url: "https://supabase-oauth.dyad.sh/api/connect-supabase/login",
      });
      logger.info(
        `Sent fake deep-link-received event for app ${appId} during testing.`,
      );
    },
  );
}
