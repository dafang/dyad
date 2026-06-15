import { handleNeonOAuthReturn } from "../../neon_admin/neon_return_handler";
import { neonContracts } from "../types/neon";
import { createTypedHandler } from "./base";
import { createTestOnlyLoggedHandler } from "./safe_handle";
import { readSettings, writeSettings } from "../../main/settings";
import { logger } from "../utils/neon_utils";
import { NeonService } from "../services/neon_service";

const testOnlyHandle = createTestOnlyLoggedHandler(logger);
const neonService = new NeonService({
  settings: {
    readSettings,
    writeSettings,
  },
});

export function registerNeonHandlers() {
  createTypedHandler(neonContracts.saveApiKey, async (_, params) => {
    neonService.saveApiKey(params);
  });

  // Do not use log handler because there's sensitive data in the response.
  createTypedHandler(neonContracts.createProject, async (_, params) =>
    neonService.createProject(params),
  );

  createTypedHandler(neonContracts.getProject, async (_, params) =>
    neonService.getProject(params),
  );

  createTypedHandler(neonContracts.listProjects, async () =>
    neonService.listProjects(),
  );

  createTypedHandler(neonContracts.setAppProject, async (_, params) =>
    neonService.setAppProject(params),
  );

  createTypedHandler(neonContracts.unsetAppProject, async (_, params) =>
    neonService.unsetAppProject(params),
  );

  createTypedHandler(neonContracts.setActiveBranch, async (_, params) =>
    neonService.setActiveBranch(params),
  );

  createTypedHandler(neonContracts.getEmailPasswordConfig, async (_, params) =>
    neonService.getEmailPasswordConfig(params),
  );

  createTypedHandler(neonContracts.updateEmailVerification, async (_, params) =>
    neonService.updateEmailVerification(params),
  );

  // Do not use log handler because there's sensitive data in the response.
  createTypedHandler(neonContracts.getBranchEnvVars, async (_, params) =>
    neonService.getBranchEnvVars(params),
  );

  createTypedHandler(
    neonContracts.setSelectedDatabaseBranchType,
    async (_, params) => neonService.setSelectedDatabaseBranchType(params),
  );

  testOnlyHandle("neon:fake-connect", async (event) => {
    handleNeonOAuthReturn({
      token: "fake-neon-access-token",
      refreshToken: "fake-neon-refresh-token",
      expiresIn: 3600,
    });
    logger.info("Called handleNeonOAuthReturn with fake data during testing.");

    event.sender.send("deep-link-received", {
      type: "neon-oauth-return",
      url: "https://oauth.dyad.sh/api/integrations/neon/login",
    });
    logger.info("Sent fake neon deep-link-received event during testing.");
  });
}
