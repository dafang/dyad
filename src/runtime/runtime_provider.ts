export interface ResolveWorkspacePathInput {
  workspaceRoot: string;
  relativePath?: string;
}

export interface RunCommandInput {
  workspaceRoot: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RuntimeProvider {
  resolveWorkspacePath(input: ResolveWorkspacePathInput): Promise<string>;
  runCommand(input: RunCommandInput): Promise<RunCommandResult>;
}
