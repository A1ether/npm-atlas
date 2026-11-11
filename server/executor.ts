import { homedir } from 'node:os';
import path from 'node:path';
import type {
  ActionResponse,
  ActionType,
  PackageActionResult,
  ScanResult,
} from '../shared/types';
import { runCommand } from './run';
import { getScan, invalidateScan } from './scanner';
import { withLock } from './async';
import { HttpError } from './http';

const HOME = homedir();
const IS_WINDOWS = process.platform === 'win32';
const PATH_SEP = IS_WINDOWS ? ';' : ':';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const MAX_PACKAGES_PER_ACTION = 50;
const ACTION_TIMEOUT_MS = 5 * 60_000;
const MAX_OUTPUT_CHARS = 4_000;

function envFor(npmPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${path.dirname(npmPath)}${PATH_SEP}${process.env.PATH ?? ''}`,
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}

function compactOutput(stdout: string, stderr: string, fallback: string): string {
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return (text || fallback).slice(0, MAX_OUTPUT_CHARS);
}

export async function executeAction(
  scanResult: ScanResult,
  input: { type: ActionType; installationId: string; packages: string[] },
): Promise<ActionResponse> {
  if (input.type !== 'update' && input.type !== 'uninstall') {
    throw new HttpError(400, '未知的操作类型');
  }

  const installation = scanResult.installations.find(
    (entry) => entry.id === input.installationId,
  );
  if (!installation) {
    throw new HttpError(400, '未找到该 npm 安装，请刷新后重试');
  }

  const names = [...new Set(input.packages.map((name) => name.trim()))].filter(Boolean);
  if (!names.length) throw new HttpError(400, '请至少选择一个包');
  if (names.length > MAX_PACKAGES_PER_ACTION) {
    throw new HttpError(400, `单次最多处理 ${MAX_PACKAGES_PER_ACTION} 个包`);
  }

  const known = new Set(installation.packages.map((entry) => entry.name));
  const invalid = names.filter((name) => !PACKAGE_NAME.test(name) || !known.has(name));
  if (invalid.length) {
    throw new HttpError(400, `以下包不在该安装的全局包列表中：${invalid.join(', ')}`);
  }

  if (input.type === 'uninstall' && names.includes('npm')) {
    throw new HttpError(
      400,
      '为安全起见，npm-atlas 不允许卸载 npm 自身；如需升级请使用更新操作。',
    );
  }

  const results: PackageActionResult[] = [];
  // Updating npm itself replaces the binary we are running; keep it last.
  const executionOrder = [...names].sort(
    (a, b) => Number(a === 'npm') - Number(b === 'npm'),
  );

  await withLock(installation.id, async () => {
    for (const name of executionOrder) {
      const args =
        input.type === 'update'
          ? ['install', '-g', `${name}@latest`, '--no-audit', '--no-fund']
          : ['uninstall', '-g', name, '--no-audit', '--no-fund'];

      const result = await runCommand(installation.path, args, {
        cwd: HOME,
        env: envFor(installation.path),
        timeout: ACTION_TIMEOUT_MS,
      });

      const ok = result.code === 0 && !result.timedOut;
      results.push({
        name,
        ok,
        output: compactOutput(
          result.stdout,
          result.stderr,
          result.timedOut
            ? '操作超时（5 分钟）'
            : ok
              ? '完成'
              : result.error ?? '操作失败',
        ),
      });
    }
  });

  invalidateScan();
  const fresh = await getScan(true);

  return {
    ok: results.every((entry) => entry.ok),
    results,
    scan: fresh,
  };
}