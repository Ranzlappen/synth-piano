import { useEffect, useMemo, useRef } from 'react';
import { Activity, Cable, Volume2 } from 'lucide-react';
import { readLevel } from '../engine/audio';
import { engine } from '../engine/engine';
import { useProject } from '../state/project';
import { useTransport, useMidi } from '../state/transport';
import { useUi } from '../state/ui';
import { noteName } from '@core/music';

export function StatusBar(): React.JSX.Element {
  const ledRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const voicesRef = useRef<HTMLSpanElement>(null);
  const allInputs = useMidi((s) => s.inputs);
  const inputs = useMemo(() => allInputs.filter((i) => i.connected), [allInputs]);
  const status = useMidi((s) => s.status);
  const selection = useProject((s) => s.selection);
  const track = useProject((s) => s.project.tracks.find((t) => t.id === s.selectedTrackId));
  const recording = useTransport((s) => s.recording);
  const typing = useUi((s) => s.musicalTyping);
  const dirty = useProject((s) => s.dirty);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const recent = performance.now() - useMidi.getState().lastActivity < 120;
      ledRef.current?.classList.toggle('on', recent);
      const level = Math.min(1, readLevel());
      if (meterRef.current) meterRef.current.style.width = `${Math.round(level * 100)}%`;
      if (voicesRef.current) voicesRef.current.textContent = String(engine.activeVoices());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const selected = track?.notes.filter((n) => selection.has(n.id)) ?? [];
  const selInfo = selected.length
    ? `${selected.length} note${selected.length === 1 ? '' : 's'} selected · ${noteName(Math.min(...selected.map((n) => n.pitch)))}–${noteName(
        Math.max(...selected.map((n) => n.pitch)),
      )} · velocity ${Math.min(...selected.map((n) => n.velocity))}–${Math.max(...selected.map((n) => n.velocity))}`
    : `${track?.notes.length ?? 0} notes in ${track?.name ?? ''}`;

  return (
    <footer className="statusbar">
      <span className="item" title="MIDI input activity">
        <span className="led" ref={ledRef} />
        <Cable />
        {status === 'ready'
          ? inputs.length
            ? inputs.map((i) => i.name).join(', ')
            : 'No MIDI input connected'
          : status === 'unsupported'
            ? 'Web MIDI unavailable'
            : status === 'denied'
              ? 'MIDI access denied'
              : status === 'error'
                ? 'MIDI not responding — see MIDI devices'
                : 'Connecting MIDI…'}
      </span>
      {recording && (
        <span className="item" style={{ color: 'var(--rec)', fontWeight: 600 }}>
          ● Recording
        </span>
      )}
      {typing && <span className="item">⌨ Musical typing on</span>}
      <span className="item">{selInfo}</span>
      <span style={{ flex: 1 }} />
      {dirty && <span className="item">Unsaved changes</span>}
      <span className="item" title="Sounding voices of the built-in synth">
        <Activity />
        <span ref={voicesRef}>0</span>
      </span>
      <span className="item" title="Output level">
        <Volume2 />
        <div className="meter">
          <div ref={meterRef} style={{ width: 0 }} />
        </div>
      </span>
    </footer>
  );
}
