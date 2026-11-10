import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  Loader2,
  PackageSearch,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  ActionType,
  GlobalPackage,
  NpmInstallation,
} from '../../../shared/types';
import type { InstallationGroup } from '../groups';
import { SOURCE_LABEL, splitPackageName } from '../lib';

type SortMode = 'name' | 'outdated';

interface PackagePanelProps {
  group: InstallationGroup;
  busy: { action: ActionType; names: string[] } | null;
  /** Another npm installation is running an action; block this panel too. */
  blocked: boolean;
  onUpdate: (name: string) => void;
  onUninstall: (pkg: GlobalPackage) => void;
  onUpdateAll: (names: string[]) => void;
}

export function PackagePanel({
  group,
  busy,
  blocked,
  onUpdate,
  onUninstall,
  onUpdateAll,
}: PackagePanelProps) {
  const installation = group.manager;
  const shared = group.installations.length > 1;
  const versionsLabel = group.versions.length ? group.versions.join(' / ') : '?';
  const nodeVersionsLabel = group.nodeVersions.length
    ? group.nodeVersions.join(' / ')
    : installation.nodeVersion ?? '?';
  const [query, setQuery] = useState('');
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [sort, setSort] = useState<SortMode>('name');

  useEffect(() => {
    setQuery('');
    setOnlyOutdated(false);
  }, [group.id]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = installation.packages.filter((entry) => {
      if (onlyOutdated && !entry.outdated) return false;
      if (!keyword) return true;
      return (
        entry.name.toLowerCase().includes(keyword) ||
        entry.version.toLowerCase().includes(keyword) ||
        (entry.latest ?? '').toLowerCase().includes(keyword)
      );
    });

    return filtered.sort((a, b) => {
      if (sort === 'outdated' && a.outdated !== b.outdated) {
        return Number(b.outdated) - Number(a.outdated);
      }
      return a.name.localeCompare(b.name);
    });
  }, [installation.packages, onlyOutdated, query, sort]);

  const outdatedNames = useMemo(
    () => installation.packages.filter((entry) => entry.outdated).map((entry) => entry.name),
    [installation.packages],
  );

  const isBusy = Boolean(busy);
  const busyHere = busy !== null;
  const actionsDisabled = isBusy || blocked;

  return (
    <section className="panel">
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">正在管理</div>
          <h2 className="panel-title">
            {SOURCE_LABEL[group.primary.source]}
            <span className="muted">· npm {versionsLabel}</span>
            {group.isDefault ? <span className="default-pill">默认</span> : null}
            {shared ? (
              <span className="source-pill">{group.installations.length} 个 npm</span>
            ) : null}
          </h2>
          <div className="panel-path" title={group.path}>
            {group.path}
          </div>
        </div>

        <div className="head-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!outdatedNames.length || actionsDisabled}
            onClick={() => onUpdateAll(outdatedNames)}
          >
            <ArrowUpCircle size={14} />
            更新全部可更新
            {outdatedNames.length ? ` (${outdatedNames.length})` : ''}
          </button>
        </div>
      </div>

      <div className="facts">
        <div className="fact">
          <div className="fact-label">Node</div>
          <div className="fact-value" title={nodeVersionsLabel}>
            {nodeVersionsLabel}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">Registry</div>
          <div className="fact-value" title={installation.registry ?? '未知'}>
            {installation.registry ?? '未知'}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">Prefix</div>
          <div className="fact-value" title={installation.prefix ?? '未知'}>
            {installation.prefix ?? '未知'}
          </div>
        </div>
        <div className="fact">
          <div className="fact-label">
            全局目录{shared ? ' · 共享' : ''}
          </div>
          <div className="fact-value" title={installation.globalRoot ?? '未知'}>
            {installation.globalRoot ?? '未知'}
          </div>
        </div>
      </div>

      {shared ? (
        <div className="npm-variants">
          <span className="npm-variants-label">该目录下的 npm</span>
          {group.installations.map((entry) => (
            <span
              key={entry.id}
              className="npm-variant"
              title={`${entry.path} · node ${entry.nodeVersion ?? '?'}`}
            >
              {entry.version ?? '?'} · {SOURCE_LABEL[entry.source]}
              {entry.isDefault ? ' · 默认' : ''}
            </span>
          ))}
        </div>
      ) : null}

      <div className="toolbar">
        <div className="search">
          <Search size={14} />
          <input
            className="input"
            value={query}
            placeholder="搜索包名或版本…"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索全局包"
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
          {visible.length} / {installation.packageCount} 个包
          {installation.outdatedCount ? ` · ${installation.outdatedCount} 可更新` : ''}
        </span>
      </div>

      {busyHere ? (
        <>
          <div className="progress-strip" />
          <div className="busy-note">
            <Loader2 size={13} className="spin" />
            {busy?.action === 'update' ? '正在更新' : '正在卸载'} {busy?.names.length} 个全局包，
            请勿关闭服务…
          </div>
        </>
      ) : blocked ? (
        <div className="busy-note blocked">
          <Loader2 size={13} className="spin" />
          另一个 npm 安装正在执行操作，完成前暂不能提交新的更新或卸载。
        </div>
      ) : null}

      <PackageTable
        installation={installation}
        packages={visible}
        busy={actionsDisabled}
        onUpdate={onUpdate}
        onUninstall={onUninstall}
      />

      <div className="panel-foot">
        <span>
          操作仅作用于当前{shared ? '全局目录' : '安装'}；包名与安装均在扫描结果中校验后才执行。
        </span>
        <span>
          <code>npm install -g &lt;pkg&gt;@latest</code>
        </span>
      </div>
    </section>
  );
}

interface PackageTableProps {
  installation: NpmInstallation;
  packages: GlobalPackage[];
  busy: boolean;
  onUpdate: (name: string) => void;
  onUninstall: (pkg: GlobalPackage) => void;
}

function PackageTable({
  installation,
  packages,
  busy,
  onUpdate,
  onUninstall,
}: PackageTableProps) {
  if (!installation.packageCount) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="empty-icon">
            <PackageSearch size={22} />
          </div>
          <div className="empty-title">
            {installation.sharedGlobalRoot ? '这个全局目录还没有包' : '这个 npm 还没有全局包'}
          </div>
          <div className="empty-note">
            {installation.error
              ? installation.error
              : '可以先用这个安装执行一次 npm install -g <pkg>，然后点击右上角重新扫描。'}
          </div>
        </div>
      </div>
    );
  }

  if (!packages.length) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="empty-icon">
            <PackageSearch size={22} />
          </div>
          <div className="empty-title">没有匹配的包</div>
          <div className="empty-note">试试清空搜索，或关闭「仅看可更新」。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="pkg-table">
        <thead>
          <tr>
            <th>包</th>
            <th style={{ width: 120 }}>当前</th>
            <th style={{ width: 110 }}>最新</th>
            <th style={{ width: 100 }}>状态</th>
            <th style={{ width: 92, textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((entry) => {
            const { scope, base } = splitPackageName(entry.name);
            const protectedPackage = entry.name === 'npm';
            return (
              <tr key={entry.name} className={entry.outdated ? 'is-outdated' : undefined}>
                <td>
                  <div className="pkg-name">
                    {scope ? <span className="pkg-scope">{scope}</span> : null}
                    {base}
                  </div>
                  <div className="pkg-loc" title={entry.location}>
                    {entry.location}
                  </div>
                </td>
                <td className="version-cell">
                  {entry.version}
                  {entry.outdated && entry.latest ? (
                    <span className="mobile-latest">→ {entry.latest}</span>
                  ) : null}
                </td>
                <td className={`version-cell${entry.outdated ? ' latest' : ''}`}>
                  {entry.outdated && entry.latest ? entry.latest : '—'}
                </td>
                <td>
                  {entry.outdated ? (
                    <span className="status-pill warn">可更新</span>
                  ) : (
                    <span className="status-pill">已安装</span>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-btn update"
                      title={
                        entry.outdated
                          ? `更新到 ${entry.latest ?? '最新版本'}`
                          : '已是最新版本'
                      }
                      aria-label={`更新 ${entry.name}`}
                      disabled={busy || !entry.outdated}
                      onClick={() => onUpdate(entry.name)}
                    >
                      <ArrowUpCircle size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title={
                        protectedPackage
                          ? 'npm 自身不可卸载，请使用更新操作升级'
                          : `卸载 ${entry.name}`
                      }
                      aria-label={`卸载 ${entry.name}`}
                      disabled={busy || protectedPackage}
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