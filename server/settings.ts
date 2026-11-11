import { constants, existsSync } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { NpmSource } from '../shared/types';

export const HOME = homedir();
export const IS_WINDOWS = process.platform === 'win32';
export const NPM_BIN = IS_WINDOWS ? 'npm.cmd' : 'npm';
export const NPX_BIN = IS_WINDOWS ? 'npx.cmd' : 'npx';

export const MARK_START = '# >>> npm-atlas >>>';
export const MARK_END = '# <<< npm-atlas <<<';

function resolveStateDir(): string {
  const override = process.env.ATLAS_STATE_DIR;
  return override ? path.resolve(override) : path.join(HOME, '.npm-atlas');
}

const stateDir = resolveStateDir();

export const ATLAS_PATHS = {
  stateDir,
  wrapperDir: path.join(stateDir, 'bin'),
  wrapperNpm: path.join(stateDir, 'bin', NPM_BIN),
  wrapperNpx: path.join(stateDir, 'bin', NPX_BIN),
  stateFile: path.join(stateDir, 'state.json'),
  projectsFile: path.join(stateDir, 'projects.json'),
};

export interface StoredDefaultState {
  version: 1;
  targetPath: string;
  targetRealPath: string;
  npmVersion: string | null;
  nodeVersion: string | null;
  source: NpmSource;
  updatedAt: string;
}

export interface ShellInfo {
  shell: string;
  rcFile: string | null;
  supported: boolean;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$')}"`;
}

function rcOverride(): string | null {
  const override = process.env.ATLAS_RC_FILE;
  return override ? path.resolve(override) : null;
}

export function detectShell(): ShellInfo {
  const override = rcOverride();
  const shellName = path.basename(process.env.SHELL ?? '');

  if (shellName === 'zsh') {
    return {
      shell: 'zsh',
      rcFile: override ?? path.join(HOME, '.zshrc'),
      supported: true,
    };
  }

  if (shellName === 'bash') {
    const bashrc = path.join(HOME, '.bashrc');
    const profile = path.join(HOME, '.bash_profile');
    return {
      shell: 'bash',
      rcFile: override ?? (existsSync(profile) ? profile : bashrc),
      supported: true,
    };
  }

  if (shellName === 'fish') {
    return {
      shell: 'fish',
      rcFile: override ?? path.join(HOME, '.config', 'fish', 'config.fish'),
      supported: true,
    };
  }

  return {
    shell: shellName || 'unknown',
    rcFile: override,
    supported: false,
  };
}

export function buildShellSnippet(shell: string): string | null {
  const dir = ATLAS_PATHS.wrapperDir;

  if (shell === 'fish') {
    return [
      MARK_START,
      '# Managed by npm-atlas. Prepends the selected npm to PATH.',
      `set -gx PATH ${fishQuote(dir)} $PATH`,
      MARK_END,
    ].join('\n');
  }

  if (shell === 'zsh' || shell === 'bash' || shell === 'sh') {
    return [
      MARK_START,
      '# Managed by npm-atlas. Prepends the selected npm to PATH.',
      `export PATH=${shellQuote(dir)}:"$PATH"`,
      MARK_END,
    ].join('\n');
  }

  return null;
}

export function buildManualSnippet(): string {
  return `export PATH=${shellQuote(ATLAS_PATHS.wrapperDir)}:"$PATH"`;
}

export function shortPath(file: string | null): string | null {
  if (!file) return null;
  return file.startsWith(`${HOME}${path.sep}`)
    ? `~${file.slice(HOME.length)}`
    : file;
}

export function isAtlasWrapperPath(file: string): boolean {
  const normalized = path.resolve(file);
  const wrapperDir = path.resolve(ATLAS_PATHS.wrapperDir);
  return (
    normalized === wrapperDir ||
    normalized.startsWith(`${wrapperDir}${path.sep}`)
  );
}

export async function readStoredState(): Promise<StoredDefaultState | null> {
  try {
    const raw = await readFile(ATLAS_PATHS.stateFile, 'utf8');
    const data = JSON.parse(raw) as Partial<StoredDefaultState>;
    if (
      data.version !== 1 ||
      typeof data.targetPath !== 'string' ||
      typeof data.targetRealPath !== 'string'
    ) {
      return null;
    }
    return data as StoredDefaultState;
  } catch {
    return null;
  }
}

async function writeAtomic(
  file: string,
  content: string,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, { mode });
  await chmod(temp, mode);
  await rename(temp, file);
}

export async function writeStoredState(
  state: StoredDefaultState,
): Promise<void> {
  await writeAtomic(
    ATLAS_PATHS.stateFile,
    `${JSON.stringify(state, null, 2)}\n`,
    0o600,
  );
}

export async function clearStoredState(): Promise<void> {
  await rm(ATLAS_PATHS.stateFile, { force: true });
}

async function readTextFile(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

/** Edit the file a dotfile symlink points at, not the symlink itself. */
async function resolveRcTarget(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch {
    return file;
  }
}

function fileMode(file: string): Promise<number | null> {
  return stat(file).then(
    (info) => info.mode,
    () => null,
  );
}

async function backupFile(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  const backup = `${file}.npm-atlas.${Date.now()}.bak`;
  await copyFile(file, backup);
  return backup;
}

export function upsertMarkerBlock(content: string, snippet: string): string {
  const start = content.indexOf(MARK_START);
  const end = content.indexOf(MARK_END);

  if (start >= 0 && end > start) {
    return `${content.slice(0, start)}${snippet}${content.slice(end + MARK_END.length)}`;
  }

  const prefix = content.length && !content.endsWith('\n') ? `${content}\n` : content;
  return `${prefix}\n${snippet}\n`;
}

export function stripMarkerBlock(content: string): string {
  const start = content.indexOf(MARK_START);
  const end = content.indexOf(MARK_END);
  if (start < 0 || end < start) return content;

  const before = content.slice(0, start).replace(/\n+$/, '\n');
  const after = content.slice(end + MARK_END.length).replace(/^\n+/, '');
  return `${before}${after}`.replace(/\n{3,}/g, '\n\n');
}

export async function isIntegrationInstalled(
  rcFile: string | null,
): Promise<boolean> {
  if (!rcFile) return false;
  const content = await readTextFile(rcFile);
  return content.includes(MARK_START) && content.includes(MARK_END);
}

export interface ShellEditResult {
  rcFile: string;
  changed: boolean;
  backup: string | null;
}

export async function syncShellIntegration(
  snippet: string,
): Promise<ShellEditResult | null> {
  const shell = detectShell();
  if (!shell.rcFile || !shell.supported) return null;

  const target = await resolveRcTarget(shell.rcFile);
  const current = await readTextFile(target);
  const next = upsertMarkerBlock(current, snippet);
  if (next === current) {
    return { rcFile: target, changed: false, backup: null };
  }

  const backup = await backupFile(target);
  const mode = (await fileMode(target)) ?? 0o644;
  await writeAtomic(target, next, mode);
  return { rcFile: target, changed: true, backup };
}

export async function removeShellIntegration(): Promise<ShellEditResult | null> {
  const shell = detectShell();
  if (!shell.rcFile) return null;

  const target = await resolveRcTarget(shell.rcFile);
  const current = await readTextFile(target);
  if (!current.includes(MARK_START)) return null;

  const next = stripMarkerBlock(current);
  const backup = await backupFile(target);
  const mode = (await fileMode(target)) ?? 0o644;
  await writeAtomic(target, next, mode);
  return { rcFile: target, changed: true, backup };
}

export async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, IS_WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}