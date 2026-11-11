import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  Info,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  DependencyType,
  ProjectActionType,
  ProjectInfo,
  ProjectPackage,
} from '../../../shared/types';
import {
  addCommand,
  DEP_TYPE_LABEL,
  PM_LABEL,
  removeCommand,
  splitPackageName,
} from '../lib';

type TypeFilter = 'all' | DependencyType;
type SortMode = 'name' | 'outdated';

interface ProjectPanelProps {
  project: ProjectInfo;
  busy: { action: ProjectActionType | 'remove'; names: string[] } | null;
  refreshing: boolean;
  /** Another action is running; block this project too. */
  blocked: boolean;
  blockedReason?: string;
  onAdd: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onUpdate: (pkg: ProjectPackage) => void;
  onUninstall: (pkg: ProjectPackage) => void;
  onUpdateAll: (packages: ProjectPackage[]) => void;
  onInstallAll: () => void;
}

export function ProjectPanel({
  project,
  busy,
  refreshing,
  blocked,
  blockedReason,
  onAdd,
  onRefresh,
  onRemove,
  onUpdate,
  onUninstall,
  onUpdateAll,
  onInstallAll,
}: ProjectPanelProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');

  useEffect(() => {
    setQuery('');
    setTypeFilter('all');
    setOnlyOutdated(false);
  }, [project.id]);

  const counts = useMemo(() => {
    const result: Record<DependencyType, number> = {
      prod: 0,
      dev: 0,
      optional: 0,
      peer: 0,
    };
    for (const entry of project.packages) result[entry.type] += 1;
    return result;
  }, [project.packages]);

  useEffect(() => {
    if (typeFilter !== 'all' && counts[typeFilter] === 0) setTypeFilter('all');
  }, [counts, typeFilter]);

  const tabs: { key: TypeFilter; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: project.packageCount },
    ...(['prod', 'dev', 'optional', 'peer'] as const)
      .filter((type) => counts[type] > 0)
      .map((type) => ({
        key: type,
        label: DEP_TYPE_LABEL[type],
        count: counts[type],
      })),
  ];

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = project.packages.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (onlyOutdated && !entry.outdated) return false;
      if (!keyword) return true;
      return (
        entry.name.toLowerCase().includes(keyword) ||
        entry.range.toLowerCase().includes(keyword) ||
        (entry.installed ?? '').toLowerCase().includes(keyword) ||
        (entry.latest ?? '').toLowerCase().includes(keyword)
      );
    });

    return filtered.sort((a, b) => {
      if (sort === 'outdated' && a.outdated !== b.outdated) {
        return Number(b.outdated) - Number(a.outdated);
      }
      return a.name.localeCompare(b.name);
    });
  }, [project.packages, typeFilter, onlyOutdated, query, sort]);

  const updatable = useMemo(
    () =>
      project.packages.filter(
        (entry) =>
          entry.outdated && !entry.linked && entry.type !== 'peer',
      ),
    [project.packages],
  );

  const managerLabel = PM_LABEL[project.packageManager];
  const broken = project.missing || Boolean(project.error);
  const busyHere = Boolean(busy);
  const actionsDisabled = busyHere || blocked || broken || refreshing;
  const refreshDisabled = busyHere || blocked || refreshing;

  const busyLabel = busy
    ? busy.action === 'update'
      ? `正在更新 ${busy.names.length} 个依赖`
      : busy.action === 'uninstall'
        ? `正在移除 ${busy.names.length} 个依赖`
        : busy.action === 'remove'
          ? '正在移除项目记录'
          : busy.action === 'install'
            ? `正在添加 ${busy.names.length} 个依赖`
            : '正在安装项目依赖'
    : '';

  return (
    <section className="panel">
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">项目依赖</div>
          <h2 className="panel-title">
            {project.name}
            {project.version ? (
              <span className="muted">· v{project.version}</span>
            ) : null}
            <span className="pm-pill">{managerLabel}</span>
            {project.isPrivate ? (
              <span className="source-pill">private</span>
            ) : null}
            {project.hasWorkspaces ? (
              <span className="source-pill">workspaces</span>
            ) : null}
          </h2>
          <div className="panel-path" title={project.path}>
            {project.displayPath}
          </div>
        </div>

        <div className="head-actions project-head-actions">
          <button
            type="button"
            className="btn"
            disabled={actionsDisabled}
            onClick={onAdd}
          >
            <Plus size={14} />
            添加依赖
          </button>

          {!project.hasNodeModules &&
          !broken &&
          project.packageCount > 0 ? (
            <button
              type="button"
              className="btn"
              disabled={busyHere || blocked || refreshing}
              title={`在项目目录运行 ${managerLabel} install`}
              onClick={onInstallAll}
            >
              <Download size={14} />
              安装依赖
            </button>
          ) : null}

          <button
            type="button"
            className="btn"
            disabled={refreshDisabled}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? '读取中' : '重新读取'}
          </button>

          <button
            type="button"
            className="btn btn-quiet"
            disabled={busyHere || blocked || refreshing}
            onClick={onRemove}
          >
            <Trash2 size={14} />
            移除
          </button>

          <button
            type="button"
            className="btn btn-primary"
            disabled={!updatable.length || actionsDisabled}
            onClick={() => onUpdateAll(updatable)}
          >
            <ArrowUpCircle size={14} />
            更新全部
            {updatable.length ? ` (${updatable.length})` : ''}
          </button>
        </div>
      </div>

      <div className="facts">
        <div className="fact">
          <div className="fact-label">包管理器</div>
          <div className="fact-value" title={managerLabel}>
            {managerLabel}
            {project.packageManagerSource === 'default' ? '（默认）' : ''}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">锁文件</div>
          <div className="fact-value" title={project.lockfile ?? '未找到'}>
            {project.lockfile ?? '未找到'}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">依赖构成</div>
          <div className="fact-value">
            {counts.prod} 生产 · {counts.dev} 开发
            {counts.optional ? ` · ${counts.optional} 可选` : ''}
            {counts.peer ? ` · ${counts.peer} 对等` : ''}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">安装状态</div>
          <div className="fact-value">
            {project.hasNodeModules ? '已安装 node_modules' : '未安装'}
          </div>
        </div>
      </div>

      {project.missing ? (
        <div className="project-notice danger">
          <AlertTriangle size={14} />
          <span>
            项目路径不存在或不可访问，可能已被移动或删除。可以重新读取，或移除这条记录后重新导入。
          </span>
        </div>
      ) : project.error ? (
        <div className="project-notice danger">
          <AlertTriangle size={14} />
          <span>读取项目失败：{project.error}</span>
        </div>
      ) : null}

      {project.warning ? (
        <div className="project-notice warn">
          <AlertTriangle size={14} />
          <span>最新版本检查：{project.warning}</span>
        </div>
      ) : null}

      {!project.hasNodeModules && !broken ? (
        <div className="project-notice info">
          <Info size={14} />
          <span>
            尚未安装 node_modules，当前版本列可能为空。点击「安装依赖」运行{' '}
            <code>{managerLabel} install</code>。
          </span>
        </div>
      ) : null}

      {project.linkedCount > 0 ? (
        <div className="project-notice info">
          <Info size={14} />
          <span>
            有 {project.linkedCount} 个本地 / 工作区链接依赖（workspace:、file:、link:
            等），已禁用在工具内更新。
          </span>
        </div>
      ) : null}

      {!broken && project.packageCount > 0 ? (
        <>
          <div className="dep-tabs" role="tablist" aria-label="依赖类型">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={typeFilter === tab.key}
                className={`dep-tab${typeFilter === tab.key ? ' is-on' : ''}`}
                onClick={() => setTypeFilter(tab.key)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="toolbar">
            <div className="search">
              <Search size={14} />
              <input
                className="input"
                value={query}
                placeholder="搜索依赖、版本或范围…"
                onChange={(event) => setQuery(event.target.value)}
                aria-label="搜索项目依赖"
              />
            </div>

            <button
              type="button"
              className={`filter-btn${onlyOutdated ? ' is-on' : ''}`}
              onClick={() => setOnlyOutdated((value) => !value)}
              aria-pressed={onlyOutdated}
            >
              <span className="filter-dot" />
              仅看可更新
            </button>

            <select
              className="select"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label="排序方式"
            >
              <option value="name">名称 A→Z</option>
              <option value="outdated">可更新优先</option>
            </select>

            <span className="result-count">
              {visible.length} / {project.packageCount} 个依赖
              {project.outdatedCount
                ? ` · ${project.outdatedCount} 可更新`
                : ''}
            </span>
          </div>
        </>
      ) : null}

      {busyHere ? (
        <>
          <div className="progress-strip" />
          <div className="busy-note">
            <Loader2 size={13} className="spin" />
            {busyLabel}，请勿关闭服务…
          </div>
        </>
      ) : blocked ? (
        <div className="busy-note blocked">
          <Loader2 size={13} className="spin" />
          {blockedReason ?? '另一个操作正在执行，完成前暂不能提交新的项目操作。'}
        </div>
      ) : refreshing ? (
        <div className="busy-note">
          <Loader2 size={13} className="spin" />
          正在重新读取项目依赖…
        </div>
      ) : null}

      {broken || !project.packageCount ? (
        <ProjectEmpty
          project={project}
          onAdd={onAdd}
          actionsDisabled={actionsDisabled}
        />
      ) : (
        <ProjectTable
          project={project}
          packages={visible}
          busy={busyHere || blocked || refreshing}
          onUpdate={onUpdate}
          onUninstall={onUninstall}
        />
      )}

      <div className="panel-foot">
        <span>
          更新 <code>{addCommand(project.packageManager)}</code> · 移除{' '}
          <code>{removeCommand(project.packageManager)}</code>
        </span>
        <span>操作会改写项目 package.json 与锁文件</span>
      </div>
    </section>
  );
}

function ProjectEmpty({
  project,
  onAdd,
  actionsDisabled,
}: {
  project: ProjectInfo;
  onAdd: () => void;
  actionsDisabled: boolean;
}) {
  if (project.missing || project.error) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="empty-icon">
            <AlertTriangle size={22} />
          </div>
          <div className="empty-title">无法读取项目依赖</div>
          <div className="empty-note">
            {project.missing
              ? '项目目录已不可访问。重新读取可能恢复；否则可移除记录后重新导入。'
              : project.error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <div className="empty-state">
        <div className="empty-icon">
          <PackageSearch size={22} />
        </div>
        <div className="empty-title">这个项目还没有声明依赖</div>
        <div className="empty-note">
          这个项目还没有声明依赖。可以点击「添加依赖」，或直接编辑 package.json 后重新读取。
        </div>
        <div className="empty-actions">
          <button
            type="button"
            className="btn"
            disabled={actionsDisabled}
            onClick={onAdd}
          >
            <Plus size={14} />
            添加依赖
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProjectTableProps {
  project: ProjectInfo;
  packages: ProjectPackage[];
  busy: boolean;
  onUpdate: (pkg: ProjectPackage) => void;
  onUninstall: (pkg: ProjectPackage) => void;
}

function ProjectTable({
  project,
  packages,
  busy,
  onUpdate,
  onUninstall,
}: ProjectTableProps) {
  if (!packages.length) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="empty-icon">
            <PackageSearch size={22} />
          </div>
          <div className="empty-title">没有匹配的依赖</div>
          <div className="empty-note">试试清空搜索、切换依赖类型或关闭「仅看可更新」。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="pkg-table project-pkg-table">
        <thead>
          <tr>
            <th>包</th>
            <th style={{ width: 150 }}>声明</th>
            <th style={{ width: 105 }}>当前</th>
            <th style={{ width: 120 }}>最新</th>
            <th style={{ width: 100 }}>状态</th>
            <th style={{ width: 92, textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((entry) => {
            const { scope, base } = splitPackageName(entry.name);
            const canUpdate =
              entry.outdated && !entry.linked && entry.type !== 'peer';
            const status = entry.linked
              ? { label: '本地链接', className: 'info' }
              : entry.type === 'peer'
                ? { label: '对等依赖', className: '' }
                : entry.outdated
                  ? { label: '可更新', className: 'warn' }
                  : entry.installed
                    ? { label: '已安装', className: '' }
                    : { label: '未安装', className: '' };

            const updateTitle = entry.type === 'peer'
              ? '对等依赖不会被安装，请在 package.json 中手动调整'
              : entry.linked
                ? '本地链接依赖不能通过安装命令更新'
                : entry.outdated
                  ? `更新到 ${entry.latest ?? '最新版本'}`
                  : '已是最新版本';

            return (
              <tr
                key={entry.name}
                className={entry.outdated ? 'is-outdated' : undefined}
              >
                <td>
                  <div className="pkg-name">
                    {scope ? <span className="pkg-scope">{scope}</span> : null}
                    {base}
                  </div>
                  {entry.type !== 'prod' ? (
                    <div className="pkg-tags">
                      <span className="dep-type-pill">
                        {DEP_TYPE_LABEL[entry.type]}
                      </span>
                    </div>
                  ) : null}
                </td>
                <td className="range-cell" title={entry.range}>
                  {entry.range || '—'}
                </td>
                <td className="version-cell">
                  {entry.installed ?? '—'}
                  {entry.outdated && entry.latest ? (
                    <span className="mobile-latest">→ {entry.latest}</span>
                  ) : null}
                </td>
                <td
                  className={`version-cell${entry.outdated ? ' latest' : ''}`}
                >
                  {entry.outdated && entry.latest ? entry.latest : '—'}
                  {entry.major ? (
                    <span className="major-flag">跨主版本</span>
                  ) : null}
                </td>
                <td>
                  <span className={`status-pill ${status.className}`}>
                    {status.label}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-btn update"
                      title={updateTitle}
                      aria-label={`更新 ${entry.name}`}
                      disabled={busy || !canUpdate}
                      onClick={() => onUpdate(entry)}
                    >
                      <ArrowUpCircle size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title={`从项目中移除 ${entry.name}`}
                      aria-label={`移除 ${entry.name}`}
                      disabled={busy || project.missing || Boolean(project.error)}
                      onClick={() => onUninstall(entry)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}