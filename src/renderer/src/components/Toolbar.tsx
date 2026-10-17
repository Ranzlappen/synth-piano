import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Circle,
  Eraser,
  FilePlus,
  FileMusic,
  FolderOpen,
  History,
  Keyboard,
  Magnet,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Redo2,
  Repeat,
  Save,
  Scissors,
  Settings,
  SkipBack,
  Square,
  Timer,
  Usb,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { GRID_OPTIONS, formatClock, formatPosition } from '@core/timing';
import { engine } from '../engine/engine';
import { runCommand } from '../commands';
import { useProject } from '../state/project';
import { useSettings } from '../state/settings';
import { useTransport, useMidi } from '../state/transport';
import { useUi, type Tool } from '../state/ui';

function PositionDisplay(): React.JSX.Element {
  const bigRef = useRef<HTMLDivElement>(null);
  const smallRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const tick = engine.currentTick();
      const pos = tick < 0 ? 'count-in' : formatPosition(engine.meter.position(Math.max(0, tick)));
      const time = formatClock(engine.tempo.tickToSeconds(tick));
      const key = pos + time;
      if (key === last) return;
      last = key;
      if (bigRef.current) bigRef.current.textContent = pos;
      if (smallRef.current) smallRef.current.textContent = time;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="lcd" title="Position (bar.beat.tick) and time">
      <div className="big" ref={bigRef} data-testid="position">
        1.1.000
      </div>
      <div className="small" ref={smallRef}>
        0:00.000
      </div>
    </div>
  );
}

function TempoField(): React.JSX.Element {
  const tempos = useProject((s) => s.project.tempos);
  const sig = useProject((s) => s.project.timeSignatures[0]);
  const [text, setText] = useState(String(tempos[0].bpm));
  useEffect(() => setText(String(Math.round(tempos[0].bpm * 100) / 100)), [tempos]);
  const commitTempo = () => {
    const bpm = Number(text);
    if (!Number.isFinite(bpm) || bpm < 10 || bpm > 999) {
      setText(String(tempos[0].bpm));
      return;
    }
    if (bpm === tempos[0].bpm) return;
    const playing = engine.isPlaying();
    const at = engine.currentTick();
    useProject.getState().commit('Change tempo', (d) => {
      if (d.tempos.length === 1) d.tempos[0].bpm = bpm;
      else {
        // Scale the whole tempo map so relative changes are kept.
        const factor = bpm / d.tempos[0].bpm;
        for (const t of d.tempos) t.bpm = Math.round(t.bpm * factor * 100) / 100;
      }
    });
    if (playing && !engine.isRecording()) engine.seek(at);
  };
  const setSig = (numerator: number, denominator: number) =>
    useProject.getState().commit('Change time signature', (d) => {
      d.timeSignatures[0] = { tick: 0, numerator, denominator };
    });
  return (
    <div className="tempo-field">
      <input
        type="number"
        value={text}
        min={10}
        max={999}
        step={1}
        title={
          tempos.length > 1
            ? 'Tempo (the project contains tempo changes; editing scales them all)'
            : 'Tempo (BPM)'
        }
        onChange={(e) => setText(e.target.value)}
        onBlur={commitTempo}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="muted">BPM{tempos.length > 1 ? '*' : ''}</span>
      <select
        value={`${sig.numerator}/${sig.denominator}`}
        title="Time signature"
        onChange={(e) => {
          const [n, d] = e.target.value.split('/').map(Number);
          setSig(n, d);
        }}
      >
        {[
          '2/4',
          '3/4',
          '4/4',
          '5/4',
          '6/4',
          '7/4',
          '2/2',
          '3/2',
          '3/8',
          '5/8',
          '6/8',
          '7/8',
          '9/8',
          '12/8',
        ].map((s) => (
          <option key={s}>{s}</option>
        ))}
        {![
          '2/4',
          '3/4',
          '4/4',
          '5/4',
          '6/4',
          '7/4',
          '2/2',
          '3/2',
          '3/8',
          '5/8',
          '6/8',
          '7/8',
          '9/8',
          '12/8',
        ].includes(`${sig.numerator}/${sig.denominator}`) && (
          <option>{`${sig.numerator}/${sig.denominator}`}</option>
        )}
      </select>
    </div>
  );
}

function RecordOptions(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const recordMode = useSettings((s) => s.recordMode);
  const countIn = useSettings((s) => s.countInBars);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const update = useSettings.getState().update;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn icon"
        style={{ width: 18 }}
        title="Recording options"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown />
      </button>
      {open && (
        <div className="popover">
          <div className="section-title">Recording mode</div>
          {(['overdub', 'replace'] as const).map((m) => (
            <label key={m} className="check">
              <input type="radio" checked={recordMode === m} onChange={() => update({ recordMode: m })} />
              {m === 'overdub' ? 'Overdub — add to existing notes' : 'Replace — overwrite the recorded range'}
            </label>
          ))}
          <div className="section-title">Count-in</div>
          {[0, 1, 2].map((n) => (
            <label key={n} className="check">
              <input type="radio" checked={countIn === n} onChange={() => update({ countInBars: n })} />
              {n === 0 ? 'None' : `${n} bar${n > 1 ? 's' : ''}`}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLS: { id: Tool; icon: typeof Pencil; label: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select / move (1)' },
  { id: 'draw', icon: Pencil, label: 'Draw notes (2)' },
  { id: 'erase', icon: Eraser, label: 'Erase (3)' },
  { id: 'split', icon: Scissors, label: 'Split notes (4)' },
];

export function Toolbar(): React.JSX.Element {
  const playing = useTransport((s) => s.playing);
  const recording = useTransport((s) => s.recording);
  const countingIn = useTransport((s) => s.countingIn);
  const loop = useProject((s) => s.project.loop.enabled);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const undoLabel = useProject((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useProject((s) => s.future[0]?.label);
  const metronome = useSettings((s) => s.metronome);
  const recordMode = useSettings((s) => s.recordMode);
  const countIn = useSettings((s) => s.countInBars);
  const tool = useUi((s) => s.tool);
  const snap = useUi((s) => s.snap);
  const grid = useUi((s) => s.grid);
  const typing = useUi((s) => s.musicalTyping);
  const typingOctave = useUi((s) => s.typingOctave);
  const midiInputs = useMidi((s) => s.inputs.filter((i) => i.connected).length);
  const midiStatus = useMidi((s) => s.status);

  return (
    <div className="toolbar" role="toolbar">
      <div className="group">
        <button className="btn icon" title="New project (Ctrl+N)" onClick={() => runCommand('file:new')}>
          <FilePlus />
        </button>
        <button
          className="btn icon"
          title="Open project or MIDI file (Ctrl+O)"
          onClick={() => runCommand('file:open')}
        >
          <FolderOpen />
        </button>
        <button className="btn icon" title="Save (Ctrl+S)" onClick={() => runCommand('file:save')}>
          <Save />
        </button>
        <button
          className="btn icon"
          disabled={!canUndo}
          title={`Undo ${undoLabel ?? ''} (Ctrl+Z)`}
          onClick={() => runCommand('edit:undo')}
        >
          <Redo2 style={{ transform: 'scaleX(-1)' }} />
        </button>
        <button
          className="btn icon"
          disabled={!canRedo}
          title={`Redo ${redoLabel ?? ''} (Ctrl+Y)`}
          onClick={() => runCommand('edit:redo')}
        >
          <Redo2 />
        </button>
      </div>
      <div className="sep" />
      <div className="group">
        <button
          className="btn icon"
          title="Go to start (Home)"
          onClick={() => runCommand('transport:toStart')}
        >
          <SkipBack />
        </button>
        <button
          className={`btn icon ${playing && !recording ? 'active' : ''}`}
          title="Play / pause (Space)"
          data-testid="play"
          onClick={() => runCommand('transport:play')}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          className="btn icon"
          title="Stop and return (Enter)"
          onClick={() => runCommand('transport:stop')}
        >
          <Square />
        </button>
        <button
          className={`btn icon rec ${recording ? 'active' : ''}`}
          title={`Record (R) — ${recordMode === 'overdub' ? 'overdub' : 'replace'}, count-in ${countIn} bar(s)`}
          data-testid="record"
          onClick={() => runCommand('transport:record')}
        >
          <Circle fill={recording ? 'currentColor' : 'none'} />
        </button>
        <RecordOptions />
        <button
          className="btn icon"
          title="Capture what you just played without recording (Ctrl+Shift+R)"
          onClick={() => runCommand('transport:capture')}
        >
          <History />
        </button>
        <button
          className={`btn icon ${loop ? 'active' : ''}`}
          title="Loop (L) — Shift+drag in the ruler to set the range"
          onClick={() => runCommand('transport:loop')}
        >
          <Repeat />
        </button>
        <button
          className={`btn icon ${metronome ? 'active' : ''}`}
          title="Metronome (M)"
          onClick={() => runCommand('transport:metronome')}
        >
          <Timer />
        </button>
      </div>
      <div className="sep" />
      <PositionDisplay />
      {countingIn && <span style={{ color: 'var(--rec)', fontWeight: 600 }}>Count-in…</span>}
      <TempoField />
      <div className="sep" />
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`btn icon ${tool === t.id ? 'active' : ''}`}
            title={t.label}
            onClick={() => useUi.getState().set({ tool: t.id })}
          >
            <t.icon />
          </button>
        ))}
      </div>
      <div className="group">
        <button
          className={`btn icon ${snap ? 'active' : ''}`}
          title="Snap to grid (hold Shift while dragging to bypass)"
          onClick={() => useUi.getState().set({ snap: !snap })}
        >
          <Magnet />
        </button>
        <select
          title="Grid"
          value={grid}
          onChange={(e) => useUi.getState().set({ grid: Number(e.target.value) })}
          style={{ width: 70 }}
        >
          {GRID_OPTIONS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <button
          className="btn icon optional"
          title="Zoom out (Ctrl+-)"
          onClick={() => runCommand('view:zoomOut')}
        >
          <ZoomOut />
        </button>
        <button
          className="btn icon optional"
          title="Zoom in (Ctrl+=)"
          onClick={() => runCommand('view:zoomIn')}
        >
          <ZoomIn />
        </button>
      </div>
      <div className="sep" />
      <button
        className={`btn ${typing ? 'active' : ''}`}
        title="Play notes with the computer keyboard (Ctrl+K): A–L white keys, W E T Y U O P black keys, Z/X octave, C/V velocity, Tab sustain, 1–8 chord pads"
        onClick={() => useUi.getState().set({ musicalTyping: !typing })}
      >
        <Keyboard />
        {typing ? `C${typingOctave}` : <span className="optional">Typing</span>}
      </button>
      <div className="spacer" />
      <button
        className={`btn ${midiStatus === 'ready' && midiInputs > 0 ? '' : 'danger'}`}
        title={`MIDI devices (${midiInputs} input${midiInputs === 1 ? '' : 's'} connected)`}
        onClick={() => runCommand('midi:settings')}
      >
        <Usb />
        {midiStatus === 'ready' ? midiInputs : midiStatus === 'unsupported' ? 'n/a' : '…'}
      </button>
      <button
        className="btn primary"
        title="Export sheet music as PDF or MusicXML (Ctrl+P)"
        onClick={() => runCommand('file:exportSheet')}
        data-testid="export-sheet"
      >
        <FileMusic />
        Sheet Music
      </button>
      <button className="btn icon" title="Preferences (Ctrl+,)" onClick={() => runCommand('app:preferences')}>
        <Settings />
      </button>
    </div>
  );
}
