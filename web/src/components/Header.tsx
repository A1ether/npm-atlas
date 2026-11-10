import { Moon, RefreshCw, Sun } from 'lucide-react';
import { formatDuration, formatTime } from '../lib';

interface HeaderProps {
  theme: 'dark' | 'light';
  scannedAt: string | null;
  durationMs: number | null;
  refreshing: boolean;
  disabled: boolean;
  onToggleTheme: () => void;
  onRefresh: () => void;
}

export function Header({
  theme,
  scannedAt,
  durationMs,
  refreshing,
  disabled,
  onToggleTheme,
  onRefresh,
}: HeaderProps) {
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
            <div className="brand-sub">本机 npm 全景 · 全局包管理</div>
          </div>
        </div>

        <div className="topbar-actions">
          {scannedAt ? (
            <span className="scan-stamp">
              扫描于 {formatTime(scannedAt)}
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
            {refreshing ? '扫描中' : '重新扫描'}
          </button>
        </div>
      </div>
    </header>
  );
}