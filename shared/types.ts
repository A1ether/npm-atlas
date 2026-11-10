export type NpmSource =
  | 'nvm'
  | 'fnm'
  | 'mise'
  | 'volta'
  | 'asdf'
  | 'homebrew'
  | 'n'
  | 'hermes'
  | 'path'
  | 'system'
  | 'custom';

export interface GlobalPackage {
  name: string;
  version: string;
  wanted?: string;
  latest?: string;
  outdated: boolean;
  location: string;
}

export interface NpmInstallation {
  id: string;
  /** Path used to invoke this npm. */
  path: string;
  /** Resolved symlink target of the npm binary. */
  realPath: string;
  version: string | null;
  nodeVersion: string | null;
  prefix: string | null;
  globalRoot: string | null;
  registry: string | null;
  source: NpmSource;
  isDefault: boolean;
  inPath: boolean;
  /** Another npm version points at the same global directory. */
  sharedGlobalRoot: boolean;
  packages: GlobalPackage[];
  packageCount: number;
  outdatedCount: number;
  error?: string;
}

export interface ScanResult {
  installations: NpmInstallation[];
  defaultPath: string | null;
  scannedAt: string;
  platform: string;
  durationMs: number;
}

export type ActionType = 'update' | 'uninstall';

export interface ActionRequest {
  type: ActionType;
  installationId: string;
  packages: string[];
}

export interface PackageActionResult {
  name: string;
  ok: boolean;
  output: string;
}

export interface ActionResponse {
  ok: boolean;
  results: PackageActionResult[];
  scan: ScanResult;
}