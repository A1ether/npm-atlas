import type {
  ActionRequest,
  ActionResponse,
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