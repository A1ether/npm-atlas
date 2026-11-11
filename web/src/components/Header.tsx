import { FolderTree, Globe, Moon, RefreshCw, Sun } from 'lucide-react';
import { formatDuration, formatTime } from '../lib';

export type AppView = 'global' | 'projects';

interface HeaderProps {
  view: AppView;
  theme: 'dark' | 'light';
  scannedAt: string | null;
  durationMs: number | null;
  refreshing: boolean;
  disabled: boolean;
  stampLabel?: string;
  onToggleTheme: () => void;
  onChangeView: (view: AppView) => void;
  onRefresh: () => void;
}

export function Header({
  view,
  theme,
  scannedAt,
  durationMs,
  refreshing,
  disabled,
  stampLabel = '扫描于',
  onToggleTheme,
  onChangeView,
  onRefresh,
}: HeaderProps) {
  const refreshLabel =
    view === 'projects'
      ? refreshing
        ? '读取中'
        : '重新读取'
      : refreshing
        ? '扫描中'
        : '重新扫描';

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <svg
            className="brand-mark"
            width="34"
            height="34"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="20" cy="20" r="15" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
            <ellipse cx="20" cy="20" rx="7.5" ry="15" stroke="currentColor" strokeWidth="1.1" opacity="0.3" />
            <path d="M5 20h30M20 5v30" stroke="currentColor" strokeWidth="1.1" opacity="0.22" />
            <circle cx="20" cy="20" r="3" fill="currentColor" />
            <circle cx="31" cy="11" r="2.4" fill="var(--accent)" />
          </svg>
          <div>
            <div className="brand-name">
              npm<span>-</span>atlas
            </div>
            <div className="brand-sub">
              {view === 'projects'
                ? '项目级依赖 · 扫描、导入与管理'
                : '本机 npm 全景 · 全局与项目依赖'}
            </div>
          </div>
        </div>

        <nav className="view-switch" role="tablist" aria-label="管理视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'global'}
            className={`view-tab${view === 'global' ? ' is-active' : ''}`}
            onClick={() => onChangeView('global')}
          >
            <Globe size={14} />
            全局包
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'projects'}
            className={`view-tab${view === 'projects' ? ' is-active' : ''}`}
            onClick={() => onChangeView('projects')}
          >
            <FolderTree size={14} />
            项目
          </button>
        </nav>

        <div className="topbar-actions">
          {scannedAt ? (
            <span className="scan-stamp">
              {stampLabel} {formatTime(scannedAt)}
              {durationMs ? ` · ${formatDuration(durationMs)}` : ''}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onRefresh}
            disabled={refreshing || disabled}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshLabel}
          </button>
        </div>
      </div>
    </header>
  );
}