import type {
  ActionRequest,
  ActionResponse,
  DefaultActionResponse,
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