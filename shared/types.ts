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

export interface DefaultState {
  configured: boolean;
  targetId: string | null;
  targetPath: string | null;
  npmVersion: string | null;
  nodeVersion: string | null;
  source: NpmSource | null;
  wrapperDir: string;
  shell: string;
  rcFile: string | null;
  rcFileShort: string | null;
  shellIntegration: boolean;
  /** The wrapper is not the first npm in this process PATH yet. */
  pendingRestart: boolean;
  targetAvailable: boolean;
  snippet: string | null;
  updatedAt: string | null;
}

export interface ScanResult {
  installations: NpmInstallation[];
  defaultPath: string | null;
  defaultState: DefaultState;
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

export interface DefaultActionResponse {
  scan: ScanResult;
  messages: string[];
}

/* ---------- project-level management ---------- */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type DependencyType = 'prod' | 'dev' | 'optional' | 'peer';

export interface ProjectPackage {
  name: string;
  /** Range or spec declared in package.json. */
  range: string;
  type: DependencyType;
  /** Resolved version from node_modules (or the lockfile when unreadable). */
  installed: string | null;
  latest?: string;
  outdated: boolean;
  /** workspace:, file:, link:, git, http… — not safely updatable from here. */
  linked: boolean;
  /** Updating would cross a major version boundary. */
  major: boolean;
}

export interface ProjectInfo {
  id: string;
  path: string;
  displayPath: string;
  name: string;
  version: string | null;
  description: string | null;
  isPrivate: boolean;
  packageManager: PackageManager;
  packageManagerSource: 'field' | 'lockfile' | 'node_modules' | 'default';
  lockfile: string | null;
  hasNodeModules: boolean;
  hasWorkspaces: boolean;
  packages: ProjectPackage[];
  packageCount: number;
  outdatedCount: number;
  linkedCount: number;
  addedAt: string;
  scannedAt: string;
  /** The directory or package.json is no longer readable. */
  missing?: boolean;
  /** Non-fatal issue, typically the registry/outdated check failed. */
  warning?: string;
  error?: string;
}

export interface ProjectCandidate {
  id: string;
  path: string;
  displayPath: string;
  name: string;
  version: string | null;
  isPrivate: boolean;
  packageManager: PackageManager;
  dependencyCount: number;
  devDependencyCount: number;
  hasNodeModules: boolean;
  imported: boolean;
}

export interface ProjectDiscovery {
  root: string;
  displayRoot: string;
  candidates: ProjectCandidate[];
  visited: number;
  truncated: boolean;
  durationMs: number;
}

export interface ProjectRoot {
  path: string;
  displayPath: string;
}

export interface ProjectRootsResult {
  defaultRoot: string;
  roots: ProjectRoot[];
}

export interface ProjectListResult {
  projects: ProjectInfo[];
  scannedAt: string;
  durationMs: number;
}

export type ProjectActionType =
  | 'update'
  | 'uninstall'
  | 'install'
  | 'install-all';

export interface ProjectActionRequest {
  type: ProjectActionType;
  projectId: string;
  packages: string[];
  /** For install: add as devDependencies. */
  dev?: boolean;
}

export interface ProjectActionResponse {
  ok: boolean;
  results: PackageActionResult[];
  list: ProjectListResult;
}

export interface ProjectImportResponse {
  imported: string[];
  list: ProjectListResult;
}