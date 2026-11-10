import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <div className={`dialog-icon${danger ? '' : ' accent'}`}>
            {danger ? <AlertTriangle size={18} /> : <Loader2 size={18} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dialog-title">{title}</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="dialog-body">{body}</div>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {busy ? '执行中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}