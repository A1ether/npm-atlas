import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { ActionRequest } from '../shared/types';
import { resetDefaultNpm, setDefaultNpm } from './defaultNpm';
import { executeAction, HttpError } from './executor';
import { getScan } from './scanner';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = process.env.ATLAS_WEB_DIST
  ? resolve(process.env.ATLAS_WEB_DIST)
  : resolve(here, '../web');
const port = Number(process.env.ATLAS_PORT ?? 4317);
const host = process.env.ATLAS_HOST ?? '127.0.0.1';
const app = new Hono();

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

// This server can modify global npm packages; keep it reachable from this
// machine only, and reject cross-site requests and DNS rebinding attempts.
app.use('/api/*', async (c, next) => {
  const hostHeader = c.req.header('host');
  if (hostHeader) {
    try {
      const { hostname } = new URL(`http://${hostHeader}`);
      if (!isLocalHostname(hostname)) {
        return c.json({ error: 'npm-atlas 仅允许本机访问' }, 403);
      }
    } catch {
      return c.json({ error: '无效的 Host 请求头' }, 403);
    }
  }

  const origin = c.req.header('origin');
  if (origin) {
    try {
      const { hostname } = new URL(origin);
      if (!isLocalHostname(hostname)) {
        return c.json({ error: '拒绝来自其他站点的请求' }, 403);
      }
    } catch {
      return c.json({ error: '无效的 Origin 请求头' }, 403);
    }
  }

  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/scan', async (c) => {
  const force = c.req.query('refresh') === '1';
  return c.json(await getScan(force));
});

app.post('/api/scan', async (c) => c.json(await getScan(true)));

app.post('/api/action', async (c) => {
  const body = await c.req.json<ActionRequest>();
  const scanResult = await getScan();
  return c.json(
    await executeAction(scanResult, {
      type: body.type,
      installationId: body.installationId,
      packages: Array.isArray(body.packages) ? body.packages : [],
    }),
  );
});

app.post('/api/default', async (c) => {
  const body = await c.req.json<{ installationId?: string }>();
  if (!body.installationId) {
    throw new HttpError(400, '缺少 installationId');
  }
  return c.json(await setDefaultNpm(await getScan(), body.installationId));
});

app.post('/api/default/reset', async (c) => c.json(await resetDefaultNpm()));

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error('[npm-atlas]', error);
  return c.json({ error: error.message || '服务器内部错误' }, 500);
});

if (existsSync(resolve(webDist, 'index.html'))) {
  app.use('*', serveStatic({ root: webDist }));
  app.get('*', (c) => c.html(readFileSync(resolve(webDist, 'index.html'), 'utf8')));
} else {
  app.get('/', (c) =>
    c.text(
      'npm-atlas API 已启动。开发模式请打开 http://localhost:5173；生产模式请先运行 pnpm build。',
    ),
  );
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${info.port}`;
  console.log(`npm-atlas 已启动：${url}`);
  if (process.argv.includes('--open')) {
    setTimeout(() => openBrowser(url), 250);
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `端口 ${port} 已被占用。设置 ATLAS_PORT=其他端口 后重试，例如：ATLAS_PORT=4318 pnpm dev`,
    );
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});