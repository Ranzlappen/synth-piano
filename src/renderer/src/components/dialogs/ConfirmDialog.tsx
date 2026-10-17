import { useConfirm } from '../../state/confirm';

export function ConfirmDialog(): React.JSX.Element | null {
  const req = useConfirm((s) => s.request);
  if (!req) return null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-label={req.title}>
        <div className="dialog-title">{req.title}</div>
        <div className="dialog-body">{req.message}</div>
        <div className="dialog-footer">
          {req.buttons.map((b, i) => (
            <button
              key={b.id}
              className={`btn ${b.kind ?? ''}`}
              autoFocus={i === 0}
              onClick={() => useConfirm.getState().answer(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
