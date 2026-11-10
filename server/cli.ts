import { getScan } from './scanner';

const asJson = process.argv.includes('--json');
const scan = await getScan(true);

if (asJson) {
  console.log(JSON.stringify(scan, null, 2));
} else {
  console.log(
    `npm-atlas · ${scan.installations.length} 个 npm 安装 · ${scan.durationMs}ms · ${scan.scannedAt}`,
  );
  console.log(`默认：${scan.defaultPath ?? '未找到'}`);
  console.log('');

  for (const installation of scan.installations) {
    const tags = [
      installation.isDefault ? '默认' : null,
      installation.source,
      `npm ${installation.version ?? '?'}`,
      `node ${installation.nodeVersion ?? '?'}`,
      `${installation.packageCount} 个包`,
      installation.outdatedCount ? `${installation.outdatedCount} 个可更新` : null,
    ].filter(Boolean);

    console.log(`${installation.path}`);
    console.log(`  ${tags.join(' · ')}`);
    if (installation.error) console.log(`  ! ${installation.error}`);
  }
}