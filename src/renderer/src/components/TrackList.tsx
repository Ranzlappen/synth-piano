import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { GM_PROGRAMS } from '@core/music';
import { newId, TRACK_COLORS } from '@core/model';
import { runCommand } from '../commands';
import { useProject } from '../state/project';
import { useMidi } from '../state/transport';

function updateTrack(id: string, label: string, patch: Record<string, unknown>): void {
  useProject.getState().commit(label, (d) => {
    const t = d.tracks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  });
}

export function TrackList(): React.JSX.Element {
  const tracks = useProject((s) => s.project.tracks);
  const selectedId = useProject((s) => s.selectedTrackId);
  const outputs = useMidi((s) => s.outputs);
  const [renaming, setRenaming] = useState<string | null>(null);
  const selected = tracks.find((t) => t.id === selectedId) ?? tracks[0];

  const toggle = (id: string, key: 'mute' | 'solo' | 'armed', label: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const t = tracks.find((x) => x.id === id)!;
    useProject.getState().commit(label, (d) => {
      if (key === 'armed' && !t.armed && !e.ctrlKey) for (const x of d.tracks) x.armed = false;
      const tr = d.tracks.find((x) => x.id === id)!;
      tr[key] = !tr[key];
    });
  };

  const duplicate = () => {
    const src = selected;
    const copy = {
      ...src,
      id: newId('t'),
      name: `${src.name} copy`,
      armed: false,
      color: TRACK_COLORS[tracks.length % TRACK_COLORS.length],
      notes: src.notes.map((n) => ({ ...n, id: newId('n') })),
      controls: src.controls.map((c) => ({ ...c, id: newId('c') })),
    };
    useProject.getState().commit('Duplicate track', (d) => {
      d.tracks.splice(d.tracks.findIndex((t) => t.id === src.id) + 1, 0, copy);
    });
    useProject.getState().selectTrack(copy.id);
  };

  const outputMissing =
    selected.output !== 'internal' && !outputs.some((o) => o.name === selected.output && o.connected);

  return (
    <aside className="tracks">
      <div className="tracks-header">
        <span>Tracks</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn icon small"
            title="Add track (Ctrl+T)"
            onClick={() => runCommand('track:add')}
          >
            <Plus />
          </button>
          <button className="btn icon small" title="Duplicate track" onClick={duplicate}>
            <Copy />
          </button>
          <button className="btn icon small" title="Delete track" onClick={() => runCommand('track:delete')}>
            <Trash2 />
          </button>
        </div>
      </div>
      <div className="track-list">
        {tracks.map((t) => (
          <div
            key={t.id}
            className={`track ${t.id === selectedId ? 'selected' : ''}`}
            onClick={() => useProject.getState().selectTrack(t.id)}
            onDoubleClick={() => setRenaming(t.id)}
            data-testid="track"
          >
            <div className="color" style={{ background: t.color }} />
            <div style={{ minWidth: 0 }}>
              {renaming === t.id ? (
                <input
                  className="rename"
                  type="text"
                  autoFocus
                  defaultValue={t.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== t.name) updateTrack(t.id, 'Rename track', { name });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <div className="name" title="Double-click to rename">
                  {t.name}
                </div>
              )}
              <div className="sub">
                Ch {t.channel + 1} · {t.channel === 9 ? 'Drums' : GM_PROGRAMS[t.program]} · {t.notes.length}{' '}
                notes
              </div>
            </div>
            <div className="toggles">
              <button
                className={`toggle mute ${t.mute ? 'on' : ''}`}
                title="Mute"
                onClick={toggle(t.id, 'mute', 'Mute')}
              >
                M
              </button>
              <button
                className={`toggle solo ${t.solo ? 'on' : ''}`}
                title="Solo"
                onClick={toggle(t.id, 'solo', 'Solo')}
              >
                S
              </button>
              <button
                className={`toggle arm ${t.armed ? 'on' : ''}`}
                title="Arm for recording (Ctrl+click to arm several). Live input plays through the armed track."
                onClick={toggle(t.id, 'armed', 'Arm track')}
              >
                ●
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="inspector">
        <div className="row">
          <span>Output</span>
          <select
            value={selected.output}
            onChange={(e) => updateTrack(selected.id, 'Change output', { output: e.target.value })}
          >
            <option value="internal">Built-in synth</option>
            {outputs.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
                {o.connected ? '' : ' (disconnected)'}
              </option>
            ))}
            {selected.output !== 'internal' && !outputs.some((o) => o.name === selected.output) && (
              <option value={selected.output}>{selected.output} (not connected)</option>
            )}
          </select>
        </div>
        {outputMissing && (
          <div className="hint" style={{ color: 'var(--warn)' }}>
            This output is not connected — plug the device in or choose another output.
          </div>
        )}
        <div className="row">
          <span>Channel</span>
          <select
            value={selected.channel}
            onChange={(e) => updateTrack(selected.id, 'Change channel', { channel: Number(e.target.value) })}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>
                {i + 1}
                {i === 9 ? ' (drums)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span>Instrument</span>
          <select
            value={selected.program}
            onChange={(e) =>
              updateTrack(selected.id, 'Change instrument', { program: Number(e.target.value) })
            }
          >
            {GM_PROGRAMS.map((name, i) => (
              <option key={i} value={i}>
                {i + 1}. {name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={127}
            value={selected.volume}
            title={String(selected.volume)}
            onChange={(e) => updateTrack(selected.id, 'Track volume', { volume: Number(e.target.value) })}
          />
        </div>
        <div className="row">
          <span>Pan</span>
          <input
            type="range"
            min={0}
            max={127}
            value={selected.pan}
            title={
              selected.pan === 64
                ? 'Center'
                : selected.pan < 64
                  ? `L ${64 - selected.pan}`
                  : `R ${selected.pan - 64}`
            }
            onChange={(e) => updateTrack(selected.id, 'Track pan', { pan: Number(e.target.value) })}
            onDoubleClick={() => updateTrack(selected.id, 'Track pan', { pan: 64 })}
          />
        </div>
        <div className="row">
          <span>Color</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {TRACK_COLORS.map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => updateTrack(selected.id, 'Track color', { color: c })}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: c === selected.color ? '2px solid var(--text)' : '1px solid var(--border)',
                  background: c,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
