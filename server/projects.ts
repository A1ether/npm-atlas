import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  DependencyType,
  PackageManager,
  ProjectCandidate,
  ProjectDiscovery,
  ProjectImportResponse,
  ProjectInfo,
  ProjectListResult,
  ProjectPackage,
  ProjectRoot,
  ProjectRootsResult,
} from '../shared/types';
import { mapLimit } from './async';
import { HttpError } from './http';
import {
  addProjectPaths,
  displayProjectPath,
  projectId,
  readProjectRecords,
  removeProjectRecords,
  type ProjectRecord,
} from './projectStore';
import { runCommand } from './run';

const HOME = homedir();
const IS_WINDOWS = process.platform === 'win32';
const MANIFEST = 'package.json';
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 6;
const MAX_DIRS = 8_000;
const MAX_CANDIDATES = 300;
const DISCOVERY_BATCH = 16;
const DISCOVERY_TIME_LIMIT_MS = 30_000;
const INSTALLED_CONCURRENCY = 24;
const PROJECT_CONCURRENCY = 3;
const OUTDATED_TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 60_000;

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

const SKIP_DIRS = new Set(
  [
    'node_modules',
    'bower_components',
    'jspm_packages',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.output',
    '.svelte-kit',
    '.turbo',
    '.cache',
    '.parcel-cache',
    'vendor',
    'pods',
    'deriveddata',
    'target',
    '.venv',
    'venv',
    '__pycache__',
    '.tox',
    '.mypy_cache',
    '.pytest_cache',
    'temp',
    'tmp',
    'logs',
    'library',
    'applications',
    'movies',
    'music',
    'pictures',
    'public',
  ].map((name) => name.toLowerCase()),
);

const BLOCKED_ROOTS = new Set(
  [
    '/',
    '/system',
    '/library',
    '/applications',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/dev',
    '/proc',
    '/sys',
    '/var',
    '/private',
  ].map((value) => (IS_WINDOWS ? value.toLowerCase() : value)),
);

const LOCKFILES: { file: string; manager: PackageManager }[] = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

const LINKED_PREFIXES = [
  'workspace:',
  'file:',
  'link:',
  'portal:',
  'patch:',
  'catalog:',
  'npm:',
  'git+',
  'git:',
  'github:',
  'gitlab:',
  'bitbucket:',
  'http://',
  'https://',
  'ssh:',
];

interface ManifestRead {
  ok: boolean;
  data: Record<string, unknown> | null;
  missing: boolean;
  error?: string;
}

interface DependencySpec {
  name: string;
  range: string;
  type: DependencyType;
  linked: boolean;
}

interface OutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
}

interface OutdatedResult {
  map: Map<string, OutdatedEntry>;
  warning?: string;
}

interface ParseResult {
  map: Map<string, OutdatedEntry>;
  valid: boolean;
}

function errorMessage(error: unknown): string {
  return truncate(
    error instanceof Error ? error.message : String(error),
    300,
  );
}

function truncate(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function readdirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function readProjectManifest(dir: string): Promise<ManifestRead> {
  const file = path.join(dir, MANIFEST);
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      return { ok: false, data: null, missing: true, error: `${MANIFEST} 不是文件` };
    }
    if (info.size > MAX_MANIFEST_BYTES) {
      return { ok: false, data: null, missing: false, error: `${MANIFEST} 超过 4MB` };
    }
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(stripBom(raw));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        data: null,
        missing: false,
        error: `${MANIFEST} 必须是 JSON 对象`,
      };
    }
    return { ok: true, data: data as Record<string, unknown>, missing: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, data: null, missing: true, error: `${MANIFEST} 不存在` };
    }
    return {
      ok: false,
      data: null,
      missing: false,
      error: `无法读取 ${MANIFEST}：${errorMessage(error)}`,
    };
  }
}

function linkedSpec(range: string): boolean {
  const value = range.trim().toLowerCase();
  if (!value) return true;
  if (LINKED_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  if (/^[.]{1,2}\//.test(value) || value.startsWith('/') || value.startsWith('~/')) {
    return true;
  }
  if (/^[a-z]:[\\/]/.test(value)) return true;
  return false;
}

export function collectDependencySpecs(
  data: Record<string, unknown>,
): DependencySpec[] {
  const seen = new Set<string>();
  const result: DependencySpec[] = [];

  const fields: [string, DependencyType][] = [
    ['dependencies', 'prod'],
    ['devDependencies', 'dev'],
    ['optionalDependencies', 'optional'],
    ['peerDependencies', 'peer'],
  ];

  for (const [field, type] of fields) {
    const value = data[field];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [rawName, rawRange] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const name = rawName.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const range = typeof rawRange === 'string' ? rawRange : String(rawRange ?? '');
      result.push({ name, range, type, linked: linkedSpec(range) });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function manifestHasWorkspaces(data: Record<string, unknown>): boolean {
  const value = data.workspaces;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    const packages = (value as Record<string, unknown>).packages;
    return Array.isArray(packages) && packages.length > 0;
  }
  return false;
}

const PNPM_WORKSPACE_FILES = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'];

function detectWorkspaces(
  data: Record<string, unknown>,
  entryNames: Set<string>,
): boolean {
  return (
    manifestHasWorkspaces(data) ||
    PNPM_WORKSPACE_FILES.some((file) => entryNames.has(file))
  );
}

function managerFromField(value: unknown): PackageManager | null {
  if (typeof value !== 'string') return null;
  const match = /^(npm|pnpm|yarn|bun)@/i.exec(value.trim());
  return match ? (match[1].toLowerCase() as PackageManager) : null;
}

function detectPackageManager(
  data: Record<string, unknown>,
  dir: string,
  entryNames: Set<string>,
): {
  manager: PackageManager;
  source: ProjectInfo['packageManagerSource'];
  lockfile: string | null;
} {
  const fieldManager = managerFromField(data.packageManager);
  if (fieldManager) {
    const lock = LOCKFILES.find(
      (item) => item.manager === fieldManager && entryNames.has(item.file),
    );
    return {
      manager: fieldManager,
      source: 'field',
      lockfile: lock?.file ?? null,
    };
  }

  for (const item of LOCKFILES) {
    if (entryNames.has(item.file)) {
      return { manager: item.manager, source: 'lockfile', lockfile: item.file };
    }
  }

  if (entryNames.has('.pnp.cjs')) {
    return { manager: 'yarn', source: 'node_modules', lockfile: null };
  }
  if (existsSync(path.join(dir, 'node_modules', '.pnpm'))) {
    return { manager: 'pnpm', source: 'node_modules', lockfile: null };
  }
  if (existsSync(path.join(dir, 'node_modules', '.package-lock.json'))) {
    return { manager: 'npm', source: 'node_modules', lockfile: null };
  }

  return { manager: 'npm', source: 'default', lockfile: null };
}

export interface ProjectInspection {
  ok: boolean;
  manager: PackageManager;
  hasWorkspaces: boolean;
  data: Record<string, unknown> | null;
  error?: string;
}

/** Fresh manifest + package-manager detection used before running an action. */
export async function inspectProject(dir: string): Promise<ProjectInspection> {
  const manifest = await readProjectManifest(dir);
  if (!manifest.ok || !manifest.data) {
    return {
      ok: false,
      manager: 'npm',
      hasWorkspaces: false,
      data: null,
      error: manifest.error ?? `无法读取 ${MANIFEST}`,
    };
  }

  const entryNames = new Set(await readdirNames(dir));
  const detected = detectPackageManager(manifest.data, dir, entryNames);
  return {
    ok: true,
    manager: detected.manager,
    hasWorkspaces: detectWorkspaces(manifest.data, entryNames),
    data: manifest.data,
  };
}

function majorOf(version: string | null | undefined): number | null {
  if (!version) return null;
  const match = /^v?(\d+)/.exec(version);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function readInstalledVersions(
  dir: string,
  specs: DependencySpec[],
): Promise<(string | null)[]> {
  return mapLimit(specs, INSTALLED_CONCURRENCY, async (spec) => {
    if (!PACKAGE_NAME.test(spec.name)) return null;
    try {
      const raw = await readFile(
        path.join(dir, 'node_modules', ...spec.name.split('/'), MANIFEST),
        'utf8',
      );
      const data = JSON.parse(stripBom(raw)) as { version?: unknown };
      return optionalString(data.version) ?? null;
    } catch {
      return null;
    }
  });
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseNpmLike(text: string): ParseResult {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { map: new Map(), valid: false };
  }

  const map = new Map<string, OutdatedEntry>();
  for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    map.set(name, {
      current: optionalString(row.current),
      wanted: optionalString(row.wanted),
      latest: optionalString(row.latest),
    });
  }
  return { map, valid: true };
}

function splitTableCells(line: string): string[] {
  if (line.includes('|')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells;
  }
  return line
    .trim()
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isBorderLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  return /^[|+\-─┌┬┐├┼┤└┴┘┏┳┓┣╋┫┗┻┛\s]+$/.test(trimmed) && /[-─]/.test(trimmed);
}

function parseTable(text: string): ParseResult {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const map = new Map<string, OutdatedEntry>();

  for (let index = 0; index < lines.length; index += 1) {
    const header = splitTableCells(lines[index]);
    if (header.length < 3) continue;
    const lowered = header.map((cell) => cell.toLowerCase());
    const nameIndex = lowered.findIndex(
      (cell) => cell === 'package' || cell === 'name',
    );
    const currentIndex = lowered.findIndex((cell) => cell === 'current');
    const latestIndex = lowered.findIndex((cell) => cell === 'latest');
    const wantedIndex = lowered.findIndex(
      (cell) => cell === 'wanted' || cell === 'update',
    );
    if (nameIndex < 0 || currentIndex < 0 || latestIndex < 0) continue;

    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      if (!line.trim() || isBorderLine(line)) continue;
      const cells = splitTableCells(line);
      const needed = Math.max(nameIndex, currentIndex, latestIndex);
      if (cells.length <= needed) {
        if (!line.includes('|')) break;
        continue;
      }
      const name = cells[nameIndex];
      if (!PACKAGE_NAME.test(name)) continue;
      map.set(name, {
        current: cells[currentIndex],
        wanted: wantedIndex >= 0 ? cells[wantedIndex] : undefined,
        latest: cells[latestIndex],
      });
    }
    return { map, valid: true };
  }

  if (/no outdated dependencies|all packages are up to date/i.test(clean)) {
    return { map, valid: true };
  }
  return { map, valid: false };
}

function parseYarn(text: string): ParseResult {
  const map = new Map<string, OutdatedEntry>();
  let valid = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const record = event as Record<string, unknown>;
    if (record.type !== 'table' || !record.data) continue;
    const data = record.data as Record<string, unknown>;
    const head = Array.isArray(data.head) ? data.head.map(String) : [];
    const body = Array.isArray(data.body) ? data.body : [];
    if (!head.length) continue;

    const nameIndex = head.findIndex((cell) => /package/i.test(cell));
    const currentIndex = head.findIndex((cell) => /current/i.test(cell));
    const wantedIndex = head.findIndex((cell) => /wanted|update/i.test(cell));
    const latestIndex = head.findIndex((cell) => /latest/i.test(cell));
    if (nameIndex < 0 || currentIndex < 0 || latestIndex < 0) continue;

    valid = true;
    for (const row of body) {
      if (!Array.isArray(row)) continue;
      const name = String(row[nameIndex] ?? '').trim();
      if (!name) continue;
      map.set(name, {
        current: optionalString(row[currentIndex]),
        wanted: wantedIndex >= 0 ? optionalString(row[wantedIndex]) : undefined,
        latest: optionalString(row[latestIndex]),
      });
    }
  }

  if (valid) return { map, valid };
  return parseTable(text);
}

function parseOutdated(manager: PackageManager, stdout: string): ParseResult {
  if (manager === 'npm' || manager === 'pnpm') return parseNpmLike(stdout);
  if (manager === 'yarn') return parseYarn(stdout);
  return parseTable(stdout);
}

function outdatedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_update_notifier: 'false',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
}

function failureMessage(
  manager: PackageManager,
  result: Awaited<ReturnType<typeof runCommand>>,
): string {
  if (result.timedOut) {
    return `${manager} 检查超时（${OUTDATED_TIMEOUT_MS / 1000} 秒）`;
  }
  if (/ENOENT/.test(result.error ?? '')) return `未找到 ${manager} 命令`;
  const stderr = truncate(firstLine(result.stderr), 240);
  return `${manager} 检查失败${stderr ? `：${stderr}` : ''}`;
}

async function checkOutdated(
  dir: string,
  manager: PackageManager,
): Promise<OutdatedResult> {
  const attempts: PackageManager[] = manager === 'npm' ? ['npm'] : [manager, 'npm'];
  let firstFailure = '';

  for (const [index, attempt] of attempts.entries()) {
    const args = attempt === 'bun' ? ['outdated'] : ['outdated', '--json'];
    const result = await runCommand(attempt, args, {
      cwd: dir,
      env: outdatedEnv(),
      timeout: OUTDATED_TIMEOUT_MS,
    });
    const parsed = parseOutdated(attempt, result.stdout);

    if (parsed.valid) {
      return {
        map: parsed.map,
        warning:
          index > 0 && firstFailure
            ? `${firstFailure}，已改用 npm 检查最新版本`
            : undefined,
      };
    }

    const failure = failureMessage(attempt, result);
    if (index === 0) firstFailure = failure;
    if (index === attempts.length - 1) {
      return {
        map: new Map(),
        warning: firstFailure ? `${firstFailure}；${failure}` : failure,
      };
    }
  }

  return { map: new Map(), warning: firstFailure || '无法检查最新版本' };
}

function emptyProject(
  projectPath: string,
  addedAt: string,
  options: { missing?: boolean; error?: string } = {},
): ProjectInfo {
  return {
    id: projectId(projectPath),
    path: projectPath,
    displayPath: displayProjectPath(projectPath),
    name: path.basename(projectPath) || projectPath,
    version: null,
    description: null,
    isPrivate: false,
    packageManager: 'npm',
    packageManagerSource: 'default',
    lockfile: null,
    hasNodeModules: false,
    hasWorkspaces: false,
    packages: [],
    packageCount: 0,
    outdatedCount: 0,
    linkedCount: 0,
    addedAt,
    scannedAt: new Date().toISOString(),
    missing: options.missing,
    error: options.error,
  };
}

export async function loadProject(
  projectPath: string,
  addedAt: string,
): Promise<ProjectInfo> {
  const manifest = await readProjectManifest(projectPath);
  if (!manifest.ok || !manifest.data) {
    const dirExists = await isDirectory(projectPath);
    return emptyProject(projectPath, addedAt, {
      missing: !dirExists,
      error: dirExists
        ? manifest.error ?? `无法读取 ${MANIFEST}`
        : '项目目录不存在',
    });
  }

  const data = manifest.data;
  const entryNames = new Set(await readdirNames(projectPath));
  const detected = detectPackageManager(data, projectPath, entryNames);
  const specs = collectDependencySpecs(data);
  const installed = await readInstalledVersions(projectPath, specs);

  const needsOutdated = specs.some((spec) => spec.type !== 'peer');
  // Without a bun lockfile, `bun outdated` may migrate the project's
  // lockfile as a side effect; use the read-only npm query instead.
  const outdatedManager =
    detected.manager === 'bun' && !detected.lockfile
      ? 'npm'
      : detected.manager;
  const outdated = needsOutdated
    ? await checkOutdated(projectPath, outdatedManager)
    : { map: new Map<string, OutdatedEntry>() };
  const bunFallbackWarning =
    needsOutdated &&
    detected.manager === 'bun' &&
    !detected.lockfile
      ? '未找到 bun 锁文件，已改用 npm 检查最新版本'
      : undefined;

  const packages: ProjectPackage[] = specs.map((spec, index) => {
    const update = outdated.map.get(spec.name);
    const installedVersion = installed[index] ?? update?.current ?? null;
    const latest = update?.latest;
    const isOutdated = Boolean(
      installedVersion && latest && latest !== installedVersion,
    );
    const installedMajor = majorOf(installedVersion);
    const latestMajor = majorOf(latest);
    return {
      name: spec.name,
      range: spec.range,
      type: spec.type,
      installed: installedVersion,
      latest,
      outdated: isOutdated,
      linked: spec.linked,
      major:
        isOutdated &&
        installedMajor !== null &&
        latestMajor !== null &&
        installedMajor !== latestMajor,
    };
  });

  return {
    id: projectId(projectPath),
    path: projectPath,
    displayPath: displayProjectPath(projectPath),
    name: optionalString(data.name) ?? path.basename(projectPath) ?? projectPath,
    version: optionalString(data.version) ?? null,
    description: optionalString(data.description) ?? null,
    isPrivate: data.private === true,
    packageManager: detected.manager,
    packageManagerSource: detected.source,
    lockfile: detected.lockfile,
    hasNodeModules: entryNames.has('node_modules'),
    hasWorkspaces: detectWorkspaces(data, entryNames),
    packages,
    packageCount: packages.length,
    outdatedCount: packages.filter((entry) => entry.outdated).length,
    linkedCount: packages.filter((entry) => entry.linked).length,
    addedAt,
    scannedAt: new Date().toISOString(),
    warning:
      [outdated.warning, bunFallbackWarning].filter(Boolean).join('；') ||
      undefined,
  };
}

async function safeLoadProject(record: ProjectRecord): Promise<ProjectInfo> {
  try {
    return await loadProject(record.path, record.addedAt);
  } catch (error) {
    return emptyProject(record.path, record.addedAt, {
      error: errorMessage(error),
    });
  }
}

const projectCache = new Map<string, { info: ProjectInfo; time: number }>();
let listCache: { result: ProjectListResult; time: number } | null = null;
let inflight: Promise<ProjectListResult> | null = null;
let inflightForce = false;

async function buildList(
  force: boolean,
  forceIds: Set<string> = new Set(),
): Promise<ProjectListResult> {
  const startedAt = Date.now();
  const records = await readProjectRecords();
  const currentIds = new Set(records.map((record) => record.id));

  for (const id of [...projectCache.keys()]) {
    if (!currentIds.has(id)) projectCache.delete(id);
  }

  const projects = await mapLimit(records, PROJECT_CONCURRENCY, async (record) => {
    const cached = projectCache.get(record.id);
    if (
      !force &&
      !forceIds.has(record.id) &&
      cached &&
      Date.now() - cached.time < CACHE_TTL_MS
    ) {
      return cached.info;
    }

    const info = await safeLoadProject(record);
    projectCache.set(record.id, { info, time: Date.now() });
    return info;
  });

  return {
    projects,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };
}

async function rebuild(
  forceIds: Set<string> = new Set(),
  forceAll = false,
): Promise<ProjectListResult> {
  const result = await buildList(forceAll, forceIds);
  listCache = { result, time: Date.now() };
  return result;
}

export async function getProjects(force = false): Promise<ProjectListResult> {
  if (
    !force &&
    listCache &&
    Date.now() - listCache.time < CACHE_TTL_MS
  ) {
    return listCache.result;
  }
  if (inflight) {
    if (!force || inflightForce) return inflight;
    await inflight;
  }

  inflightForce = force;
  inflight = buildList(force)
    .then((result) => {
      listCache = { result, time: Date.now() };
      return result;
    })
    .finally(() => {
      inflight = null;
      inflightForce = false;
    });

  return inflight;
}

export async function refreshProject(id: string): Promise<ProjectListResult> {
  const records = await readProjectRecords();
  if (!records.some((record) => record.id === id)) {
    throw new HttpError(400, '未找到该项目，请重新导入');
  }
  projectCache.delete(id);
  return rebuild(new Set([id]));
}

export async function importProjects(
  paths: string[],
): Promise<ProjectImportResponse> {
  const { records, added } = await addProjectPaths(paths);
  const addedIds = new Set(added.map((record) => record.id));
  for (const id of addedIds) projectCache.delete(id);

  const result = addedIds.size
    ? await rebuild(addedIds)
    : records.length
      ? await getProjects(false)
      : await rebuild();

  return {
    imported: [...addedIds],
    list: result,
  };
}

export async function removeProjects(ids: string[]): Promise<ProjectListResult> {
  await removeProjectRecords(ids);
  for (const id of ids) projectCache.delete(id);
  return rebuild();
}

function normalizeRootKey(value: string): string {
  const resolved = path.resolve(value);
  return IS_WINDOWS ? resolved.toLowerCase() : resolved;
}

async function resolveScanRoot(input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input.trim()) {
    throw new HttpError(400, '请输入要扫描的目录');
  }

  const trimmed = input.trim();
  const expanded =
    trimmed === '~'
      ? HOME
      : trimmed.startsWith('~/') || trimmed.startsWith(`~${path.sep}`)
        ? path.join(HOME, trimmed.slice(2))
        : trimmed;

  if (!path.isAbsolute(expanded)) {
    throw new HttpError(400, '请输入绝对路径（或使用 ~ 开头）');
  }

  let canonical: string;
  try {
    canonical = await realpath(expanded);
  } catch {
    throw new HttpError(400, `目录不存在：${trimmed}`);
  }

  if (!(await isDirectory(canonical))) {
    throw new HttpError(400, `不是目录：${trimmed}`);
  }

  const key = normalizeRootKey(canonical);
  if (path.parse(canonical).root === canonical || BLOCKED_ROOTS.has(key)) {
    throw new HttpError(400, '为安全起见，请选择具体的项目父目录（不要直接扫描系统根目录）');
  }

  return path.normalize(canonical);
}

function isSkippedDirName(name: string): boolean {
  if (name.startsWith('.')) return true;
  return SKIP_DIRS.has(name.toLowerCase());
}

async function readCandidate(
  dir: string,
  entryNames: Set<string>,
  importedIds: Set<string>,
): Promise<ProjectCandidate | null> {
  const manifest = await readProjectManifest(dir);
  if (!manifest.ok || !manifest.data) return null;
  const data = manifest.data;
  const specs = collectDependencySpecs(data);
  const detected = detectPackageManager(data, dir, entryNames);
  const id = projectId(dir);

  return {
    id,
    path: dir,
    displayPath: displayProjectPath(dir),
    name: optionalString(data.name) ?? path.basename(dir),
    version: optionalString(data.version) ?? null,
    isPrivate: data.private === true,
    packageManager: detected.manager,
    dependencyCount: specs.filter((spec) => spec.type === 'prod').length,
    devDependencyCount: specs.filter((spec) => spec.type === 'dev').length,
    hasNodeModules: entryNames.has('node_modules'),
    imported: importedIds.has(id),
  };
}

export async function discoverProjects(
  inputRoot: unknown,
  inputDepth: unknown,
): Promise<ProjectDiscovery> {
  const startedAt = Date.now();
  const root = await resolveScanRoot(inputRoot);
  const requestedDepth =
    typeof inputDepth === 'number' && Number.isFinite(inputDepth)
      ? Math.floor(inputDepth)
      : DEFAULT_DEPTH;
  const depth = Math.min(MAX_DEPTH, Math.max(1, requestedDepth));

  const records = await readProjectRecords();
  const importedIds = new Set(records.map((record) => record.id));
  const candidates: ProjectCandidate[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let cursor = 0;
  let visited = 0;
  let truncated = false;

  while (cursor < queue.length) {
    if (
      visited >= MAX_DIRS ||
      candidates.length >= MAX_CANDIDATES ||
      Date.now() - startedAt >= DISCOVERY_TIME_LIMIT_MS
    ) {
      truncated = true;
      break;
    }

    const batch = queue.slice(cursor, cursor + DISCOVERY_BATCH);
    cursor += batch.length;

    const results = await Promise.all(
      batch.map(async (item) => {
        visited += 1;
        let entries;
        try {
          entries = await readdir(item.dir, { withFileTypes: true });
        } catch {
          return [];
        }

        const entryNames = new Set(entries.map((entry) => entry.name));
        if (entryNames.has(MANIFEST) && candidates.length < MAX_CANDIDATES) {
          const candidate = await readCandidate(item.dir, entryNames, importedIds);
          if (candidate) candidates.push(candidate);
        }

        if (item.depth >= depth) return [];
        const children: { dir: string; depth: number }[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (isSkippedDirName(entry.name)) continue;
          children.push({
            dir: path.join(item.dir, entry.name),
            depth: item.depth + 1,
          });
        }
        return children;
      }),
    );

    for (const children of results) queue.push(...children);
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));

  return {
    root,
    displayRoot: displayProjectPath(root),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    visited,
    truncated,
    durationMs: Date.now() - startedAt,
  };
}

const SUGGESTED_ROOTS = [
  'DevSpace',
  'Projects',
  'projects',
  'code',
  'Code',
  'workspace',
  'Developer',
  'src',
  'repos',
  'DataGripProjects',
  'WebstormProjects',
  'IdeaProjects',
  'Desktop',
  'Documents',
];

export async function getProjectRoots(): Promise<ProjectRootsResult> {
  const roots: ProjectRoot[] = [];

  for (const name of SUGGESTED_ROOTS) {
    const candidate = path.join(HOME, name);
    if (await isDirectory(candidate)) {
      roots.push({ path: candidate, displayPath: `~/${name}` });
    }
  }

  roots.push({ path: HOME, displayPath: '~' });
  return {
    defaultRoot: roots.find((root) => root.path !== HOME)?.path ?? HOME,
    roots,
  };
}
