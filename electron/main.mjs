import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_NAME = 'npm-atlas';
app.setName(APP_NAME);

let mainWindow = null;

function resolveLoginPath() {
  const fallback =
    process.env.PATH ||
    '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const shellPath =
    process.env.SHELL || os.userInfo().shell || '/bin/zsh';

  try {
    const output = execFileSync(
      shellPath,
      ['-ilc', 'printf "__ATLAS_PATH__%s__ATLAS_END__" "$PATH"'],
      {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: process.env,
      },
    );
    const match = output.match(/__ATLAS_PATH__([\s\S]*?)__ATLAS_END__/);
    return match?.[1]?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function hasUsablePath() {
  const value = process.env.PATH || '';
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/.local/share/mise/shims',
    '/.nvm/',
    '/.volta/',
    '/.asdf/',
    '/.fnm/',
  ].some((marker) => value.includes(marker));
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port) {
  const url = `http://127.0.0.1:${port}/api/health`;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`服务未能在端口 ${port} 启动`);
}

async function startServer() {
  process.env.SHELL ||= os.userInfo().shell || '/bin/zsh';
  if (!hasUsablePath()) {
    console.log('[npm-atlas] resolving login shell PATH');
    process.env.PATH = resolveLoginPath();
  }

  const appRoot = app.isPackaged
    ? app.getAppPath()
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log('[npm-atlas] app root:', appRoot);
  process.env.ATLAS_HOST = '127.0.0.1';
  process.env.ATLAS_WEB_DIST = path.join(appRoot, 'dist', 'web');

  const preferred = Number(process.env.ATLAS_APP_PORT || 0);
  const port = preferred > 0 ? preferred : await pickFreePort();
  process.env.ATLAS_PORT = String(port);
  console.log('[npm-atlas] starting embedded server on', port);

  const serverEntry = path.join(appRoot, 'dist', 'server', 'app.js');
  await import(pathToFileURL(serverEntry).href);
  await waitForHealth(port);
  console.log('[npm-atlas] server ready');
  return `http://127.0.0.1:${port}`;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 1020,
    minHeight: 700,
    backgroundColor: '#070a0d',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    }
  });

  return mainWindow;
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const devUrl = process.env.ATLAS_DEV_URL;
      const url = devUrl || (await startServer());
      createWindow(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.stack || error.message : String(error);
      console.error('[npm-atlas] startup failed:', message);
      dialog.showErrorBox('npm-atlas 启动失败', message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (!mainWindow) app.quit();
  });
}