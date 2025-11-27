export interface ExecOptions {
  timeout?: number;
  cwd?: string;
  restart?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  interrupted: boolean;
}

export interface Sandbox {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  fileExists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  destroy(): Promise<void>;
}
