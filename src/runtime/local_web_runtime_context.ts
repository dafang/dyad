let localWebRuntime = false;

export function configureLocalWebRuntimeContext(enabled: boolean): void {
  localWebRuntime = enabled;
}

export function isLocalWebRuntimeContext(): boolean {
  return localWebRuntime;
}
