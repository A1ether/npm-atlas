import { execFile } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

/**
 * Runs a command without a shell. Output is always captured so npm's
 * non-zero exit codes (e.g. `npm outdated`) can still be parsed.
 */
export function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout ?? 30_000,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const err = error as
          | (Error & { code?: number | string; killed?: boolean; signal?: string })
          | null;

        resolve({
          code: typeof err?.code === 'number' ? err.code : err ? null : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          timedOut: Boolean(err?.killed),
          error: err?.message,
        });
      },
    );
  });
}