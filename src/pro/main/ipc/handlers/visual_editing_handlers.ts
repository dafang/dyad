import { ipcMain } from "electron";
import { eq } from "drizzle-orm";

import { db } from "../../../../db";
import { apps } from "../../../../db/schema";
import { getDyadAppPath } from "../../../../paths/paths";
import {
  gitAdd,
  gitCommit,
  gitResetFile,
} from "../../../../ipc/utils/git_utils";
import {
  type AnalyseComponentParams,
  type ApplyVisualEditingChangesParams,
} from "@/ipc/types";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import {
  analyzeVisualEditingComponent,
  applyVisualEditingChanges,
  DEFAULT_COMPONENT_ANALYSIS,
  type VisualEditingServiceDeps,
} from "../services/visual_editing_service";

export function registerVisualEditingHandlers() {
  const deps = createElectronVisualEditingServiceDeps();

  ipcMain.handle(
    "apply-visual-editing-changes",
    async (_event, params: ApplyVisualEditingChangesParams) => {
      await applyVisualEditingChanges(params, deps);
    },
  );

  ipcMain.handle(
    "analyze-component",
    async (_event, analyseComponentParams: AnalyseComponentParams) => {
      try {
        return await analyzeVisualEditingComponent(
          analyseComponentParams,
          deps,
        );
      } catch {
        return { ...DEFAULT_COMPONENT_ANALYSIS };
      }
    },
  );
}

function createElectronVisualEditingServiceDeps(): VisualEditingServiceDeps {
  return {
    findAppById: (appId) =>
      db.query.apps.findFirst({
        where: eq(apps.id, appId),
      }),
    resolveAppPath: getDyadAppPath,
    gitAdd,
    gitCommit,
    gitResetFile,
    queueSnapshotSync: queueCloudSandboxSnapshotSync,
  };
}
