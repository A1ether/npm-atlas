import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  RotateCcw,
  Star,
} from 'lucide-react';
import type {
  ActionType,
  GlobalPackage,
  NpmInstallation,
  ScanResult,
} from '../../shared/types';
import {
  applyDefaultNpm,
  fetchScan,
  postAction,
  resetDefaultNpm as resetDefaultRequest,
} from './api';
import { Header } from './components/Header';
import { Stats } from './components/Stats';
import { InstallationList } from './components/InstallationList';
import { PackagePanel } from './components/PackagePanel';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts, type ToastItem } from './components/Toasts';
import { groupInstallations } from './groups';
import { errorMessage, SOURCE_LABEL } from './lib';

type Theme = 'dark' | 'light';

type ConfirmState =
  | { kind: 'uninstall'; pkg: GlobalPackage }
  | { kind: 'update-all'; names: string[] }
  | { kind: 'set-default'; installation: NpmInstallation }
  | { kind: 'reset-default' }
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
  const [collapseByRoot, setCollapseByRoot] = useState(() => {
    try {
      return localStorage.getItem('npm-atlas-collapse') === '1';
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [switchingDefault, setSwitchingDefault] = useState(false);
  const toastId = useRef(0);
  const actionInFlight = useRef(false);
  const defaultInFlight = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('npm-atlas-theme', theme);
    } catch {
      // storage can be unavailable in private windows; theme still works in memory
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('npm-atlas-collapse', collapseByRoot ? '1' : '0');
    } catch {
      // preference is optional; the view still works without persistence
    }
  }, [collapseByRoot]);

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

  const groups = useMemo(
    () => (scan ? groupInstallations(scan.installations, collapseByRoot) : []),
    [scan, collapseByRoot],
  );

  const selectedGroup = useMemo(() => {
    const found = groups.find((group) =>
      group.installations.some((entry) => entry.id === selectedId),
    );
    return found ?? groups[0] ?? null;
  }, [groups, selectedId]);

  const runAction = async (action: ActionType, names: string[]) => {
    const target = selectedGroup?.manager;
    if (
      !target ||
      !names.length ||
      actionInFlight.current ||
      defaultInFlight.current
    ) {
      return;
    }

    actionInFlight.current = true;
    setConfirm(null);
    setBusy({ installationId: target.id, action, names });

    try {
      const response = await postAction({
        type: action,
        installationId: target.id,
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
      actionInFlight.current = false;
      setBusy(null);
    }
  };

  const changeDefault = async (installation: NpmInstallation) => {
    if (actionInFlight.current || defaultInFlight.current) return;
    defaultInFlight.current = true;
    setConfirm(null);
    setSwitchingDefault(true);

    try {
      const response = await applyDefaultNpm(installation.id);
      setScan(response.scan);
      setSelectedId((previous) => {
        if (
          previous &&
          response.scan.installations.some((entry) => entry.id === previous)
        ) {
          return previous;
        }
        return response.scan.installations[0]?.id ?? null;
      });
      pushToast('success', '默认 npm 已切换', response.messages.join('\n'));
    } catch (cause) {
      pushToast('error', '切换默认 npm 失败', errorMessage(cause));
    } finally {
      defaultInFlight.current = false;
      setSwitchingDefault(false);
    }
  };

  const removeDefault = async () => {
    if (actionInFlight.current || defaultInFlight.current) return;
    defaultInFlight.current = true;
    setConfirm(null);
    setSwitchingDefault(true);

    try {
      const response = await resetDefaultRequest();
      setScan(response.scan);
      setSelectedId((previous) => {
        if (
          previous &&
          response.scan.installations.some((entry) => entry.id === previous)
        ) {
          return previous;
        }
        return response.scan.installations[0]?.id ?? null;
      });
      pushToast('success', '默认 npm 设置已移除', response.messages.join('\n'));
    } catch (cause) {
      pushToast('error', '移除默认 npm 失败', errorMessage(cause));
    } finally {
      defaultInFlight.current = false;
      setSwitchingDefault(false);
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
    busy && selectedGroup && busy.installationId === selectedGroup.manager.id
      ? { action: busy.action, names: busy.names }
      : null;
  const blockedByOtherAction = Boolean(busy) && !selectedBusy;
  const actionsBlocked = blockedByOtherAction || switchingDefault;

  return (
    <div>
      <Header
        theme={theme}
        scannedAt={scan.scannedAt}
        durationMs={scan.durationMs}
        refreshing={refreshing}
        disabled={Boolean(busy) || switchingDefault}
        onToggleTheme={toggleTheme}
        onRefresh={() => void load(true)}
      />

      <main className="app-main">
        {scan.defaultState.configured ? (
          <div
            className={`default-banner${scan.defaultState.targetAvailable ? '' : ' warn'}`}
          >
            <Star size={14} className="default-banner-icon" />
            <div className="default-banner-text">
              <strong>
                默认 npm：{scan.defaultState.npmVersion ?? '未知'}
                {scan.defaultState.source
                  ? ` · ${SOURCE_LABEL[scan.defaultState.source]}`
                  : ''}
              </strong>
              <span>
                {!scan.defaultState.targetAvailable
                  ? '已配置的目标 npm 不存在，请重新选择或移除默认设置。'
                  : scan.defaultState.pendingRestart
                    ? scan.defaultState.shellIntegration &&
                      scan.defaultState.rcFileShort
                      ? `新开终端，或执行 source ${scan.defaultState.rcFileShort} 后生效。`
                      : `请手动把 ${scan.defaultState.wrapperDir} 放到 PATH 最前。`
                    : '当前终端已生效。'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet default-banner-action"
              disabled={switchingDefault || Boolean(busy)}
              onClick={() => {
                if (actionInFlight.current || defaultInFlight.current) return;
                setConfirm({ kind: 'reset-default' });
              }}
            >
              <RotateCcw size={13} />
              移除默认设置
            </button>
          </div>
        ) : null}

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
              groups={groups}
              selectedGroupId={selectedGroup?.id ?? null}
              collapsed={collapseByRoot}
              onSelect={(group) => setSelectedId(group.primary.id)}
              onToggleCollapse={() => setCollapseByRoot((value) => !value)}
            />

            {selectedGroup ? (
              <PackagePanel
                group={selectedGroup}
                busy={selectedBusy}
                blocked={actionsBlocked}
                blockedReason={
                  switchingDefault
                    ? '正在切换默认 npm，请稍候…'
                    : '另一个 npm 安装正在执行操作，完成前暂不能提交新的更新或卸载。'
                }
                onSetDefault={(installation) => {
                  if (actionInFlight.current || defaultInFlight.current) return;
                  setConfirm({ kind: 'set-default', installation });
                }}
                onUpdate={(name) => {
                  if (actionInFlight.current || defaultInFlight.current) return;
                  void runAction('update', [name]);
                }}
                onUninstall={(pkg) => {
                  if (actionInFlight.current || defaultInFlight.current) return;
                  setConfirm({ kind: 'uninstall', pkg });
                }}
                onUpdateAll={(names) => {
                  if (actionInFlight.current || defaultInFlight.current) return;
                  setConfirm({ kind: 'update-all', names });
                }}
              />
            ) : (
              <section className="panel">
                <div className="empty-state">
                  <div className="empty-title">
                    {collapseByRoot ? '请选择一个全局目录' : '请选择一个 npm 安装'}
                  </div>
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
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'uninstall') {
            void runAction('uninstall', [confirm.pkg.name]);
          }
        }}
        body={
          confirm?.kind === 'uninstall' ? (
            <>
              将从 <code>{selectedGroup?.path}</code> 对应的全局目录中移除{' '}
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

      <ConfirmDialog
        open={confirm?.kind === 'set-default'}
        title="切换默认 npm"
        confirmLabel={
          scan.defaultState.shellIntegration
            ? '设为默认'
            : '安装包装器并设为默认'
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'set-default') {
            void changeDefault(confirm.installation);
          }
        }}
        body={
          confirm?.kind === 'set-default' ? (
            <>
              <div className="default-target">
                <div className="default-target-title">
                  <span className="default-target-version">
                    npm {confirm.installation.version ?? '?'}
                  </span>
                  <span className="source-pill">
                    {SOURCE_LABEL[confirm.installation.source]}
                  </span>
                </div>
                <code>{confirm.installation.path}</code>
              </div>

              {!scan.defaultState.shellIntegration ? (
                <>
                  npm-atlas 会创建{' '}
                  <code>{scan.defaultState.wrapperDir}/npm</code>
                  （以及 npx，若存在），并向{' '}
                  <code>
                    {scan.defaultState.rcFileShort ?? 'shell 启动文件'}
                  </code>{' '}
                  末尾追加一段带标记的 PATH 配置。修改前会备份原文件。
                  {!scan.defaultState.rcFile ? (
                    <> 未识别到可自动修改的 shell，应用后需要手动添加 PATH。</>
                  ) : null}
                </>
              ) : (
                <>将更新 npm-atlas 包装器的指向；新开终端后生效。</>
              )}

              <div className="dialog-note">
                切换的是终端里的 <code>npm</code> / <code>npx</code> 命令，
                不会移动或复制已安装的包。可随时在页面上方移除该设置。
              </div>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={confirm?.kind === 'reset-default'}
        title="移除默认 npm 设置"
        danger
        confirmLabel="确认移除"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void removeDefault()}
        body={
          <>
            将删除 <code>{scan.defaultState.wrapperDir}</code> 下的 npm / npx
            包装器，并从{' '}
            <code>{scan.defaultState.rcFileShort ?? 'shell 启动文件'}</code>{' '}
            移除 npm-atlas 的 PATH 配置（修改前会备份）。之后默认 npm
            重新由系统 PATH 决定。
          </>
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