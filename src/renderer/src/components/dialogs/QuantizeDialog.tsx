import { useState } from 'react';
import { GRID_OPTIONS } from '@core/timing';
import { quantizeSelection } from '../../commands';
import { useProject } from '../../state/project';
import { gridTicksFor, useUi } from '../../state/ui';
import { Dialog } from './Dialog';

export function QuantizeDialog(): React.JSX.Element {
  const ui = useUi();
  const selCount = useProject((s) => s.selection.size);
  const [grid, setGrid] = useState(ui.grid);
  const [strength, setStrength] = useState(100);
  const [swing, setSwing] = useState(0);
  const [ends, setEnds] = useState<'keepLength' | 'quantize'>('keepLength');
  const close = () => ui.openDialog(null);
  const apply = () => {
    quantizeSelection({ grid: gridTicksFor(grid), strength: strength / 100, swing: swing / 100, ends });
    close();
  };
  return (
    <Dialog
      title="Quantize"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply}>
            Quantize {selCount ? `${selCount} selected` : 'all'} notes
          </button>
        </>
      }
    >
      <div className="form">
        <label>Grid</label>
        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
          {GRID_OPTIONS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <label>Strength</label>
        <div className="inline">
          <input
            type="range"
            min={0}
            max={100}
            value={strength}
            onChange={(e) => setStrength(Number(e.target.value))}
          />
          <span>{strength}%</span>
        </div>
        <label>Swing</label>
        <div className="inline">
          <input
            type="range"
            min={0}
            max={100}
            value={swing}
            onChange={(e) => setSwing(Number(e.target.value))}
          />
          <span>{swing}%</span>
        </div>
        <label>Note ends</label>
        <select value={ends} onChange={(e) => setEnds(e.target.value as 'keepLength' | 'quantize')}>
          <option value="keepLength">Keep note lengths</option>
          <option value="quantize">Quantize note ends too</option>
        </select>
        <div className="full hint">
          Lower strength keeps some of the human feel. Quantizing only changes the editor data — the sheet
          music exporter has its own, non-destructive quantisation.
        </div>
      </div>
    </Dialog>
  );
}
