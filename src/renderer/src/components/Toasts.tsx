import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useUi } from '../state/ui';

export function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'info' ? Info : TriangleAlert;
        return (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon />
            <span className="text">{t.text}</span>
            {t.action && (
              <button
                className="btn small primary"
                onClick={() => {
                  t.action!.run();
                  useUi.getState().dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="btn icon small"
              onClick={() => useUi.getState().dismissToast(t.id)}
              title="Dismiss"
            >
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}
