import type { ScanResult } from '../../../shared/types';

interface StatsProps {
  scan: ScanResult;
}

export function Stats({ scan }: StatsProps) {
  const uniqueRoots = new Map<string, ScanResult['installations'][number]>();
  for (const installation of scan.installations) {
    const key = installation.globalRoot ?? installation.id;
    if (!uniqueRoots.has(key)) uniqueRoots.set(key, installation);
  }
  const uniqueInstallations = [...uniqueRoots.values()];

  const totalPackages = uniqueInstallations.reduce(
    (sum, installation) => sum + installation.packageCount,
    0,
  );
  const totalOutdated = uniqueInstallations.reduce(
    (sum, installation) => sum + installation.outdatedCount,
    0,
  );
  const defaultInstallation = scan.installations.find((entry) => entry.isDefault);

  return (
    <div className="stat-grid">
      <div className="stat-card">
        <div className="stat-label">npm 安装</div>
        <div className="stat-value">
          {scan.installations.length}
          <small>个</small>
        </div>
        <div className="stat-hint">来自 PATH 与常见版本管理器</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">全局包</div>
        <div className="stat-value">
          {totalPackages}
          <small>个</small>
        </div>
        <div className="stat-hint">按全局目录去重后合计</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">可更新</div>
        <div className={`stat-value${totalOutdated ? ' warn' : ''}`}>
          {totalOutdated}
          <small>个</small>
        </div>
        <div className="stat-hint">
          {totalOutdated ? '建议逐个安装确认后更新' : '全部为当前最新版本'}
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-label">默认 npm</div>
        <div className="stat-value" style={{ fontSize: 20 }}>
          {defaultInstallation?.version ?? '—'}
        </div>
        <div className="stat-hint">
          {defaultInstallation
            ? `${defaultInstallation.source} · node ${defaultInstallation.nodeVersion ?? '?'}`
            : '未在 PATH 中找到'}
        </div>
      </div>
    </div>
  );
}