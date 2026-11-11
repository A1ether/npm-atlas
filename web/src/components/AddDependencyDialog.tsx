import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { ProjectInfo } from '../../../shared/types';
import { PM_LABEL } from '../lib';

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const MAX_PACKAGES = 50;

interface AddDependencyDialogProps {
  open: boolean;
  project: ProjectInfo | null;
  onCancel: () => void;
  onSubmit: (names: string[], dev: boolean) => void;
}

export function AddDependencyDialog({
  open,
  project,
  onCancel,
  onSubmit,
}: AddDependencyDialogProps) {
  const [value, setValue] = useState('');
  const [dev, setDev] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setDev(false);
  }, [open, project?.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  const parsed = useMemo(() => {
    const items = value
      .split(/[\s,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return [...new Set(items)];
  }, [value]);

  const invalid = parsed.filter((name) => !PACKAGE_NAME.test(name));
  const tooMany = parsed.length > MAX_PACKAGES;
  const canSubmit = parsed.length > 0 && !invalid.length && !tooMany;

  if (!open || !project) return null;

  const manager = PM_LABEL[project.packageManager];
  const previewNames = parsed.length ? parsed.slice(0, 3).join(' ') : '<pkg>';
  const previewMore = parsed.length > 3 ? ' …' : '';
  const preview = [
    project.packageManager === 'npm' ? 'npm install' : `${manager} add`,
    `${previewNames}@latest${previewMore}`,
    dev ? (project.packageManager === 'npm' ? '--save-dev' : '-D') : '',
  ]
    .filter(Boolean)
    .join(' ');

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(parsed, dev);
  };

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="添加依赖"
      >
        <div className="dialog-head">
          <div className="dialog-icon accent">
            <Plus size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dialog-title">添加依赖</div>
            <div className="dialog-sub">
              {project.name} · {project.displayPath}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="field-label">包名</div>
          <input
            className="input plain"
            value={value}
            autoFocus
            placeholder="例如 zod lucide-react"
            aria-label="要添加的包名"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="field-hint">
            多个包用空格、逗号或换行分隔，最多 {MAX_PACKAGES} 个。已存在的依赖会保持原类型。
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={dev}
              onChange={(event) => setDev(event.target.checked)}
            />
            添加到 devDependencies
          </label>

          {invalid.length ? (
            <div className="form-error">
              无效的包名：{invalid.join('、')}
            </div>
          ) : tooMany ? (
            <div className="form-error">单次最多添加 {MAX_PACKAGES} 个包。</div>
          ) : null}

          <div className="command-preview">
            <span>将执行</span>
            <code>{preview}</code>
          </div>

          <div className="dialog-note">
            会更新项目的 package.json 与锁文件。{project.hasWorkspaces
              ? '当前项目包含 workspaces，依赖会写入项目根。'
              : ''}
          </div>
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            <Plus size={14} />
            添加{parsed.length ? ` (${parsed.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}