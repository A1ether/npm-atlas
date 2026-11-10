import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type {
  ActionType,
  GlobalPackage,
  ScanResult,
} from '../../shared/types';
import { fetchScan, postAction } from './api';
import { Header } from './components/Header';
import { Stats } from './components/Stats';
import { InstallationList } from './components/InstallationList';
import { PackagePanel } from './components/PackagePanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts, type ToastItem } from './components/Toasts';
import { errorMessage } from './lib';

type Theme = 'dark' | 'light';

type ConfirmState =
  | { kind: 'uninstall'; pkg: GlobalPackage }
  | { kind: 'update-all'; names: string[] }
  | null;

interface BusyState {
  installationId: string;
  action: ActionType;
  names: string[];
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('npm-atlas-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('npm-atlas-theme', theme);
    } catch {
      // storage can be unavailable in private windows; theme still works in memory
    }
  }, [theme]);

  const pushToast = (
    kind: ToastItem['kind'],
    title: string,
    detail?: string,
  ) => {
    const id = toastId.current + 1;
    toastId.current = id;
    setToasts((previous) => [...previous.slice(-3), { id, kind, title, detail }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id));
    }, 6500);
  };

  const load = async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await fetchScan(refresh);
      setScan(data);
      setSelectedId((previous) => {
        if (previous && data.installations.some((entry) => entry.id === previous)) {
          return previous;
        }
        return data.installations[0]?.id ?? null;
      });
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      if (scan) pushToast('error', '重新扫描失败', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => scan?.installations.find((entry) => entry.id === selectedId) ?? null,
    [scan, selectedId],
  );

  const runAction = async (action: ActionType, names: string[]) => {
    if (!selected || !names.length) return;
    setConfirm(null);
    setBusy({ installationId: selected.id, action, names });

    try {
      const response = await postAction({
        type: action,
        installationId: selected.id,
        packages: names,
      });
      setScan(response.scan);
      setSelectedId((previous) => {
        if (previous && response.scan.installations.some((entry) => entry.id === previous)) {
          return previous;
        }
        return response.scan.installations[0]?.id ?? null;
      });

      const failed = response.results.filter((result) => !result.ok);
      const succeeded = response.results.length - failed.length;

      if (failed.length) {
        pushToast(
          'error',
          `${failed.length} 个包${action === 'update' ? '更新' : '卸载'}失败`,
          failed.map((result) => `${result.name}\n${result.output}`).join('\n\n'),
        );
        if (succeeded) {
          pushToast(
            'success',
            `其余 ${succeeded} 个包已${action === 'update' ? '更新' : '卸载'}`,
          );
        }
      } else {
        pushToast(
          'success',
          `${names.length} 个包已${action === 'update' ? '更新' : '卸载'}`,
          action === 'update' ? '版本信息已刷新。' : '全局包列表已刷新。',
        );
      }
    } catch (cause) {
      pushToast('error', '操作失败', errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggleTheme = () => {
    setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'));
  };

  if (!scan && loading) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="boot-title">
            <Loader2 size={17} className="spin" style={{ color: 'var(--accent)' }} />
            正在扫描本机 npm…
          </div>
          <div className="boot-note">
            逐个探测 PATH、mise、nvm、Homebrew 等安装，并读取全局包与可更新版本。
            首次扫描通常需要几秒。
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 18 }}>
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="skeleton-row"
                style={{ opacity: 1 - row * 0.18 }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!scan && error) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="boot-title">
            <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
            扫描失败
          </div>
          <div className="boot-note">{error}</div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!scan) return null;

  const selectedBusy =
    busy && selected && busy.installationId === selected.id
      ? { action: busy.action, names: busy.names }
      : null;

  return (
    <div>
      <Header
        theme={theme}
        scannedAt={scan.scannedAt}
        durationMs={scan.durationMs}
        refreshing={refreshing}
        disabled={Boolean(busy)}
        onToggleTheme={toggleTheme}
        onRefresh={() => void load(true)}
      />

      <main className="app-main">
        {error ? (
          <div className="error-banner" role="alert">
            <AlertTriangle size={14} />
            <span>刷新失败：{error}</span>
            <button type="button" className="btn btn-quiet" onClick={() => void load(true)}>
              重试
            </button>
          </div>
        ) : null}

        <Stats scan={scan} />

        {scan.installations.length ? (
          <div className="workspace">
            <InstallationList
              installations={scan.installations}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />

            {selected ? (
              <PackagePanel
                installation={selected}
                busy={selectedBusy}
                onUpdate={(name) => void runAction('update', [name])}
                onUninstall={(pkg) => setConfirm({ kind: 'uninstall', pkg })}
                onUpdateAll={(names) => setConfirm({ kind: 'update-all', names })}
              />
            ) : (
              <section className="panel">
                <div className="empty-state">
                  <div className="empty-title">请选择一个 npm 安装</div>
                </div>
              </section>
            )}
          </div>
        ) : (
          <section className="panel" style={{ marginTop: 18 }}>
            <div className="empty-state">
              <div className="empty-icon">
                <AlertTriangle size={22} />
              </div>
              <div className="empty-title">没有找到可用的 npm</div>
              <div className="empty-note">
                npm-atlas 会检查 PATH 与常见版本管理器目录。请确认 npm 已安装，
                或在启动前把 npm 所在目录加入 PATH，然后点击「重新扫描」。
              </div>
            </div>
          </section>
        )}
      </main>

      <ConfirmDialog
        open={confirm?.kind === 'uninstall'}
        title="卸载全局包"
        danger
        confirmLabel="确认卸载"
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'uninstall') {
            void runAction('uninstall', [confirm.pkg.name]);
          }
        }}
        body={
          confirm?.kind === 'uninstall' ? (
            <>
              将从 <code>{selected?.path}</code> 对应的全局目录中移除{' '}
              <code>{confirm.pkg.name}</code>
              {confirm.pkg.version !== 'unknown' ? `（v${confirm.pkg.version}）` : ''}。
              依赖该包的命令行工具会立即失效。
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={confirm?.kind === 'update-all'}
        title="更新全部可更新包"
        confirmLabel="开始更新"
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'update-all') {
            void runAction('update', confirm.names);
          }
        }}
        body={
          confirm?.kind === 'update-all' ? (
            <>
              将把 {confirm.names.length} 个包更新到各自最新的稳定版本
              （<code>npm install -g &lt;pkg&gt;@latest</code>）。更新将逐个执行，可能需要几分钟。
              {confirm.names.includes('npm') ? (
                <> npm 自身会排在最后更新，避免中途替换正在使用的 npm。</>
              ) : null}
              <div className="dialog-list">
                {confirm.names.slice(0, 10).map((name) => (
                  <div key={name}>{name}</div>
                ))}
                {confirm.names.length > 10 ? (
                  <div>… 另有 {confirm.names.length - 10} 个</div>
                ) : null}
              </div>
            </>
          ) : null
        }
      />

      <Toasts
        items={toasts}
        onDismiss={(id) =>
          setToasts((previous) => previous.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}