import { ChevronRight, Star } from 'lucide-react';
import type { InstallationGroup } from '../groups';
import { SOURCE_LABEL } from '../lib';

interface InstallationListProps {
  groups: InstallationGroup[];
  selectedGroupId: string | null;
  collapsed: boolean;
  onSelect: (group: InstallationGroup) => void;
  onToggleCollapse: () => void;
}

export function InstallationList({
  groups,
  selectedGroupId,
  collapsed,
  onSelect,
  onToggleCollapse,
}: InstallationListProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">npm 安装</span>
        <span className="sidebar-count">
          {collapsed
            ? `${groups.length} 个目录`
            : `${groups.length} 个 npm`}
        </span>
      </div>

      <div className="sidebar-toggle">
        <span>按全局目录折叠</span>
        <button
          type="button"
          role="switch"
          aria-checked={collapsed}
          aria-label="按全局目录折叠"
          className={`switch${collapsed ? ' is-on' : ''}`}
          onClick={onToggleCollapse}
        >
          <span className="switch-knob" />
        </button>
      </div>

      <div className="install-list">
        {groups.map((group) => {
          const selected = group.id === selectedGroupId;
          const shared = group.installations.length > 1;
          const versions = group.versions.length ? group.versions.join(' / ') : '?';
          const nodeVersions = group.nodeVersions.length
            ? group.nodeVersions.join(' / ')
            : '?';

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(group)}
              className={`install-card${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
            >
              <div className="install-card-top">
                <div style={{ minWidth: 0 }}>
                  <div className="pill-row">
                    <span className="source-pill">
                      {SOURCE_LABEL[group.primary.source]}
                    </span>
                    {group.isDefault ? (
                      <span className="default-pill">
                        <Star size={10} strokeWidth={2.4} fill="currentColor" />
                        默认
                      </span>
                    ) : null}
                  </div>
                  <div className="install-version">
                    npm {versions}
                    <span> · node {nodeVersions}</span>
                  </div>
                  <div className="install-path" title={group.path}>
                    {group.path}
                  </div>
                </div>
                <ChevronRight
                  size={15}
                  className="chevron"
                  aria-hidden="true"
                />
              </div>

              <div className="install-meta">
                <span>{group.packageCount} 个包</span>
                {group.outdatedCount > 0 ? (
                  <span className="warn">{group.outdatedCount} 可更新</span>
                ) : null}
                {shared ? (
                  <span title="这些 npm 版本共用同一个全局包目录">
                    {group.installations.length} 个 npm · 共享目录
                  </span>
                ) : group.primary.sharedGlobalRoot ? (
                  <span title="与另一个 npm 版本共用同一个全局目录">
                    共享全局目录
                  </span>
                ) : null}
                {group.error && group.packageCount === 0 ? (
                  <span className="bad">读取失败</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}