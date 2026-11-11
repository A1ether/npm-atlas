import { useMemo, useState } from 'react';
import { ChevronRight, FolderPlus, Search } from 'lucide-react';
import type { ProjectInfo } from '../../../shared/types';
import { PM_LABEL } from '../lib';

interface ProjectListProps {
  projects: ProjectInfo[];
  selectedProjectId: string | null;
  onSelect: (project: ProjectInfo) => void;
  onImport: () => void;
}

export function ProjectList({
  projects,
  selectedProjectId,
  onSelect,
  onImport,
}: ProjectListProps) {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(keyword) ||
        project.displayPath.toLowerCase().includes(keyword) ||
        project.packageManager.includes(keyword),
    );
  }, [projects, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">项目</span>
        <span className="sidebar-count">
          {query.trim()
            ? `${visible.length} / ${projects.length}`
            : `${projects.length} 个`}
        </span>
      </div>

      <div className="sidebar-project-actions">
        <button
          type="button"
          className="btn btn-primary sidebar-import"
          onClick={onImport}
        >
          <FolderPlus size={14} />
          导入项目
        </button>
      </div>

      {projects.length > 6 ? (
        <div className="sidebar-project-search">
          <div className="search">
            <Search size={13} />
            <input
              className="input"
              value={query}
              placeholder="筛选项目名或路径…"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="筛选项目"
            />
          </div>
        </div>
      ) : null}

      <div className="install-list">
        {visible.length ? (
          visible.map((project) => {
            const selected = project.id === selectedProjectId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelect(project)}
                className={`install-card${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
              >
                <div className="install-card-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="pill-row">
                      <span className="pm-pill">
                        {PM_LABEL[project.packageManager]}
                      </span>
                      {project.isPrivate ? (
                        <span className="source-pill">private</span>
                      ) : null}
                    </div>
                    <div className="project-name">{project.name}</div>
                    {project.version ? (
                      <div className="project-version">v{project.version}</div>
                    ) : null}
                    <div className="install-path" title={project.path}>
                      {project.displayPath}
                    </div>
                  </div>
                  <ChevronRight
                    size={15}
                    className="chevron"
                    aria-hidden="true"
                  />
                </div>

                <div className="install-meta">
                  <span>{project.packageCount} 个依赖</span>
                  {project.outdatedCount > 0 ? (
                    <span className="warn">{project.outdatedCount} 可更新</span>
                  ) : null}
                  {!project.hasNodeModules ? <span>未安装依赖</span> : null}
                  {project.missing ? (
                    <span className="bad">路径缺失</span>
                  ) : project.error ? (
                    <span className="bad">读取失败</span>
                  ) : null}
                </div>
              </button>
            );
          })
        ) : (
          <div className="sidebar-empty">
            {projects.length
              ? '没有匹配的项目。'
              : '还没有导入项目。扫描一个目录，把它加入这里。'}
          </div>
        )}
      </div>
    </aside>
  );
}