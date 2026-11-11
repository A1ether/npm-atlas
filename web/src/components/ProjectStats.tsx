import type { PackageManager, ProjectListResult } from '../../../shared/types';
import { PM_LABEL } from '../lib';

interface ProjectStatsProps {
  list: ProjectListResult;
}

export function ProjectStats({ list }: ProjectStatsProps) {
  const projects = list.projects;
  const totalDependencies = projects.reduce(
    (sum, project) => sum + project.packageCount,
    0,
  );
  const totalOutdated = projects.reduce(
    (sum, project) => sum + project.outdatedCount,
    0,
  );
  const notReady = projects.filter(
    (project) => project.missing || project.error || !project.hasNodeModules,
  ).length;

  const managerCounts = new Map<PackageManager, number>();
  for (const project of projects) {
    managerCounts.set(
      project.packageManager,
      (managerCounts.get(project.packageManager) ?? 0) + 1,
    );
  }
  const managerHint = [...managerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([manager, count]) => `${PM_LABEL[manager]} ${count}`)
    .join(' · ');

  return (
    <div className="stat-grid">
      <div className="stat-card">
        <div className="stat-label">已导入项目</div>
        <div className="stat-value">
          {projects.length}
          <small>个</small>
        </div>
        <div className="stat-hint">{managerHint || '从目录扫描并导入'}</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">项目依赖</div>
        <div className="stat-value">
          {totalDependencies}
          <small>个</small>
        </div>
        <div className="stat-hint">生产、开发、可选与对等依赖</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">可更新</div>
        <div className={`stat-value${totalOutdated ? ' warn' : ''}`}>
          {totalOutdated}
          <small>个</small>
        </div>
        <div className="stat-hint">按已安装版本与最新版本比较</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">未就绪</div>
        <div className={`stat-value${notReady ? ' warn' : ''}`}>
          {notReady}
          <small>个</small>
        </div>
        <div className="stat-hint">路径缺失、读取失败或未安装依赖</div>
      </div>
    </div>
  );
}