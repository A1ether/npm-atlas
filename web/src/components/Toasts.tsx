import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

interface ToastsProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

export function Toasts({ items, onDismiss }: ToastsProps) {
  if (!items.length) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="toast" role="status">
          <span className={`toast-icon ${item.kind === 'success' ? 'ok' : item.kind === 'error' ? 'bad' : 'info'}`}>
            {item.kind === 'success' ? (
              <CheckCircle2 size={17} />
            ) : item.kind === 'error' ? (
              <AlertCircle size={17} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="toast-title">{item.title}</div>
            {item.detail ? <div className="toast-detail">{item.detail}</div> : null}
          </div>
          <button
            type="button"
            className="icon-btn toast-close"
            onClick={() => onDismiss(item.id)}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}