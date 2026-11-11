import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { HttpError } from './http';
import { ATLAS_PATHS } from './settings';

const HOME = homedir();
const MANIFEST = 'package.json';
const MAX_IMPORT = 100;

export interface StoredProject {
  path: string;
  addedAt: string;
}

export interface ProjectRecord extends StoredProject {
  id: string;
}

interface StoredProjectsFile {
  version: 1;
  projects: StoredProject[];
}

export function projectId(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

function expandHome(value: string): string {
  if (value === '~') return HOME;
  if (value.startsWith('~/') || value.startsWith(`~${path.sep}`)) {
    return path.join(HOME, value.slice(2));
  }
  return value;
}

export function displayProjectPath(projectPath: string): string {
  return projectPath.startsWith(`${HOME}${path.sep}`)
    ? `~${projectPath.slice(HOME.length)}`
    : projectPath;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function writeStore(projects: StoredProject[]): Promise<void> {
  const file = ATLAS_PATHS.projectsFile;
  await mkdir(path.dirname(file), { recursive: true });
  const content = `${JSON.stringify({ version: 1, projects } satisfies StoredProjectsFile, null, 2)}\n`;
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, content, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

function isStoredProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === 'string' &&
    entry.path.length > 0 &&
    path.isAbsolute(entry.path) &&
    typeof entry.addedAt === 'string'
  );
}

export async function readProjectRecords(): Promise<ProjectRecord[]> {
  let raw: string;
  try {
    raw = await readFile(ATLAS_PATHS.projectsFile, 'utf8');
  } catch {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  const file = data as Partial<StoredProjectsFile> | null;
  if (!file || file.version !== 1 || !Array.isArray(file.projects)) return [];

  const seen = new Set<string>();
  const records: ProjectRecord[] = [];
  for (const entry of file.projects) {
    if (!isStoredProject(entry)) continue;
    const canonical = path.normalize(entry.path);
    const id = projectId(canonical);
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({
      id,
      path: canonical,
      addedAt: entry.addedAt,
    });
  }
  return records;
}

async function canonicalProjectPath(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new HttpError(400, '项目路径不能为空');

  const expanded = expandHome(trimmed);
  if (!path.isAbsolute(expanded)) {
    throw new HttpError(400, `请输入绝对路径（或使用 ~ 开头）：${input}`);
  }

  let resolved: string;
  try {
    resolved = await realpath(expanded);
  } catch {
    throw new HttpError(400, `项目路径不存在：${input}`);
  }

  if (!(await isDirectory(resolved))) {
    throw new HttpError(400, `不是目录：${input}`);
  }

  if (!(await isFile(path.join(resolved, MANIFEST)))) {
    throw new HttpError(400, `不是 Node 项目（缺少 ${MANIFEST}）：${input}`);
  }

  return path.normalize(resolved);
}

export interface AddProjectsResult {
  records: ProjectRecord[];
  added: ProjectRecord[];
}

/** Validates, canonicalizes and appends projects; existing paths are kept once. */
export async function addProjectPaths(inputs: string[]): Promise<AddProjectsResult> {
  if (!Array.isArray(inputs) || !inputs.length) {
    throw new HttpError(400, '请至少选择一个项目');
  }
  if (inputs.length > MAX_IMPORT) {
    throw new HttpError(400, `单次最多导入 ${MAX_IMPORT} 个项目`);
  }

  const paths = inputs.filter((input): input is string => typeof input === 'string');
  if (!paths.length) throw new HttpError(400, '请至少选择一个项目');

  const records = await readProjectRecords();
  const byId = new Map(records.map((record) => [record.id, record]));
  const added: ProjectRecord[] = [];
  const errors: string[] = [];

  for (const input of paths) {
    try {
      const canonical = await canonicalProjectPath(input);
      const id = projectId(canonical);
      if (byId.has(id)) continue;
      const record: ProjectRecord = {
        id,
        path: canonical,
        addedAt: new Date().toISOString(),
      };
      byId.set(id, record);
      added.push(record);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length) {
    throw new HttpError(400, errors.join('\n'));
  }

  if (added.length) {
    await writeStore([...byId.values()].map(({ id: _id, ...entry }) => entry));
  }

  return { records: [...byId.values()], added };
}

export async function removeProjectRecords(ids: string[]): Promise<ProjectRecord[]> {
  const targets = new Set(ids.filter((id) => typeof id === 'string' && id));
  if (!targets.size) throw new HttpError(400, '缺少要移除的项目');

  const records = await readProjectRecords();
  const kept = records.filter((record) => !targets.has(record.id));
  if (kept.length === records.length) {
    throw new HttpError(400, '未找到要移除的项目');
  }

  await writeStore(kept.map(({ id: _id, ...entry }) => entry));
  return kept;
}

export async function findProjectRecord(id: string): Promise<ProjectRecord | null> {
  const records = await readProjectRecords();
  return records.find((record) => record.id === id) ?? null;
}
