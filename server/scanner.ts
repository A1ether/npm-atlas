import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  GlobalPackage,
  NpmInstallation,
  NpmSource,
  ScanResult,
} from '../shared/types';
import { runCommand } from './run';

const HOME = homedir();
const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === 'win32';
const NPM_BIN = IS_WINDOWS ? 'npm.cmd' : 'npm';
const PATH_SEP = IS_WINDOWS ? ';' : ':';
const CACHE_TTL_MS = 30_000;

const SOURCE_ORDER: Record<NpmSource, number> = {
  mise: 0,
  nvm: 1,
  fnm: 2,
  asdf: 3,
  volta: 4,
  homebrew: 5,
  n: 6,
  hermes: 7,
  path: 8,
  system: 9,
  custom: 10,
};

interface RawCandidate {
  path: string;
  viaPath: boolean;
  pathIndex: number;
}

interface Candidate extends RawCandidate {
  realPath: string;
  sourceHint: NpmSource;
}

interface Observation {
  candidate: Candidate;
  version: string | null;
  prefix: string | null;
  globalRoot: string | null;
  registry: string | null;
  nodeVersion: string | null;
  packages: GlobalPackage[];
  error?: string;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, IS_WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function firstLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function classifyPath(file: string): NpmSource {
  const value = file.replaceAll('\\', '/').toLowerCase();

  if (value.includes('/.nvm/') || value.includes('/nvm/versions/')) return 'nvm';
  if (value.includes('/fnm/')) return 'fnm';
  if (value.includes('/mise/')) return 'mise';
  if (value.includes('/.asdf/') || value.includes('/asdf/installs/')) return 'asdf';
  if (value.includes('/.volta/') || value.includes('/volta/bin/')) return 'volta';
  if (value.includes('/.n/versions/') || value.includes('/n/versions/')) return 'n';
  if (value.includes('/.hermes/')) return 'hermes';
  if (value.includes('/homebrew/') || value.includes('/cellar/')) return 'homebrew';
  if (value.startsWith('/usr/bin/')) return 'system';
  return 'custom';
}

function envFor(npmPath: string): NodeJS.ProcessEnv {
  const binDir = path.dirname(npmPath);
  return {
    ...process.env,
    PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ''}`,
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}

function parseJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parsePackages(
  lsRaw: string,
  outdatedRaw: string,
  globalRoot: string | null,
): GlobalPackage[] {
  const lsData = parseJson(lsRaw) as
    | { dependencies?: Record<string, { version?: string }> }
    | null;
  const outgoing = (parseJson(outdatedRaw) ?? {}) as Record<
    string,
    { current?: string; wanted?: string; latest?: string }
  >;
  const dependencies = lsData?.dependencies ?? {};

  return Object.entries(dependencies)
    .map(([name, info]) => {
      const version =
        typeof info?.version === 'string' && info.version ? info.version : 'unknown';
      const update = outgoing[name];
      const latest = update?.latest;
      return {
        name,
        version,
        wanted: update?.wanted,
        latest,
        outdated: Boolean(latest && latest !== version),
        location: globalRoot ? path.join(globalRoot, name) : name,
      } satisfies GlobalPackage;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compareVersions(a: string | null, b: string | null): number {
  const parse = (value: string | null) =>
    (value ?? '0')
      .replace(/^v/, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
  return 0;
}

async function collectRawCandidates(): Promise<RawCandidate[]> {
  const raws: RawCandidate[] = [];
  const seenPaths = new Set<string>();

  const add = async (file: string, viaPath: boolean, pathIndex: number) => {
    const normalized = path.normalize(file);
    if (seenPaths.has(normalized)) return;
    if (!(await isExecutable(normalized))) return;
    seenPaths.add(normalized);
    raws.push({ path: normalized, viaPath, pathIndex });
  };

  const pathDirs = (process.env.PATH ?? '').split(PATH_SEP).filter(Boolean);
  for (const [index, dir] of pathDirs.entries()) {
    await add(path.join(dir, NPM_BIN), true, index);
  }

  const addVersioned = async (base: string, tails: string[][]) => {
    for (const dir of await listDirs(base)) {
      for (const tail of tails) {
        await add(path.join(dir, ...tail, NPM_BIN), false, Number.MAX_SAFE_INTEGER);
      }
    }
  };

  const nvmDir = process.env.NVM_DIR || path.join(HOME, '.nvm');
  await addVersioned(path.join(nvmDir, 'versions', 'node'), [['bin']]);

  const fnmDirs = [
    process.env.FNM_DIR,
    path.join(HOME, '.fnm', 'node-versions'),
    path.join(HOME, 'Library', 'Application Support', 'fnm', 'node-versions'),
  ].filter((value): value is string => Boolean(value));
  for (const dir of fnmDirs) {
    await addVersioned(dir, [['installation', 'bin']]);
  }

  const dataHome = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
  await addVersioned(path.join(dataHome, 'mise', 'installs', 'node'), [['bin']]);
  await addVersioned(path.join(dataHome, 'mise', 'installs', 'npm'), [
    ['bin'],
    ['package', 'bin'],
  ]);

  await addVersioned(path.join(HOME, '.asdf', 'installs', 'nodejs'), [['bin']]);
  await addVersioned(path.join(HOME, '.n', 'versions', 'node'), [['bin']]);
  await addVersioned('/usr/local/n/versions/node', [['bin']]);

  const voltaDir = process.env.VOLTA_HOME || path.join(HOME, '.volta');
  await add(path.join(voltaDir, 'bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);

  await add(path.join(HOME, '.hermes', 'node', 'bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);
  await add(path.join(HOME, '.npm-global', 'bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);
  await add(path.join('/usr/local/bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);
  await add(path.join('/usr/bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);

  for (const prefix of ['/opt/homebrew', '/usr/local']) {
    await add(path.join(prefix, 'bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);
    for (const dir of await listDirs(path.join(prefix, 'opt'))) {
      if (!path.basename(dir).startsWith('node')) continue;
      await add(path.join(dir, 'bin', NPM_BIN), false, Number.MAX_SAFE_INTEGER);
    }
  }

  return raws;
}

function displayPathQuality(file: string): number {
  const lower = file.replaceAll('\\', '/').toLowerCase();
  let score = 0;
  if (lower.includes('/latest/')) score -= 2;
  if (lower.includes('/shims/')) score -= 3;
  if (lower.includes('/installs/npm/')) score -= 1;
  // Prefer a concrete versioned directory (12.0.2, 26.8.1) over an alias (12, 26).
  if (lower.split('/').some((segment) => /^\d+\.\d+\.\d+/.test(segment))) score += 1;
  return score;
}

async function resolveCandidates(): Promise<Candidate[]> {
  const raws = await collectRawCandidates();
  const unique = new Map<string, Candidate>();

  for (const raw of raws) {
    const resolved = await realpath(raw.path).catch(() => raw.path);
    const existing = unique.get(resolved);
    if (existing) {
      existing.viaPath ||= raw.viaPath;
      existing.pathIndex = Math.min(existing.pathIndex, raw.pathIndex);
      // Prefer a concrete versioned path over a "latest" alias or shim.
      if (displayPathQuality(raw.path) > displayPathQuality(existing.path)) {
        existing.path = raw.path;
      }
      continue;
    }

    unique.set(resolved, {
      ...raw,
      realPath: resolved,
      sourceHint: classifyPath(`${raw.path}|${resolved}`),
    });
  }

  return [...unique.values()];
}

async function probe(candidate: Candidate): Promise<Observation> {
  const npm = (args: string[], timeout = 30_000) =>
    runCommand(candidate.path, args, {
      cwd: HOME,
      env: envFor(candidate.path),
      timeout,
    });

  const [versionResult, rootResult, prefixResult, registryResult] = await Promise.all([
    npm(['-v'], 15_000),
    npm(['root', '-g'], 20_000),
    npm(['prefix', '-g'], 20_000),
    npm(['config', 'get', 'registry'], 20_000),
  ]);

  const version = firstLine(versionResult.stdout) || null;
  const globalRoot = firstLine(rootResult.stdout) || null;
  const prefix = firstLine(prefixResult.stdout) || null;
  const registry = firstLine(registryResult.stdout) || null;

  if (!version && !globalRoot && !prefix) {
    return {
      candidate,
      version,
      prefix,
      globalRoot,
      registry,
      nodeVersion: null,
      packages: [],
      error:
        firstLine(versionResult.stderr) ||
        firstLine(rootResult.stderr) ||
        versionResult.error ||
        '无法执行此 npm',
    };
  }

  let nodeVersion: string | null = null;
  const nodeCandidates = [
    path.join(path.dirname(candidate.path), IS_WINDOWS ? 'node.exe' : 'node'),
    prefix ? path.join(prefix, IS_WINDOWS ? 'node.exe' : 'bin/node') : null,
  ].filter((value): value is string => Boolean(value));

  for (const nodePath of nodeCandidates) {
    if (!(await isExecutable(nodePath))) continue;
    const result = await runCommand(nodePath, ['-v'], {
      cwd: HOME,
      env: envFor(candidate.path),
      timeout: 15_000,
    });
    nodeVersion = firstLine(result.stdout).replace(/^v/, '') || null;
    if (nodeVersion) break;
  }

  const [lsResult, outdatedResult] = await Promise.all([
    npm(['ls', '-g', '--depth=0', '--json'], 60_000),
    npm(['outdated', '-g', '--json'], 60_000),
  ]);

  const packages = parsePackages(lsResult.stdout, outdatedResult.stdout, globalRoot);
  const failedToList = !lsResult.stdout.trim() && !packages.length;

  return {
    candidate,
    version,
    prefix,
    globalRoot,
    registry,
    nodeVersion,
    packages,
    error: failedToList
      ? firstLine(lsResult.stderr) || lsResult.error || '无法读取全局包列表'
      : undefined,
  };
}

function displayScore(observation: Observation): number {
  const file = observation.candidate.path.replaceAll('\\', '/').toLowerCase();
  let score = displayPathQuality(observation.candidate.path);

  // An npm binary that belongs to a Node installation is the real manager;
  // the standalone npm package (e.g. mise's npm tool) shares its global root.
  if (
    file.includes('/installs/node/') ||
    file.includes('/versions/node/') ||
    file.includes('/node-versions/')
  ) {
    score += 4;
  }
  if (file.includes('/installs/npm/')) score -= 2;
  if (observation.candidate.realPath.includes('/lib/node_modules/npm/bin/npm-cli.js')) {
    score += 2;
  }
  if (file.endsWith('/bin/npm')) score += 1;
  return score;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function scan(): Promise<ScanResult> {
  const startedAt = Date.now();
  const candidates = await resolveCandidates();
  const observations = await mapLimit(candidates, 4, probe);

  const pathObservations = observations
    .filter((observation) => observation.candidate.viaPath)
    .sort((a, b) => a.candidate.pathIndex - b.candidate.pathIndex);

  const groupKey = (observation: Observation) =>
    `${observation.globalRoot ?? observation.candidate.realPath}::${observation.version ?? 'unknown'}`;

  const defaultKey = (() => {
    for (const observation of pathObservations) {
      if (!observation.globalRoot) continue;
      return groupKey(observation);
    }
    return null;
  })();

  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = groupKey(observation);
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }

  const installations: NpmInstallation[] = [];

  for (const [key, group] of groups) {
    const working = group.filter(
      (observation) => observation.version || observation.globalRoot,
    );
    if (!working.length) continue;

    const display = [...working].sort((a, b) => {
      const score = displayScore(b) - displayScore(a);
      if (score !== 0) return score;
      return Number(b.candidate.viaPath) - Number(a.candidate.viaPath);
    })[0];

    const withPackages = [...working].sort(
      (a, b) => b.packages.length - a.packages.length,
    )[0];
    const packages = withPackages.packages;
    const outdatedCount = packages.filter((entry) => entry.outdated).length;

    installations.push({
      id: createHash('sha1').update(display.candidate.path).digest('hex').slice(0, 12),
      path: display.candidate.path,
      realPath: display.candidate.realPath,
      version: display.version,
      nodeVersion:
        working.find((observation) => observation.nodeVersion)?.nodeVersion ?? null,
      prefix: display.prefix,
      globalRoot: display.globalRoot,
      registry: display.registry,
      source: display.candidate.sourceHint,
      isDefault: key === defaultKey,
      inPath: group.some((observation) => observation.candidate.viaPath),
      sharedGlobalRoot: false,
      packages,
      packageCount: packages.length,
      outdatedCount,
      error: working.find((observation) => observation.error)?.error,
    });
  }

  const rootCounts = new Map<string, number>();
  for (const installation of installations) {
    if (!installation.globalRoot) continue;
    rootCounts.set(
      installation.globalRoot,
      (rootCounts.get(installation.globalRoot) ?? 0) + 1,
    );
  }
  for (const installation of installations) {
    installation.sharedGlobalRoot = Boolean(
      installation.globalRoot && (rootCounts.get(installation.globalRoot) ?? 0) > 1,
    );
  }

  installations.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return Number(b.isDefault) - Number(a.isDefault);
    const source = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    if (source !== 0) return source;
    return compareVersions(a.version, b.version);
  });

  return {
    installations,
    defaultPath: installations.find((entry) => entry.isDefault)?.path ?? null,
    scannedAt: new Date().toISOString(),
    platform: PLATFORM,
    durationMs: Date.now() - startedAt,
  };
}

let cache: ScanResult | null = null;
let cacheTime = 0;
let inflight: Promise<ScanResult> | null = null;

export async function getScan(force = false): Promise<ScanResult> {
  if (!force && cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = scan()
    .then((result) => {
      cache = result;
      cacheTime = Date.now();
      return result;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function invalidateScan(): void {
  cache = null;
  cacheTime = 0;
}