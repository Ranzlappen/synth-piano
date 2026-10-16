import { useEffect, useRef, useState } from 'react';
import { CC, CC_NAMES, CHORD_TYPES, chordLabel, GM_PROGRAMS, PITCH_CLASS_NAMES } from '@core/music';
import type { VelocityCurve } from '@core/midi/messages';
import { engine } from '../../engine/engine';
import { playChordPad } from '../../hooks/useKeyboard';
import { useProject } from '../../state/project';
import { useSettings, type KnobConfig } from '../../state/settings';
import { VirtualKeyboard } from './VirtualKeyboard';

const send = (controller: number, value: number) =>
  engine.liveInput({ type: 'cc', channel: 0, controller, value: Math.round(value) }, 'screen');

/** Vertical wheel; `spring` returns to the centre on release (pitch bend). */
function Wheel({
  label,
  spring,
  onValue,
}: {
  label: string;
  spring: boolean;
  onValue: (v: number) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(spring ? 0.5 : 0);
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const v = 1 - Math.min(1, Math.max(0, (clientY - rect.top - 7) / (rect.height - 14)));
    setValue(v);
    onValue(v);
  };
  return (
    <div className="wheel">
      <div
        className="track-v"
        ref={ref}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          set(e.clientY);
        }}
        onPointerMove={(e) => e.buttons && set(e.clientY)}
        onPointerUp={() => {
          if (spring) {
            setValue(0.5);
            onValue(0.5);
          }
        }}
        onDoubleClick={() => {
          const v = spring ? 0.5 : 0;
          setValue(v);
          onValue(v);
        }}
      >
        {spring && <div className="center-line" />}
        <div className="thumb" style={{ top: `calc(${(1 - value) * 100}% - ${(1 - value) * 14}px)` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function Knob({ config, index }: { config: KnobConfig; index: number }): React.JSX.Element {
  const [value, setValue] = useState(
    config.cc === CC.PAN ? 64 : config.cc === CC.VOLUME || config.cc === CC.EXPRESSION ? 100 : 0,
  );
  const drag = useRef<{ y: number; v: number } | null>(null);
  const update = (v: number) => {
    const nv = Math.max(0, Math.min(127, Math.round(v)));
    if (nv === value) return;
    setValue(nv);
    send(config.cc, nv);
  };
  const angle = -135 + (value / 127) * 270;
  const r = 15;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [20 + r * Math.sin((a * Math.PI) / 180), 20 - r * Math.cos((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const knobs = useSettings((s) => s.knobs);
  return (
    <div
      className="knob"
      title={`${CC_NAMES[config.cc] ?? `CC ${config.cc}`}: ${value} — drag up/down, double-click to reset`}
    >
      <svg
        width={40}
        height={40}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          update(drag.current.v + (drag.current.y - e.clientY) * (e.shiftKey ? 0.2 : 0.8));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => update(config.cc === CC.PAN ? 64 : 0)}
        onWheel={(e) => update(value - Math.sign(e.deltaY) * 4)}
      >
        <path d={arc(-135, 135)} stroke="var(--panel-3)" strokeWidth={4} fill="none" strokeLinecap="round" />
        {value > 0 && (
          <path
            d={arc(-135, angle)}
            stroke="var(--accent)"
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        )}
        <circle cx={20} cy={20} r={9} fill="var(--panel-2)" stroke="var(--border-strong)" />
        <line
          x1={20}
          y1={20}
          x2={20 + 8 * Math.sin((angle * Math.PI) / 180)}
          y2={20 - 8 * Math.cos((angle * Math.PI) / 180)}
          stroke="var(--text)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
      <select
        value={config.cc}
        title="Controller number"
        onChange={(e) => {
          const cc = Number(e.target.value);
          const next = knobs.map((k, i) => (i === index ? { cc, label: CC_NAMES[cc] ?? `CC${cc}` } : k));
          useSettings.getState().update({ knobs: next });
        }}
      >
        {Array.from({ length: 120 }, (_, cc) => (
          <option key={cc} value={cc}>
            {cc === config.cc ? config.label : (CC_NAMES[cc] ?? `CC ${cc}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Pedal({
  label,
  sub,
  controller,
}: {
  label: string;
  sub: string;
  controller: number;
}): React.JSX.Element {
  const [down, setDown] = useState(false);
  const [latched, setLatched] = useState(false);
  const press = (v: boolean) => {
    setDown(v);
    send(controller, v ? 127 : 0);
  };
  return (
    <button
      className={`pedal ${down ? 'down' : ''}`}
      title={`${label}: hold to press. Double-click to latch.`}
      onPointerDown={(e) => {
        if (latched) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        press(true);
      }}
      onPointerUp={() => !latched && press(false)}
      onPointerCancel={() => !latched && press(false)}
      onDoubleClick={() => {
        const l = !latched;
        setLatched(l);
        press(l);
      }}
    >
      <b>{label}</b>
      <span className="muted">{latched ? 'latched' : sub}</span>
    </button>
  );
}

function ChordPad({ index }: { index: number }): React.JSX.Element {
  const pad = useSettings((s) => s.chordPads[index]);
  const pads = useSettings((s) => s.chordPads);
  const [down, setDown] = useState(false);
  const update = (patch: Partial<typeof pad>) =>
    useSettings.getState().update({ chordPads: pads.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  return (
    <div className="chord-pad">
      <button
        className={down ? 'down' : ''}
        title={`Chord pad ${index + 1} (key ${index + 1} while typing)`}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDown(true);
          playChordPad(index, true);
        }}
        onPointerUp={() => {
          setDown(false);
          playChordPad(index, false);
        }}
        onPointerCancel={() => {
          setDown(false);
          playChordPad(index, false);
        }}
      >
        {chordLabel(pad.root, pad.type)}
      </button>
      <div className="cfg">
        <select
          value={pad.root % 12}
          title="Root"
          onChange={(e) => update({ root: 48 + Number(e.target.value) + (pad.root >= 60 ? 12 : 0) })}
        >
          {PITCH_CLASS_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select value={pad.type} title="Chord type" onChange={(e) => update({ type: e.target.value })}>
          {CHORD_TYPES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ControllerPanel(): React.JSX.Element {
  const [tab, setTab] = useState<'pedals' | 'knobs' | 'chords'>('pedals');
  const curve = useSettings((s) => s.velocityCurve);
  const fixed = useSettings((s) => s.fixedVelocity);
  const target = useProject(
    (s) =>
      s.project.tracks.find((t) => t.armed) ??
      s.project.tracks.find((t) => t.id === s.selectedTrackId) ??
      s.project.tracks[0],
  );
  const knobs = useSettings((s) => s.knobs);
  const lastBend = useRef(0);

  useEffect(() => () => send(CC.SUSTAIN, 0), []);

  return (
    <section className="controller" aria-label="MIDI controller">
      <div className="wheels">
        <Wheel
          label="Pitch"
          spring
          onValue={(v) => {
            const value = Math.round((v - 0.5) * 2 * 8191);
            if (value === lastBend.current) return;
            lastBend.current = value;
            engine.liveInput({ type: 'pitchBend', channel: 0, value }, 'screen');
          }}
        />
        <Wheel label="Mod" spring={false} onValue={(v) => send(CC.MODULATION, v * 127)} />
      </div>
      <div className="keyboard-wrap">
        <div className="keyboard-bar">
          <span>
            Playing <b style={{ color: 'var(--text)' }}>{target.name}</b> · Ch {target.channel + 1} ·{' '}
            {target.output === 'internal' ? 'built-in synth' : target.output}
          </span>
          <span style={{ flex: 1 }} />
          <label className="check" title="Instrument of the track you are playing">
            <select
              value={target.program}
              onChange={(e) =>
                useProject.getState().commit('Change instrument', (d) => {
                  const t = d.tracks.find((x) => x.id === target.id);
                  if (t) t.program = Number(e.target.value);
                })
              }
            >
              {GM_PROGRAMS.map((n, i) => (
                <option key={i} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="check" title="Velocity response of the on-screen and computer keyboard">
            Velocity
            <select
              value={curve}
              onChange={(e) =>
                useSettings.getState().update({ velocityCurve: e.target.value as VelocityCurve })
              }
            >
              <option value="linear">Linear</option>
              <option value="soft">Soft (easier loud)</option>
              <option value="hard">Hard</option>
              <option value="fixed">Fixed</option>
            </select>
            {curve === 'fixed' && (
              <input
                type="number"
                min={1}
                max={127}
                value={fixed}
                style={{ width: 52, height: 22 }}
                onChange={(e) => useSettings.getState().update({ fixedVelocity: Number(e.target.value) })}
              />
            )}
          </label>
        </div>
        <VirtualKeyboard />
      </div>
      <div className="side-panel">
        <div className="tabs">
          <button className={tab === 'pedals' ? 'active' : ''} onClick={() => setTab('pedals')}>
            Pedals
          </button>
          <button className={tab === 'knobs' ? 'active' : ''} onClick={() => setTab('knobs')}>
            Knobs
          </button>
          <button className={tab === 'chords' ? 'active' : ''} onClick={() => setTab('chords')}>
            Chord pads
          </button>
        </div>
        {tab === 'pedals' && (
          <>
            <div className="pedals">
              <Pedal label="Sustain" sub="CC 64" controller={CC.SUSTAIN} />
              <Pedal label="Sostenuto" sub="CC 66" controller={CC.SOSTENUTO} />
              <Pedal label="Soft" sub="CC 67" controller={CC.SOFT} />
            </div>
            <div className="hint">
              Pedals, wheels and knobs are recorded together with the notes. With musical typing on,{' '}
              <span className="kbd">Tab</span> is the sustain pedal.
            </div>
          </>
        )}
        {tab === 'knobs' && (
          <div className="knobs">
            {knobs.map((k, i) => (
              <Knob key={`${i}-${k.cc}`} config={k} index={i} />
            ))}
          </div>
        )}
        {tab === 'chords' && (
          <div className="chords">
            {Array.from({ length: 8 }, (_, i) => (
              <ChordPad key={i} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
