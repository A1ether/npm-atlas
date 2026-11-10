import type {
  GlobalPackage,
  NpmInstallation,
  NpmSource,
} from '../../shared/types';

export interface InstallationGroup {
  id: string;
  installations: NpmInstallation[];
  primary: NpmInstallation;
  /** Installation used to read packages and run actions. */
  manager: NpmInstallation;
  sources: NpmSource[];
  versions: string[];
  nodeVersions: string[];
  isDefault: boolean;
  globalRoot: string | null;
  path: string;
  packageCount: number;
  outdatedCount: number;
  packages: GlobalPackage[];
  error?: string;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function groupInstallations(
  installations: NpmInstallation[],
  collapseByRoot: boolean,
): InstallationGroup[] {
  const buckets = new Map<string, NpmInstallation[]>();

  for (const installation of installations) {
    const key = collapseByRoot
      ? installation.globalRoot ?? `id:${installation.id}`
      : `id:${installation.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(installation);
    else buckets.set(key, [installation]);
  }

  return [...buckets.entries()].map(([key, members]) => {
    const primary = members.find((entry) => entry.isDefault) ?? members[0];
    const manager = members.reduce(
      (best, entry) => (entry.packageCount > best.packageCount ? entry : best),
      members[0],
    );
    const shared = members.length > 1;

    return {
      id: shared ? `root:${key}` : primary.id,
      installations: members,
      primary,
      manager,
      sources: unique(members.map((entry) => entry.source)),
      versions: unique(
        members
          .map((entry) => entry.version)
          .filter((value): value is string => Boolean(value)),
      ),
      nodeVersions: unique(
        members
          .map((entry) => entry.nodeVersion)
          .filter((value): value is string => Boolean(value)),
      ),
      isDefault: members.some((entry) => entry.isDefault),
      globalRoot: primary.globalRoot,
      path: shared ? (primary.globalRoot ?? primary.path) : primary.path,
      packageCount: manager.packageCount,
      outdatedCount: manager.outdatedCount,
      packages: manager.packages,
      error: members.find((entry) => entry.error)?.error,
    } satisfies InstallationGroup;
  });
}