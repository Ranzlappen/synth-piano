import { useSettings } from '../../state/settings';
import { SCALES, PITCH_CLASS_NAMES } from '@core/music';
import { useUi } from '../../state/ui';
import { Dialog } from './Dialog';

export function PreferencesDialog(): React.JSX.Element {
  const s = useSettings();
  const close = () => useUi.getState().openDialog(null);
  const rf = s.recordFilter;
  return (
    <Dialog
      title="Preferences"
      medium
      onClose={close}
      footer={
        <button className="btn primary" onClick={close}>
          Done
        </button>
      }
    >
      <div className="form">
        <h4>Recording</h4>
        <label>Count-in</label>
        <select value={s.countInBars} onChange={(e) => s.update({ countInBars: Number(e.target.value) })}>
          <option value={0}>None</option>
          <option value={1}>1 bar</option>
          <option value={2}>2 bars</option>
        </select>
        <label>Mode</label>
        <select
          value={s.recordMode}
          onChange={(e) => s.update({ recordMode: e.target.value as 'overdub' | 'replace' })}
        >
          <option value="overdub">Overdub — add to existing notes</option>
          <option value="replace">Replace — overwrite the recorded range</option>
        </select>
        <label>Record</label>
        <div style={{ display: 'grid', gap: 4 }}>
          {(
            [
              ['pedals', 'Sustain, sostenuto and soft pedal'],
              ['controllers', 'Other controllers (expression, modulation, knobs …)'],
              ['pitchBend', 'Pitch bend'],
              ['aftertouch', 'Aftertouch (channel and polyphonic)'],
              ['programChange', 'Program changes'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={rf[key]}
                onChange={(e) => s.update({ recordFilter: { ...rf, [key]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
          <span className="hint">Note-on velocity and release velocity are always recorded.</span>
        </div>
        <label>Input channel</label>
        <select
          value={rf.channel ?? 'all'}
          onChange={(e) =>
            s.update({
              recordFilter: { ...rf, channel: e.target.value === 'all' ? null : Number(e.target.value) },
            })
          }
        >
          <option value="all">All channels</option>
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              Channel {i + 1}
            </option>
          ))}
        </select>
        <label>Latency compensation</label>
        <div className="inline">
          <input
            type="number"
            min={-200}
            max={500}
            value={s.inputLatencyMs}
            onChange={(e) => s.update({ inputLatencyMs: Number(e.target.value) })}
          />
          <span className="muted">ms (shift recordings earlier if they land late)</span>
        </div>

        <h4>Audio</h4>
        <label>Master volume</label>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={s.masterVolume}
          onChange={(e) => s.update({ masterVolume: Number(e.target.value) })}
        />
        <label>Reverb</label>
        <input
          type="range"
          min={0}
          max={0.8}
          step={0.01}
          value={s.reverb}
          onChange={(e) => s.update({ reverb: Number(e.target.value) })}
        />
        <label>Metronome volume</label>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={s.metronomeVolume}
          onChange={(e) => s.update({ metronomeVolume: Number(e.target.value) })}
        />

        <h4>Editor</h4>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.showGhostNotes}
            onChange={(e) => s.update({ showGhostNotes: e.target.checked })}
          />
          Show notes of other tracks
        </label>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.showNoteNames}
            onChange={(e) => s.update({ showNoteNames: e.target.checked })}
          />
          Show note names on notes
        </label>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.followPlayhead}
            onChange={(e) => s.update({ followPlayhead: e.target.checked })}
          />
          Follow the playhead (F)
        </label>
        <label>Scale highlight</label>
        <div className="inline">
          <select value={s.scaleRoot} onChange={(e) => s.update({ scaleRoot: Number(e.target.value) })}>
            {PITCH_CLASS_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select value={s.scaleType} onChange={(e) => s.update({ scaleType: e.target.value })}>
            {SCALES.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.id === 'chromatic' ? 'Off (chromatic)' : sc.label}
              </option>
            ))}
          </select>
        </div>

        <h4>General</h4>
        <label>Theme</label>
        <select value={s.theme} onChange={(e) => s.update({ theme: e.target.value as 'dark' | 'light' })}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <label>Autosave</label>
        <select
          value={s.autosaveMinutes}
          onChange={(e) => s.update({ autosaveMinutes: Number(e.target.value) })}
        >
          <option value={0}>Off</option>
          <option value={1}>Every minute</option>
          <option value={2}>Every 2 minutes</option>
          <option value={5}>Every 5 minutes</option>
        </select>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.checkUpdates}
            onChange={(e) => s.update({ checkUpdates: e.target.checked })}
          />
          Check for updates on start
        </label>
      </div>
    </Dialog>
  );
}
