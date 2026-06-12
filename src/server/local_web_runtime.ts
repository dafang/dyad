import fs from "node:fs";

import {
  closeDatabase,
  configureDatabaseUserDataPath,
  initializeDatabase,
} from "@/db";
import { configureLocalWebSettingsStore } from "@/main/settings";
import { createDefaultLocalWebCoreService } from "@/ipc/services/default_local_web_core_service";
import { createDefaultLocalWebIntegrationService } from "@/ipc/services/default_local_web_integration_service";
import { createDefaultLocalWebMutationService } from "@/ipc/services/default_local_web_mutation_service";
import { createLocalWebRuntimeService } from "@/ipc/services/local_web_runtime_service";
import {
  generateLocalServerToken,
  type LocalServerInstance,
  type LocalServerOptions,
  startLocalServer,
} from "./local_server";
import {
  createLocalEventStream,
  type LocalEventStream,
} from "./local_event_stream";
import {
  createLocalWebSettingsStore,
  type LocalWebSettingsStore,
} from "./local_web_settings";
import {
  createLocalWebPathResolver,
  getDefaultLocalWebUserDataPath,
  type LocalWebPathResolver,
} from "./local_web_paths";
import {
  configureCustomAppsFolderSettingReaderForPathResolution,
  configureUserDataPathProviderForPathResolution,
} from "@/paths/paths";
import {
  createLocalWebHostCapabilities,
  type LocalWebHostCapabilities,
} from "./local_web_host_capabilities";
import { configureLocalWebRuntimeContext } from "@/runtime/local_web_runtime_context";
import { createLocalWebMediaRoutes } from "./local_web_media_routes";
import { createLocalWebPreviewProxyRoutes } from "./local_web_preview_proxy";
import { createLocalWebStreamRoutes } from "./local_web_stream_routes";
import {
  composeLocalWebRpcService,
  createDefaultWorkflowService,
  registerLocalWebRpcHandlers,
} from "./local_web_rpc_registry";

export interface LocalWebRuntimeOptions extends Omit<
  LocalServerOptions,
  "routes"
> {
  userDataPath?: string;
  publicBaseUrl?: string;
  settingsStore?: LocalWebSettingsStore;
  pathResolver?: LocalWebPathResolver;
  hostCapabilities?: LocalWebHostCapabilities;
}

export interface LocalWebRuntime {
  server: LocalServerInstance;
  events: LocalEventStream;
  settingsStore: LocalWebSettingsStore;
  pathResolver: LocalWebPathResolver;
  hostCapabilities: LocalWebHostCapabilities;
  close(): Promise<void>;
}

export async function startLocalWebRuntime(
  options: LocalWebRuntimeOptions,
): Promise<LocalWebRuntime> {
  const userDataPath = options.userDataPath ?? getDefaultLocalWebUserDataPath();
  fs.mkdirSync(userDataPath, { recursive: true });

  const settingsStore =
    options.settingsStore ?? createLocalWebSettingsStore({ userDataPath });
  configureLocalWebRuntimeContext(true);
  configureUserDataPathProviderForPathResolution(() => userDataPath);
  configureLocalWebSettingsStore(settingsStore);
  settingsStore.readSettings();

  const pathResolver =
    options.pathResolver ??
    createLocalWebPathResolver({
      userDataPath,
      settingsStore,
    });
  configureCustomAppsFolderSettingReaderForPathResolution(
    () => settingsStore.readSettings().customAppsFolder,
    () => pathResolver.defaultAppsDirectory,
    () => pathResolver.getTypeScriptCachePath(),
  );
  pathResolver.getDyadAppsBaseDirectory();

  configureDatabaseUserDataPath(userDataPath);
  initializeDatabase();

  const serverToken =
    options.token ?? generateLocalServerToken(options.tokenBytes);
  const events = createLocalEventStream({ token: serverToken });
  let localWebBaseUrl: string | undefined;
  const coreService = createDefaultLocalWebCoreService({
    settingsStore,
    pathResolver,
    userDataPath,
    getMediaBaseUrl: () => localWebBaseUrl,
  });
  const mutationService = createDefaultLocalWebMutationService({
    settingsStore,
    pathResolver,
    userDataPath,
  });
  const runtimeService = createLocalWebRuntimeService({
    events,
    settingsStore,
    pathResolver,
  });
  const hostCapabilities =
    options.hostCapabilities ?? createLocalWebHostCapabilities();
  const integrationService = createDefaultLocalWebIntegrationService({
    settingsStore,
    hostCapabilities,
  });
  const workflowService = await createDefaultWorkflowService();
  const rpcService = composeLocalWebRpcService(
    coreService,
    mutationService,
    runtimeService,
    integrationService,
    workflowService,
  );
  let server: LocalServerInstance | undefined;
  server = await startLocalServer({
    ...options,
    token: serverToken,
    routes: [
      ...createLocalWebMediaRoutes({ pathResolver }),
      ...createLocalWebPreviewProxyRoutes(),
      ...createLocalWebStreamRoutes({
        events,
        getRpcServer: () => server?.rpcServer,
        getService: () => rpcService,
      }),
      ...events.routes,
    ],
  });
  localWebBaseUrl = options.publicBaseUrl ?? server.info.baseUrl;
  runtimeService.setPreviewBaseUrl(localWebBaseUrl);
  await registerLocalWebRpcHandlers(server.rpcServer, rpcService, { events });

  return {
    server,
    events,
    settingsStore,
    pathResolver,
    hostCapabilities,
    async close() {
      events.close();
      await server.close();
      closeDatabase();
      configureLocalWebRuntimeContext(false);
      configureLocalWebSettingsStore(undefined);
      configureUserDataPathProviderForPathResolution(undefined);
      configureCustomAppsFolderSettingReaderForPathResolution(undefined);
    },
  };
}
