import type { NpmSource } from '../../shared/types';

export const SOURCE_LABEL: Record<NpmSource, string> = {
  nvm: 'nvm',
  fnm: 'fnm',
  mise: 'mise',
  volta: 'volta',
  asdf: 'asdf',
  homebrew: 'Homebrew',
  n: 'n',
  hermes: 'Hermes',
  path: 'PATH',
  system: 'system',
  custom: 'custom',
};

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function splitPackageName(name: string): { scope: string; base: string } {
  if (name.startsWith('@') && name.includes('/')) {
    const index = name.indexOf('/');
    return { scope: `${name.slice(0, index)}/`, base: name.slice(index + 1) };
  }
  return { scope: '', base: name };
}