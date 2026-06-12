import {
  createClient,
  createElectronIpcTransport,
  createEventClient,
  createStreamClient,
  type IpcTransport,
} from "@/ipc/contracts/core";
import { settingsContracts } from "@/ipc/types/settings";
import { appContracts } from "@/ipc/types/app";
import { chatContracts, chatStreamContract } from "@/ipc/types/chat";
import { agentContracts, agentEvents } from "@/ipc/types/agent";
import {
  githubContracts,
  gitContracts,
  githubEvents,
} from "@/ipc/types/github";
import { mcpContracts, mcpEvents } from "@/ipc/types/mcp";
import { vercelContracts } from "@/ipc/types/vercel";
import { supabaseContracts } from "@/ipc/types/supabase";
import { neonContracts } from "@/ipc/types/neon";
import { migrationContracts } from "@/ipc/types/migration";
import { systemContracts, systemEvents } from "@/ipc/types/system";
import { versionContracts } from "@/ipc/types/version";
import { languageModelContracts } from "@/ipc/types/language-model";
import { promptContracts } from "@/ipc/types/prompts";
import { templateContracts } from "@/ipc/types/templates";
import { proposalContracts } from "@/ipc/types/proposals";
import { importContracts } from "@/ipc/types/import";
import { helpContracts, helpStreamContract } from "@/ipc/types/help";
import { capacitorContracts } from "@/ipc/types/capacitor";
import { contextContracts } from "@/ipc/types/context";
import { upgradeContracts } from "@/ipc/types/upgrade";
import { visualEditingContracts } from "@/ipc/types/visual-editing";
import { securityContracts } from "@/ipc/types/security";
import { miscContracts, miscEvents } from "@/ipc/types/misc";
import { freeAgentQuotaContracts } from "@/ipc/types/free_agent_quota";
import { audioContracts } from "@/ipc/types/audio";
import { mediaContracts } from "@/ipc/types/media";
import { imageGenerationContracts } from "@/ipc/types/image_generation";
import {
  appBlueprintContracts,
  appBlueprintEvents,
} from "@/ipc/types/app_blueprint";
import { appCollectionContracts } from "@/ipc/types/app_collections";
import { terminalContracts } from "@/ipc/types/terminal";
import { planContracts, planEvents } from "@/ipc/types/plan";
import {
  integrationContracts,
  integrationEvents,
} from "@/ipc/types/integration";
import {
  createLocalWebEventTransport,
  createLocalWebInvokeTransport,
  readLocalWebTransportConfig,
  type LocalWebTransportConfig,
  type LocalWebTransportEnv,
} from "./local_web_transport";

export type RuntimeMode = "electron" | "local-web";

export type RuntimeIpcClient = ReturnType<typeof createRuntimeIpc>;

export interface RuntimeClientOptions {
  env?: LocalWebTransportEnv;
  globalConfig?: Partial<LocalWebTransportConfig>;
  fetch?: typeof fetch;
}

let cachedRuntimeIpc: RuntimeIpcClient | undefined;

export function getRuntimeMode(
  options: RuntimeClientOptions = {},
): RuntimeMode {
  const config = readLocalWebTransportConfig(options.env, options.globalConfig);
  return config ? "local-web" : "electron";
}

export function isLocalWebRuntime(options: RuntimeClientOptions = {}): boolean {
  return getRuntimeMode(options) === "local-web";
}

export function getRuntimeIpc(
  options: RuntimeClientOptions = {},
): RuntimeIpcClient {
  if (hasExplicitRuntimeOptions(options)) {
    return createRuntimeIpc(options);
  }
  cachedRuntimeIpc ??= createRuntimeIpc();
  return cachedRuntimeIpc;
}

export function resetRuntimeIpcForTests(): void {
  cachedRuntimeIpc = undefined;
}

export function createRuntimeIpc(options: RuntimeClientOptions = {}) {
  const config = readLocalWebTransportConfig(options.env, options.globalConfig);
  const eventTransport = config
    ? createLocalWebEventTransport({
        baseUrl: config.baseUrl,
        eventUrl: config.eventUrl,
        token: config.token,
        fetch: options.fetch,
        preferWebSocket: false,
      })
    : createElectronIpcTransport();
  const invokeTransport = config
    ? createLocalWebInvokeTransport(config, options.fetch, (event) => {
        eventTransport.emit?.(event.channel, event.payload);
      })
    : eventTransport;

  return createRuntimeIpcFromTransports(invokeTransport, eventTransport);
}

export function createRuntimeIpcFromTransports(
  invokeTransport: IpcTransport,
  eventTransport: IpcTransport = invokeTransport,
) {
  return {
    settings: createClient(settingsContracts, invokeTransport),
    app: createClient(appContracts, invokeTransport),
    chat: createClient(chatContracts, invokeTransport),
    agent: createClient(agentContracts, invokeTransport),
    chatStream: createStreamClient(
      chatStreamContract,
      composeTransports(invokeTransport, eventTransport),
    ),
    helpStream: createStreamClient(
      helpStreamContract,
      composeTransports(invokeTransport, eventTransport),
    ),
    github: createClient(githubContracts, invokeTransport),
    git: createClient(gitContracts, invokeTransport),
    mcp: createClient(mcpContracts, invokeTransport),
    vercel: createClient(vercelContracts, invokeTransport),
    supabase: createClient(supabaseContracts, invokeTransport),
    neon: createClient(neonContracts, invokeTransport),
    migration: createClient(migrationContracts, invokeTransport),
    system: createClient(systemContracts, invokeTransport),
    version: createClient(versionContracts, invokeTransport),
    languageModel: createClient(languageModelContracts, invokeTransport),
    prompt: createClient(promptContracts, invokeTransport),
    template: createClient(templateContracts, invokeTransport),
    proposal: createClient(proposalContracts, invokeTransport),
    import: createClient(importContracts, invokeTransport),
    help: createClient(helpContracts, invokeTransport),
    capacitor: createClient(capacitorContracts, invokeTransport),
    context: createClient(contextContracts, invokeTransport),
    upgrade: createClient(upgradeContracts, invokeTransport),
    visualEditing: createClient(visualEditingContracts, invokeTransport),
    security: createClient(securityContracts, invokeTransport),
    misc: createClient(miscContracts, invokeTransport),
    freeAgentQuota: createClient(freeAgentQuotaContracts, invokeTransport),
    audio: createClient(audioContracts, invokeTransport),
    media: createClient(mediaContracts, invokeTransport),
    imageGeneration: createClient(imageGenerationContracts, invokeTransport),
    appBlueprint: createClient(appBlueprintContracts, invokeTransport),
    appCollection: createClient(appCollectionContracts, invokeTransport),
    terminal: createClient(terminalContracts, invokeTransport),
    plan: createClient(planContracts, invokeTransport),
    integration: createClient(integrationContracts, invokeTransport),
    events: {
      on: eventTransport.on?.bind(eventTransport),
      agent: createEventClient(agentEvents, eventTransport),
      github: createEventClient(githubEvents, eventTransport),
      mcp: createEventClient(mcpEvents, eventTransport),
      system: createEventClient(systemEvents, eventTransport),
      misc: createEventClient(miscEvents, eventTransport),
      appBlueprint: createEventClient(appBlueprintEvents, eventTransport),
      plan: createEventClient(planEvents, eventTransport),
      integration: createEventClient(integrationEvents, eventTransport),
    },
  } as const;
}

function composeTransports(
  invokeTransport: IpcTransport,
  eventTransport: IpcTransport,
): IpcTransport {
  return {
    invoke: invokeTransport.invoke,
    on: eventTransport.on,
    ready: eventTransport.ready,
    supportsStreamingInvoke: invokeTransport.supportsStreamingInvoke,
  };
}

function hasExplicitRuntimeOptions(options: RuntimeClientOptions): boolean {
  return Boolean(options.env || options.globalConfig || options.fetch);
}
