import type { TypedBackendRegistry } from "./local_backend_host";
import type { LocalRpcServer } from "./local_rpc_server";

export function registerLocalHttpBackendHandlers(
  server: LocalRpcServer,
  registry: TypedBackendRegistry,
): void {
  for (const contract of registry.entries()) {
    server.register(contract, (_input, requestContext) =>
      registry.invoke(contract.channel, _input, {
        channel: contract.channel,
        transport: "local-http",
        native: requestContext,
      }),
    );
  }
}
