import { X } from 'lucide-react';

interface Props {
  title: string;
  wide?: boolean;
  medium?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ title, wide, medium, onClose, children, footer }: Props): React.JSX.Element {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog ${wide ? 'wide' : medium ? 'medium' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-title">
          {title}
          <button className="btn icon small" onClick={onClose} title="Close (Esc)">
            <X />
          </button>
        </div>
        {wide ? (
          <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
        ) : (
          <div className="dialog-body">{children}</div>
        )}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
