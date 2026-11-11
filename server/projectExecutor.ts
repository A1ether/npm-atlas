import type {
  DependencyType,
  PackageActionResult,
  PackageManager,
  ProjectActionRequest,
  ProjectActionResponse,
  ProjectActionType,
} from '../shared/types';
import { withLock } from './async';
import { HttpError } from './http';
import {
  collectDependencySpecs,
  getProjects,
  inspectProject,
  refreshProject,
} from './projects';
import { findProjectRecord } from './projectStore';
import { runCommand } from './run';

const IS_WINDOWS = process.platform === 'win32';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const MAX_PACKAGES_PER_ACTION = 50;
const ACTION_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 4_000;

const ACTION_TYPES: ProjectActionType[] = [
  'update',
  'uninstall',
  'install',
  'install-all',
];

interface Job {
  kind: 'install' | 'uninstall' | 'install-all';
  type: DependencyType | null;
  names: string[];
}

function pmBinary(manager: PackageManager): string {
  return IS_WINDOWS ? `${manager}.cmd` : manager;
}

function actionEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_update_notifier: 'false',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
}

function workspaceFlags(
  manager: PackageManager,
  hasWorkspaces: boolean,
): string[] {
  if (!hasWorkspaces) return [];
  if (manager === 'pnpm') return ['--workspace-root'];
  if (manager === 'yarn') return ['-W'];
  return [];
}

function saveFlags(manager: PackageManager, type: DependencyType): string[] {
  if (type === 'peer') return [];
  if (manager === 'npm') {
    if (type === 'dev') return ['--save-dev'];
    if (type === 'optional') return ['--save-optional'];
    return [];
  }
  if (manager === 'pnpm') {
    if (type === 'dev') return ['-D'];
    if (type === 'optional') return ['-O'];
    return [];
  }
  if (manager === 'yarn') {
    if (type === 'dev') return ['-D'];
    if (type === 'optional') return ['--optional'];
    return [];
  }
  if (type === 'dev') return ['-d'];
  if (type === 'optional') return ['--optional'];
  return [];
}

function buildArgs(
  manager: PackageManager,
  job: Job,
  hasWorkspaces: boolean,
): string[] {
  if (job.kind === 'install-all') {
    return manager === 'npm'
      ? ['install', '--no-audit', '--no-fund']
      : ['install'];
  }

  const workspace = workspaceFlags(manager, hasWorkspaces);

  if (job.kind === 'uninstall') {
    const base = manager === 'npm' ? ['uninstall'] : ['remove'];
    const tail = manager === 'npm' ? ['--no-audit', '--no-fund'] : [];
    return [...base, ...workspace, ...job.names, ...tail];
  }

  const base = manager === 'npm' ? ['install'] : ['add'];
  const specs = job.names.map((name) => `${name}@latest`);
  const save = saveFlags(manager, job.type ?? 'prod');
  const tail = manager === 'npm' ? ['--no-audit', '--no-fund'] : [];
  return [...base, ...workspace, ...save, ...specs, ...tail];
}

function compactOutput(
  result: Awaited<ReturnType<typeof runCommand>>,
  manager: PackageManager,
  ok: boolean,
): string {
  const text = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join('\n');
  if (text) return text.slice(0, MAX_OUTPUT_CHARS);
  if (result.timedOut) return '操作超时（5 分钟）';
  if (/ENOENT/.test(result.error ?? '')) {
    return `未找到 ${manager} 命令，请确认它已安装并在 PATH 中`;
  }
  return ok ? '完成' : result.error ?? '操作失败';
}

function readNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const name = value.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function groupJobs(entries: { name: string; type: DependencyType }[]): Job[] {
  const groups = new Map<DependencyType, string[]>();
  for (const entry of entries) {
    const group = groups.get(entry.type);
    if (group) group.push(entry.name);
    else groups.set(entry.type, [entry.name]);
  }
  return [...groups.entries()].map(([type, names]) => ({
    kind: 'install',
    type,
    names,
  }));
}

export async function executeProjectAction(
  input: ProjectActionRequest,
): Promise<ProjectActionResponse> {
  const type = input?.type;
  if (!type || !ACTION_TYPES.includes(type)) {
    throw new HttpError(400, '未知的项目操作类型');
  }
  if (typeof input.projectId !== 'string' || !input.projectId) {
    throw new HttpError(400, '缺少 projectId');
  }

  const record = await findProjectRecord(input.projectId);
  if (!record) {
    throw new HttpError(400, '未找到该项目，请重新导入');
  }

  const inspection = await inspectProject(record.path);
  if (!inspection.ok || !inspection.data) {
    throw new HttpError(
      400,
      `项目不可用：${inspection.error ?? '无法读取 package.json'}`,
    );
  }

  const names = readNames(input.packages);
  if (type !== 'install-all') {
    if (!names.length) throw new HttpError(400, '请至少选择一个依赖');
    if (names.length > MAX_PACKAGES_PER_ACTION) {
      throw new HttpError(400, `单次最多处理 ${MAX_PACKAGES_PER_ACTION} 个依赖`);
    }
  }

  const specs = collectDependencySpecs(inspection.data);
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const errors: string[] = [];
  let jobs: Job[];

  if (type === 'install-all') {
    jobs = [{ kind: 'install-all', type: null, names: [] }];
  } else if (type === 'uninstall') {
    for (const name of names) {
      if (!PACKAGE_NAME.test(name)) errors.push(`无效的包名：${name}`);
      else if (!byName.has(name)) errors.push(`不在项目依赖中：${name}`);
    }
    if (errors.length) throw new HttpError(400, errors.join('\n'));
    jobs = [{ kind: 'uninstall', type: null, names }];
  } else {
    const entries: { name: string; type: DependencyType }[] = [];

    for (const name of names) {
      if (!PACKAGE_NAME.test(name)) {
        errors.push(`无效的包名：${name}`);
        continue;
      }

      const spec = byName.get(name);

      if (type === 'update') {
        if (!spec) {
          errors.push(`不在项目依赖中：${name}`);
          continue;
        }
        if (spec.type === 'peer') {
          errors.push(`对等依赖不会被安装，无法更新：${name}`);
          continue;
        }
        if (spec.linked) {
          errors.push(`本地链接依赖无法通过安装命令更新：${name}`);
          continue;
        }
        entries.push({ name, type: spec.type });
        continue;
      }

      // install: keep the existing dependency type; new packages follow `dev`.
      if (spec?.type === 'peer') {
        errors.push(`对等依赖不会被安装，无法添加：${name}`);
        continue;
      }
      if (spec?.linked) {
        errors.push(`本地链接依赖无法通过安装命令更新：${name}`);
        continue;
      }
      entries.push({
        name,
        type: spec?.type ?? (input.dev === true ? 'dev' : 'prod'),
      });
    }

    if (errors.length) throw new HttpError(400, errors.join('\n'));
    jobs = groupJobs(entries);
  }

  const results: PackageActionResult[] = [];

  await withLock(`project:${input.projectId}`, async () => {
    for (const job of jobs) {
      const result = await runCommand(
        pmBinary(inspection.manager),
        buildArgs(inspection.manager, job, inspection.hasWorkspaces),
        {
          cwd: record.path,
          env: actionEnv(),
          timeout: ACTION_TIMEOUT_MS,
        },
      );

      const ok = result.code === 0 && !result.timedOut;
      const output = compactOutput(result, inspection.manager, ok);

      if (job.kind === 'install-all') {
        results.push({ name: '全部依赖', ok, output });
      } else {
        for (const name of job.names) {
          results.push({ name, ok, output });
        }
      }
    }
  });

  let list;
  try {
    list = await refreshProject(input.projectId);
  } catch {
    list = await getProjects(false);
  }

  return {
    ok: results.every((entry) => entry.ok),
    results,
    list,
  };
}