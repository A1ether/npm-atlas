import type {
  ActionRequest,
  ActionResponse,
  DefaultActionResponse,
  ProjectActionRequest,
  ProjectActionResponse,
  ProjectDiscovery,
  ProjectImportResponse,
  ProjectListResult,
  ProjectRootsResult,
  ScanResult,
} from '../../shared/types';

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(data?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return data as T;
}

export async function fetchScan(refresh = false): Promise<ScanResult> {
  const response = await fetch(`/api/scan${refresh ? '?refresh=1' : ''}`);
  return readJson<ScanResult>(response);
}

export async function postAction(request: ActionRequest): Promise<ActionResponse> {
  const response = await fetch('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  return readJson<ActionResponse>(response);
}

export async function applyDefaultNpm(
  installationId: string,
): Promise<DefaultActionResponse> {
  const response = await fetch('/api/default', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installationId }),
  });
  return readJson<DefaultActionResponse>(response);
}

export async function resetDefaultNpm(): Promise<DefaultActionResponse> {
  const response = await fetch('/api/default/reset', {
    method: 'POST',
  });
  return readJson<DefaultActionResponse>(response);
}

export async function fetchProjects(
  refresh = false,
): Promise<ProjectListResult> {
  const response = await fetch(`/api/projects${refresh ? '?refresh=1' : ''}`);
  return readJson<ProjectListResult>(response);
}

export async function refreshProject(
  id?: string,
): Promise<ProjectListResult> {
  const response = await fetch('/api/projects/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(id ? { id } : {}),
  });
  return readJson<ProjectListResult>(response);
}

export async function fetchProjectRoots(): Promise<ProjectRootsResult> {
  const response = await fetch('/api/projects/roots');
  return readJson<ProjectRootsResult>(response);
}

export async function discoverProjects(
  root: string,
  depth: number,
): Promise<ProjectDiscovery> {
  const response = await fetch('/api/projects/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, depth }),
  });
  return readJson<ProjectDiscovery>(response);
}

export async function importProjects(
  paths: string[],
): Promise<ProjectImportResponse> {
  const response = await fetch('/api/projects/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  return readJson<ProjectImportResponse>(response);
}

export async function removeProjects(ids: string[]): Promise<ProjectListResult> {
  const response = await fetch('/api/projects/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return readJson<ProjectListResult>(response);
}

export async function postProjectAction(
  request: ProjectActionRequest,
): Promise<ProjectActionResponse> {
  const response = await fetch('/api/projects/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  return readJson<ProjectActionResponse>(response);
}