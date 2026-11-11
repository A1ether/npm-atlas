import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  FolderPlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Star,
} from 'lucide-react';
import type {
  ActionType,
  GlobalPackage,
  NpmInstallation,
  ProjectActionType,
  ProjectImportResponse,
  ProjectInfo,
  ProjectListResult,
  ProjectPackage,
  ScanResult,
} from '../../shared/types';
import {
  applyDefaultNpm,
  fetchProjects,
  fetchScan,
  postAction,
  postProjectAction,
  refreshProject as refreshProjectRequest,
  removeProjects as removeProjectsRequest,
  resetDefaultNpm as resetDefaultRequest,
} from './api';
import { Header, type AppView } from './components/Header';
import { Stats } from './components/Stats';
import { InstallationList } from './components/InstallationList';
import { PackagePanel } from './components/PackagePanel';
import { AddDependencyDialog } from './components/AddDependencyDialog';
import { ImportProjectsDialog } from './components/ImportProjectsDialog';
import { ProjectList } from './components/ProjectList';
import { ProjectPanel } from './components/ProjectPanel';
import { ProjectStats } from './components/ProjectStats';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toasts, type ToastItem } from './components/Toasts';
import { groupInstallations } from './groups';
import { addCommand, errorMessage, installCommand, removeCommand, SOURCE_LABEL } from './lib';

type Theme = 'dark' | 'light';

const COLLAPSE_STORAGE_KEY = 'npm-atlas-collapse-mode';

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

type ProjectConfirmState =
  | {
      kind: 'update';
      project: ProjectInfo;
      packages: ProjectPackage[];
    }
  | { kind: 'uninstall'; project: ProjectInfo; pkg: ProjectPackage }
  | { kind: 'remove-project'; project: ProjectInfo }
  | { kind: 'install-all'; project: ProjectInfo }
  | null;

interface ProjectBusyState {
  projectId: string;
  action: ProjectActionType | 'remove';
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
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) !== 'expanded';
    } catch {
      return true;
    }
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [switchingDefault, setSwitchingDefault] = useState(false);
  const [view, setView] = useState<AppView>(() => {
    try {
      return localStorage.getItem('npm-atlas-view') === 'projects'
        ? 'projects'
        : 'global';
    } catch {
      return 'global';
    }
  });
  const [projects, setProjects] = useState<ProjectListResult | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsRefreshing, setProjectsRefreshing] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem('npm-atlas-project');
      } catch {
        return null;
      }
    },
  );
  const [projectBusy, setProjectBusy] = useState<ProjectBusyState | null>(null);
  const [projectConfirm, setProjectConfirm] =
    useState<ProjectConfirmState>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addDependencyOpen, setAddDependencyOpen] = useState(false);
  const [projectRefreshingId, setProjectRefreshingId] = useState<string | null>(
    null,
  );
  const toastId = useRef(0);
  const actionInFlight = useRef(false);
  const defaultInFlight = useRef(false);
  const projectActionInFlight = useRef(false);
  const projectLoadInFlight = useRef(false);
  const projectRefreshInFlight = useRef(false);

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
      localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        collapseByRoot ? 'collapsed' : 'expanded',
      );
    } catch {
      // preference is optional; the view still works without persistence
    }
  }, [collapseByRoot]);

  useEffect(() => {
    try {
      localStorage.setItem('npm-atlas-view', view);
    } catch {
      // preference is optional
    }
  }, [view]);

  useEffect(() => {
    try {
      if (selectedProjectId) {
        localStorage.setItem('npm-atlas-project', selectedProjectId);
      }
    } catch {
      // preference is optional
    }
  }, [selectedProjectId]);

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

  const loadProjects = async (refresh: boolean) => {
    if (projectLoadInFlight.current) return;
    projectLoadInFlight.current = true;
    if (refresh) setProjectsRefreshing(true);
    else setProjectsLoading(true);
    setProjectsError(null);

    try {
      const data = await fetchProjects(refresh);
      setProjects(data);
      setSelectedProjectId((previous) => {
        if (previous && data.projects.some((project) => project.id === previous)) {
          return previous;
        }
        return data.projects[0]?.id ?? null;
      });
    } catch (cause) {
      const message = errorMessage(cause);
      setProjectsError(message);
      if (projects) pushToast('error', '读取项目失败', message);
    } finally {
      projectLoadInFlight.current = false;
      setProjectsLoading(false);
      setProjectsRefreshing(false);
    }
  };

  useEffect(() => {
    if (view === 'projects' && !projects && !projectsError) {
      void loadProjects(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

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
      defaultInFlight.current ||
      projectActionInFlight.current
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
    if (
      actionInFlight.current ||
      defaultInFlight.current ||
      projectActionInFlight.current
    ) {
      return;
    }
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
    if (
      actionInFlight.current ||
      defaultInFlight.current ||
      projectActionInFlight.current
    ) {
      return;
    }
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

  const runProjectAction = async (
    action: ProjectActionType,
    project: ProjectInfo,
    names: string[],
    dev?: boolean,
  ) => {
    if (
      projectActionInFlight.current ||
      actionInFlight.current ||
      defaultInFlight.current ||
      projectsRefreshing ||
      projectRefreshingId !== null
    ) {
      return;
    }
    if (!names.length && action !== 'install-all') return;

    projectActionInFlight.current = true;
    setProjectConfirm(null);
    setAddDependencyOpen(false);
    setProjectBusy({ projectId: project.id, action, names });

    const verb =
      action === 'update'
        ? '更新'
        : action === 'uninstall'
          ? '移除'
          : action === 'install'
            ? '添加'
            : '';

    try {
      const response = await postProjectAction({
        type: action,
        projectId: project.id,
        packages: names,
        dev,
      });
      setProjects(response.list);
      setSelectedProjectId(project.id);
      setProjectsError(null);

      const failed = response.results.filter((result) => !result.ok);
      const succeeded = response.results.length - failed.length;

      if (failed.length) {
        pushToast(
          'error',
          action === 'install-all'
            ? '项目依赖安装失败'
            : `${failed.length} 个依赖${verb}失败`,
          failed
            .map((result) => `${result.name}\n${result.output}`)
            .join('\n\n'),
        );
        if (succeeded) {
          pushToast(
            'success',
            action === 'install-all'
              ? '依赖安装部分完成'
              : `其余 ${succeeded} 个依赖已${verb}`,
          );
        }
      } else {
        pushToast(
          'success',
          action === 'install-all'
            ? '项目依赖安装完成'
            : `${names.length} 个依赖已${verb}`,
          action === 'update'
            ? 'package.json 与锁文件已刷新。'
            : action === 'uninstall'
              ? '依赖已从项目与锁文件中移除。'
              : action === 'install'
                ? '依赖已写入 package.json。'
                : 'node_modules 已就绪。',
        );
      }
    } catch (cause) {
      pushToast('error', '项目操作失败', errorMessage(cause));
    } finally {
      projectActionInFlight.current = false;
      setProjectBusy(null);
    }
  };

  const refreshProjectData = async (project: ProjectInfo) => {
    if (
      projectRefreshInFlight.current ||
      projectBusy ||
      busy ||
      switchingDefault
    ) {
      return;
    }

    projectRefreshInFlight.current = true;
    setProjectRefreshingId(project.id);
    try {
      const list = await refreshProjectRequest(project.id);
      setProjects(list);
      setProjectsError(null);
      setSelectedProjectId((previous) =>
        previous && list.projects.some((entry) => entry.id === previous)
          ? previous
          : project.id,
      );
    } catch (cause) {
      pushToast('error', '重新读取失败', errorMessage(cause));
    } finally {
      projectRefreshInFlight.current = false;
      setProjectRefreshingId(null);
    }
  };

  const removeProject = async (project: ProjectInfo) => {
    if (
      projectActionInFlight.current ||
      actionInFlight.current ||
      defaultInFlight.current ||
      projectsRefreshing ||
      projectRefreshingId !== null
    ) {
      return;
    }

    const previousIndex =
      projects?.projects.findIndex((entry) => entry.id === project.id) ?? -1;

    projectActionInFlight.current = true;
    setProjectConfirm(null);
    setProjectBusy({ projectId: project.id, action: 'remove', names: [] });

    try {
      const list = await removeProjectsRequest([project.id]);
      setProjects(list);
      setProjectsError(null);
      const nextIndex = Math.min(
        Math.max(previousIndex, 0),
        Math.max(list.projects.length - 1, 0),
      );
      setSelectedProjectId(list.projects[nextIndex]?.id ?? null);
      pushToast('success', '项目已移除', '仅从 npm-atlas 移除记录，未改动磁盘文件。');
    } catch (cause) {
      pushToast('error', '移除项目失败', errorMessage(cause));
    } finally {
      projectActionInFlight.current = false;
      setProjectBusy(null);
    }
  };

  const handleImported = (result: ProjectImportResponse) => {
    setProjects(result.list);
    setProjectsError(null);
    setImportOpen(false);
    if (result.imported.length) {
      setSelectedProjectId(result.imported[0]);
      pushToast(
        'success',
        `已导入 ${result.imported.length} 个项目`,
        `当前共 ${result.list.projects.length} 个项目。`,
      );
    } else {
      pushToast('info', '所选项目都已导入', '可以直接在左侧选择查看。');
    }
  };

  const changeView = (next: AppView) => {
    setView(next);
    if (next === 'projects' && !projects && !projectsError) {
      void loadProjects(false);
    }
  };

  const openImport = () => {
    if (projectsRefreshing || projectBusy || busy || switchingDefault) return;
    setImportOpen(true);
  };

  const toggleTheme = () => {
    setTheme((previous) => (previous === 'dark' ? 'light' : 'dark'));
  };

  if (view === 'global' && !scan) {
    if (loading) {
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

    if (error) {
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

    return null;
  }

  const selectedBusy =
    busy && selectedGroup && busy.installationId === selectedGroup.manager.id
      ? { action: busy.action, names: busy.names }
      : null;
  const blockedByOtherAction = Boolean(busy) && !selectedBusy;
  const anyBusy =
    Boolean(busy) ||
    Boolean(projectBusy) ||
    switchingDefault ||
    projectRefreshingId !== null;
  const actionsBlocked =
    blockedByOtherAction || switchingDefault || Boolean(projectBusy);

  const selectedProject =
    projects?.projects.find((project) => project.id === selectedProjectId) ??
    projects?.projects[0] ??
    null;
  const projectBusyHere = Boolean(
    projectBusy &&
      selectedProject &&
      projectBusy.projectId === selectedProject.id,
  );
  const projectBlocked =
    (Boolean(projectBusy) && !projectBusyHere) ||
    Boolean(busy) ||
    switchingDefault ||
    projectsRefreshing;
  const projectBlockedReason = switchingDefault
    ? '正在切换默认 npm，请稍候…'
    : busy
      ? '全局包操作正在进行，完成前暂不能提交新的项目操作。'
      : projectsRefreshing
        ? '正在重新读取项目列表，请稍候…'
        : projectBusy && !projectBusyHere
          ? '另一个项目正在执行操作，完成前暂不能提交新的项目操作。'
          : undefined;

  const headerScannedAt =
    view === 'global' ? scan?.scannedAt ?? null : projects?.scannedAt ?? null;
  const headerDuration =
    view === 'global' ? scan?.durationMs ?? null : projects?.durationMs ?? null;

  return (
    <div>
      <Header
        view={view}
        theme={theme}
        scannedAt={headerScannedAt}
        durationMs={headerDuration}
        refreshing={view === 'global' ? refreshing : projectsRefreshing}
        disabled={anyBusy}
        stampLabel={view === 'projects' ? '读取于' : '扫描于'}
        onToggleTheme={toggleTheme}
        onChangeView={changeView}
        onRefresh={() => {
          if (view === 'global') void load(true);
          else void loadProjects(true);
        }}
      />

      <main className="app-main">
        {view === 'global' && scan ? (
          <>
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
              disabled={switchingDefault || Boolean(busy) || Boolean(projectBusy)}
              onClick={() => {
                if (
                  actionInFlight.current ||
                  defaultInFlight.current ||
                  projectActionInFlight.current
                ) {
                  return;
                }
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
                    : projectBusy
                      ? '项目操作正在进行，完成前暂不能提交新的全局包操作。'
                      : '另一个 npm 安装正在执行操作，完成前暂不能提交新的更新或卸载。'
                }
                onSetDefault={(installation) => {
                  if (
                    actionInFlight.current ||
                    defaultInFlight.current ||
                    projectActionInFlight.current
                  ) {
                    return;
                  }
                  setConfirm({ kind: 'set-default', installation });
                }}
                onUpdate={(name) => {
                  if (
                    actionInFlight.current ||
                    defaultInFlight.current ||
                    projectActionInFlight.current
                  ) {
                    return;
                  }
                  void runAction('update', [name]);
                }}
                onUninstall={(pkg) => {
                  if (
                    actionInFlight.current ||
                    defaultInFlight.current ||
                    projectActionInFlight.current
                  ) {
                    return;
                  }
                  setConfirm({ kind: 'uninstall', pkg });
                }}
                onUpdateAll={(names) => {
                  if (
                    actionInFlight.current ||
                    defaultInFlight.current ||
                    projectActionInFlight.current
                  ) {
                    return;
                  }
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
          </>
        ) : view === 'projects' ? (
          <>
            {projectsLoading && !projects ? (
              <section className="panel" style={{ marginTop: 18 }}>
                <div className="empty-state">
                  <div className="empty-title">
                    <Loader2
                      size={16}
                      className="spin"
                      style={{ color: 'var(--accent)' }}
                    />
                    正在读取项目依赖…
                  </div>
                  <div className="empty-note">
                    读取 package.json、node_modules 与可更新版本。首次读取可能需要几秒。
                  </div>
                </div>
              </section>
            ) : projectsError && !projects ? (
              <section className="panel" style={{ marginTop: 18 }}>
                <div className="empty-state">
                  <div className="empty-icon">
                    <AlertTriangle size={22} />
                  </div>
                  <div className="empty-title">读取项目失败</div>
                  <div className="empty-note">{projectsError}</div>
                  <div className="empty-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void loadProjects(true)}
                    >
                      <RefreshCw size={14} />
                      重试
                    </button>
                  </div>
                </div>
              </section>
            ) : projects ? (
              projects.projects.length ? (
                <>
                  <ProjectStats list={projects} />

                  {projectsError ? (
                    <div className="error-banner" role="alert">
                      <AlertTriangle size={14} />
                      <span>刷新失败：{projectsError}</span>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => void loadProjects(true)}
                      >
                        重试
                      </button>
                    </div>
                  ) : null}

                  <div className="workspace">
                    <ProjectList
                      projects={projects.projects}
                      selectedProjectId={selectedProject?.id ?? null}
                      onSelect={(project) => setSelectedProjectId(project.id)}
                      onImport={openImport}
                    />

                    {selectedProject ? (
                      <ProjectPanel
                        project={selectedProject}
                        busy={
                          projectBusy &&
                          projectBusy.projectId === selectedProject.id
                            ? {
                                action: projectBusy.action,
                                names: projectBusy.names,
                              }
                            : null
                        }
                        refreshing={projectRefreshingId === selectedProject.id}
                        blocked={projectBlocked}
                        blockedReason={projectBlockedReason}
                        onAdd={() => setAddDependencyOpen(true)}
                        onRefresh={() => void refreshProjectData(selectedProject)}
                        onRemove={() => {
                          if (projectActionInFlight.current) return;
                          setProjectConfirm({
                            kind: 'remove-project',
                            project: selectedProject,
                          });
                        }}
                        onUpdate={(pkg) => {
                          if (projectActionInFlight.current) return;
                          setProjectConfirm({
                            kind: 'update',
                            project: selectedProject,
                            packages: [pkg],
                          });
                        }}
                        onUninstall={(pkg) => {
                          if (projectActionInFlight.current) return;
                          setProjectConfirm({
                            kind: 'uninstall',
                            project: selectedProject,
                            pkg,
                          });
                        }}
                        onUpdateAll={(packages) => {
                          if (projectActionInFlight.current) return;
                          setProjectConfirm({
                            kind: 'update',
                            project: selectedProject,
                            packages,
                          });
                        }}
                        onInstallAll={() => {
                          if (projectActionInFlight.current) return;
                          setProjectConfirm({
                            kind: 'install-all',
                            project: selectedProject,
                          });
                        }}
                      />
                    ) : (
                      <section className="panel">
                        <div className="empty-state">
                          <div className="empty-title">请选择一个项目</div>
                        </div>
                      </section>
                    )}
                  </div>
                </>
              ) : (
                <section className="panel" style={{ marginTop: 18 }}>
                  <div className="empty-state">
                    <div className="empty-icon">
                      <FolderPlus size={22} />
                    </div>
                    <div className="empty-title">还没有导入项目</div>
                    <div className="empty-note">
                      扫描一个目录，导入包含 package.json 的项目后，就能在这里读取依赖、更新版本和移除依赖。
                    </div>
                    <div className="empty-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={openImport}
                      >
                        <FolderPlus size={14} />
                        导入项目
                      </button>
                    </div>
                  </div>
                </section>
              )
            ) : null}
          </>
        ) : null}
      </main>

      {view === 'global' && scan ? (
        <>
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
        </>
      ) : null}

      {view === 'projects' ? (
        <>
          <ConfirmDialog
            open={projectConfirm?.kind === 'update'}
            title={
              projectConfirm?.kind === 'update' &&
              projectConfirm.packages.length > 1
                ? '批量更新项目依赖'
                : '更新项目依赖'
            }
            confirmLabel="开始更新"
            onCancel={() => setProjectConfirm(null)}
            onConfirm={() => {
              if (projectConfirm?.kind === 'update') {
                void runProjectAction(
                  'update',
                  projectConfirm.project,
                  projectConfirm.packages.map((pkg) => pkg.name),
                );
              }
            }}
            body={
              projectConfirm?.kind === 'update' ? (
                <>
                  将通过{' '}
                  <code>
                    {addCommand(projectConfirm.project.packageManager)}
                  </code>{' '}
                  把以下依赖更新到最新版本，并改写 package.json 中的版本范围与锁文件。
                  <div className="dialog-list">
                    {projectConfirm.packages.map((pkg) => (
                      <div key={pkg.name}>
                        {pkg.name} · {pkg.installed ?? pkg.range} →{' '}
                        {pkg.latest ?? 'latest'}
                        {pkg.major ? ' · 跨主版本' : ''}
                      </div>
                    ))}
                  </div>
                  {projectConfirm.packages.some((pkg) => pkg.major) ? (
                    <div className="dialog-note">
                      其中包含跨主版本更新，请先确认项目代码兼容。
                    </div>
                  ) : null}
                </>
              ) : null
            }
          />

          <ConfirmDialog
            open={projectConfirm?.kind === 'uninstall'}
            title="移除项目依赖"
            danger
            confirmLabel="确认移除"
            onCancel={() => setProjectConfirm(null)}
            onConfirm={() => {
              if (projectConfirm?.kind === 'uninstall') {
                void runProjectAction(
                  'uninstall',
                  projectConfirm.project,
                  [projectConfirm.pkg.name],
                );
              }
            }}
            body={
              projectConfirm?.kind === 'uninstall' ? (
                <>
                  将从{' '}
                  <code>{projectConfirm.project.displayPath}</code> 的
                  package.json 中移除 <code>{projectConfirm.pkg.name}</code>
                  {projectConfirm.pkg.installed
                    ? `（${projectConfirm.pkg.installed}）`
                    : ''}
                  ，并执行{' '}
                  <code>
                    {removeCommand(projectConfirm.project.packageManager)}
                  </code>
                  。锁文件与 node_modules 会同步更新。
                </>
              ) : null
            }
          />

          <ConfirmDialog
            open={projectConfirm?.kind === 'remove-project'}
            title="移除项目"
            danger
            confirmLabel="确认移除"
            onCancel={() => setProjectConfirm(null)}
            onConfirm={() => {
              if (projectConfirm?.kind === 'remove-project') {
                void removeProject(projectConfirm.project);
              }
            }}
            body={
              projectConfirm?.kind === 'remove-project' ? (
                <>
                  将把{' '}
                  <code>{projectConfirm.project.displayPath}</code> 从
                  npm-atlas 的项目列表中移除。不会删除项目文件、package.json 或
                  node_modules，之后可以重新导入。
                </>
              ) : null
            }
          />

          <ConfirmDialog
            open={projectConfirm?.kind === 'install-all'}
            title="安装项目依赖"
            confirmLabel="开始安装"
            onCancel={() => setProjectConfirm(null)}
            onConfirm={() => {
              if (projectConfirm?.kind === 'install-all') {
                void runProjectAction(
                  'install-all',
                  projectConfirm.project,
                  [],
                );
              }
            }}
            body={
              projectConfirm?.kind === 'install-all' ? (
                <>
                  将在 <code>{projectConfirm.project.displayPath}</code> 执行{' '}
                  <code>
                    {installCommand(projectConfirm.project.packageManager)}
                  </code>
                  ，安装 package.json 中的全部依赖并生成或更新锁文件。依赖的安装脚本可能会运行。
                </>
              ) : null
            }
          />
        </>
      ) : null}

      <ImportProjectsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />

      <AddDependencyDialog
        open={addDependencyOpen && Boolean(selectedProject)}
        project={selectedProject}
        onCancel={() => setAddDependencyOpen(false)}
        onSubmit={(names, dev) => {
          if (selectedProject) {
            void runProjectAction('install', selectedProject, names, dev);
          }
        }}
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