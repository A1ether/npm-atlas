#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/server/index.js');

if (!existsSync(entry)) {
  console.error('npm-atlas 尚未构建，请先运行：pnpm build');
  process.exit(1);
}

const child = spawn(process.execPath, [entry, '--open'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));