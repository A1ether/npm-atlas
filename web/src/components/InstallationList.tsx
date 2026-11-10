import { ChevronRight, Star } from 'lucide-react';
import type { NpmInstallation } from '../../../shared/types';
import { SOURCE_LABEL } from '../lib';

interface InstallationListProps {
  installations: NpmInstallation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function InstallationList({
  installations,
  selectedId,
  onSelect,
}: InstallationListProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">npm 安装</span>
        <span className="sidebar-count">{installations.length} 个</span>
      </div>

      <div className="install-list">
        {installations.map((installation) => {
          const selected = installation.id === selectedId;
          return (
            <button
              key={installation.id}
              type="button"
              onClick={() => onSelect(installation.id)}
              className={`install-card${selected ? ' is-selected' : ''}`}
              aria-pressed={selected}
            >
              <div className="install-card-top">
                <div style={{ minWidth: 0 }}>
                  <div className="pill-row">
                    <span className="source-pill">
                      {SOURCE_LABEL[installation.source]}
                    </span>
                    {installation.isDefault ? (
                      <span className="default-pill">
                        <Star size={10} strokeWidth={2.4} fill="currentColor" />
                        默认
                      </span>
                    ) : null}
                  </div>
                  <div className="install-version">
                    npm {installation.version ?? '?'}
                    <span> · node {installation.nodeVersion ?? '?'}</span>
                  </div>
                  <div className="install-path" title={installation.path}>
                    {installation.path}
                  </div>
                </div>
                <ChevronRight
                  size={15}
                  className="chevron"
                  aria-hidden="true"
                />
              </div>

              <div className="install-meta">
                <span>{installation.packageCount} 个包</span>
                {installation.outdatedCount > 0 ? (
                  <span className="warn">{installation.outdatedCount} 可更新</span>
                ) : null}
                {installation.error && installation.packageCount === 0 ? (
                  <span className="bad">读取失败</span>
                ) : null}
                {installation.sharedGlobalRoot ? (
                  <span title="与另一个 npm 版本共用同一个全局目录">
                    共享全局目录
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}