import { useEffect, useMemo, useRef } from 'react';
import { createControl, sortControls, type ControlEvent } from '@core/model';
import { CC_NAMES } from '@core/music';
import { selectedTrack, useProject } from '../../state/project';
import { gridTicksFor, useUi, type LaneKind } from '../../state/ui';
import { prepareCanvas, readTheme, tickToX, xToTick, type View } from './draw';

interface Props {
  viewRef: React.RefObject<View>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  token: number;
  keysWidth: number;
}

const LANES: { key: string; label: string; kind: LaneKind }[] = [
  { key: 'velocity', label: 'Velocity', kind: { type: 'velocity' } },
  { key: 'cc64', label: 'Sustain pedal', kind: { type: 'cc', controller: 64 } },
  { key: 'cc67', label: 'Soft pedal', kind: { type: 'cc', controller: 67 } },
  { key: 'cc66', label: 'Sostenuto', kind: { type: 'cc', controller: 66 } },
  { key: 'cc11', label: 'Expression', kind: { type: 'cc', controller: 11 } },
  { key: 'cc1', label: 'Modulation', kind: { type: 'cc', controller: 1 } },
  { key: 'cc7', label: 'Volume', kind: { type: 'cc', controller: 7 } },
  { key: 'cc10', label: 'Pan', kind: { type: 'cc', controller: 10 } },
  { key: 'cc2', label: 'Breath', kind: { type: 'cc', controller: 2 } },
  { key: 'pb', label: 'Pitch bend', kind: { type: 'pitchBend' } },
  { key: 'at', label: 'Aftertouch', kind: { type: 'channelPressure' } },
];

export const laneKey = (k: LaneKind): string =>
  k.type === 'velocity'
    ? 'velocity'
    : k.type === 'cc'
      ? `cc${k.controller}`
      : k.type === 'pitchBend'
        ? 'pb'
        : 'at';

const matches =
  (k: LaneKind) =>
  (c: ControlEvent): boolean =>
    k.type === 'cc'
      ? c.kind === 'cc' && c.controller === k.controller
      : k.type === 'pitchBend'
        ? c.kind === 'pitchBend'
        : k.type === 'channelPressure' && c.kind === 'channelPressure';

const range = (k: LaneKind): [number, number] => (k.type === 'pitchBend' ? [-8192, 8191] : [0, 127]);

type LaneDrag =
  | {
      kind: 'velocity';
      line: boolean;
      startTick: number;
      startValue: number;
      lastTick: number;
      changes: Map<string, number>;
    }
  | {
      kind: 'paint';
      line: boolean;
      erase: boolean;
      startTick: number;
      startValue: number;
      lastTick: number;
      lastValue: number;
      painted: Map<number, number>;
      t0: number;
      t1: number;
    };

export function ControllerLane({ viewRef, scrollRef, token, keysWidth }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<LaneDrag | null>(null);
  const lane = useUi((s) => s.lane);
  const height = useUi((s) => s.laneHeight);
  const revision = useProject((s) => s.revision);
  const trackId = useProject((s) => s.selectedTrackId);
  const track = useProject(
    (s) => s.project.tracks.find((t) => t.id === s.selectedTrackId) ?? s.project.tracks[0],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of track.controls) {
      const key =
        c.kind === 'cc'
          ? `cc${c.controller}`
          : c.kind === 'pitchBend'
            ? 'pb'
            : c.kind === 'channelPressure'
              ? 'at'
              : '';
      if (key) m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [track.controls]);

  const extraCcs = useMemo(
    () =>
      [...counts.keys()]
        .filter((k) => /^cc\d+$/.test(k) && !LANES.some((l) => l.key === k))
        .map((k) => Number(k.slice(2))),
    [counts],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = viewRef.current;
    if (!canvas || !v) return;
    const t = readTheme();
    const h = height;
    const ctx = prepareCanvas(canvas, v.width, h);
    ctx.fillStyle = t.gridBg;
    ctx.fillRect(0, 0, v.width, h);
    ctx.fillStyle = t.line;
    for (const f of [0.25, 0.5, 0.75]) ctx.fillRect(0, Math.round(4 + (h - 8) * f), v.width, 1);
    const trk = selectedTrack();
    const sel = useProject.getState().selection;
    const csel = useProject.getState().controlSelection;
    const [lo, hi] = range(lane);
    const yOf = (value: number) => 4 + (h - 8) * (1 - (value - lo) / (hi - lo));
    if (lane.type === 'velocity') {
      for (const n of trk.notes) {
        const x = tickToX(v, n.tick);
        if (x < -4 || x > v.width + 4) continue;
        const y = yOf(n.velocity);
        const selected = sel.has(n.id);
        ctx.fillStyle = selected ? t.accent : trk.color;
        ctx.globalAlpha = selected || sel.size === 0 ? 1 : 0.45;
        ctx.fillRect(Math.round(x), y, 2, h - 4 - y);
        ctx.beginPath();
        ctx.arc(Math.round(x) + 1, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }
    const isMatch = matches(lane);
    const events = trk.controls.filter(isMatch);
    if (lane.type === 'pitchBend') {
      ctx.fillStyle = t.beat;
      ctx.fillRect(0, Math.round(yOf(0)), v.width, 1);
    }
    if (lane.type === 'cc' && [64, 66, 67].includes(lane.controller)) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = t.muted;
      ctx.beginPath();
      ctx.moveTo(0, yOf(64) + 0.5);
      ctx.lineTo(v.width, yOf(64) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const t0 = xToTick(v, 0);
    let value =
      lane.type === 'pitchBend'
        ? 0
        : lane.type === 'cc' && lane.controller === 7
          ? trk.volume
          : lane.type === 'cc' && lane.controller === 10
            ? trk.pan
            : lane.type === 'cc' && lane.controller === 11
              ? 127
              : 0;
    let i = 0;
    for (; i < events.length && events[i].tick <= t0; i++) value = events[i].value;
    ctx.beginPath();
    ctx.moveTo(0, yOf(value));
    const pts: { x: number; y: number; selected: boolean }[] = [];
    for (; i < events.length; i++) {
      const e = events[i];
      const x = tickToX(v, e.tick);
      if (x > v.width) break;
      ctx.lineTo(x, yOf(value));
      value = e.value;
      ctx.lineTo(x, yOf(value));
      pts.push({ x, y: yOf(value), selected: csel.has(e.id) });
    }
    ctx.lineTo(v.width, yOf(value));
    ctx.strokeStyle = trk.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(v.width, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = trk.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (pts.length < v.width / 4) {
      for (const p of pts) {
        ctx.fillStyle = p.selected ? '#fff' : trk.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [token, lane, height, revision, trackId, viewRef]);

  // Horizontal wheel scrolling follows the piano roll.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = scrollRef.current;
      if (!s) return;
      e.preventDefault();
      s.scrollLeft += e.deltaX || e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef]);

  const valueAt = (y: number): number => {
    const [lo, hi] = range(lane);
    const f = 1 - (y - 4) / (height - 8);
    let v = Math.round(lo + Math.min(1, Math.max(0, f)) * (hi - lo));
    if (lane.type === 'cc' && [64, 66, 67].includes(lane.controller) && useUi.getState().snap)
      v = v >= 64 ? 127 : 0;
    if (lane.type === 'velocity') v = Math.max(1, v);
    return v;
  };

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const resolution = () => Math.max(10, gridTicksFor(useUi.getState().grid) / 4);

  const apply = () => {
    const d = dragRef.current;
    if (!d) return;
    const proj = useProject.getState();
    const id = proj.selectedTrackId;
    if (d.kind === 'velocity') {
      proj.updateGesture((draft) => {
        const t = draft.tracks.find((x) => x.id === id)!;
        t.notes = t.notes.map((n) => (d.changes.has(n.id) ? { ...n, velocity: d.changes.get(n.id)! } : n));
      });
      return;
    }
    const isMatch = matches(lane);
    proj.updateGesture((draft) => {
      const t = draft.tracks.find((x) => x.id === id)!;
      const kept = t.controls.filter((c) => !(isMatch(c) && c.tick >= d.t0 && c.tick <= d.t1));
      if (d.erase) {
        t.controls = kept;
        return;
      }
      const added = [...d.painted.entries()].map(([tick, value]) =>
        lane.type === 'cc'
          ? createControl({ tick, kind: 'cc', controller: lane.controller, value })
          : createControl({ tick, kind: lane.type === 'pitchBend' ? 'pitchBend' : 'channelPressure', value }),
      );
      // Drop consecutive duplicates so painted data stays compact.
      const dedup = added
        .sort((a, b) => a.tick - b.tick)
        .filter((c, i, arr) => i === 0 || arr[i - 1].value !== c.value);
      t.controls = sortControls([...kept, ...dedup]);
    });
  };

  const onDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!v) return;
    const { x, y } = pos(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tick = Math.max(0, xToTick(v, x));
    const value = valueAt(y);
    useProject.getState().beginGesture();
    if (lane.type === 'velocity') {
      dragRef.current = {
        kind: 'velocity',
        line: e.shiftKey,
        startTick: tick,
        startValue: value,
        lastTick: tick,
        changes: new Map(),
      };
      sweepVelocity(tick, tick, value, value);
    } else {
      const erase = e.button === 2 || useUi.getState().tool === 'erase' || e.altKey;
      const res = resolution();
      const t0 = Math.round(tick / res) * res;
      dragRef.current = {
        kind: 'paint',
        line: e.shiftKey,
        erase,
        startTick: t0,
        startValue: value,
        lastTick: t0,
        lastValue: value,
        painted: new Map([[t0, value]]),
        t0,
        t1: t0,
      };
    }
    apply();
  };

  const sweepVelocity = (from: number, to: number, vFrom: number, vTo: number) => {
    const d = dragRef.current;
    if (d?.kind !== 'velocity') return;
    const v = viewRef.current!;
    const sel = useProject.getState().selection;
    const tol = 3 / v.pxPerTick;
    const lo = Math.min(from, to) - tol;
    const hi = Math.max(from, to) + tol;
    for (const n of selectedTrack().notes) {
      if (n.tick < lo || n.tick > hi) continue;
      if (sel.size && !sel.has(n.id)) continue;
      const f = to === from ? 1 : (n.tick - from) / (to - from);
      d.changes.set(
        n.id,
        Math.max(1, Math.min(127, Math.round(vFrom + (vTo - vFrom) * Math.min(1, Math.max(0, f))))),
      );
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const v = viewRef.current;
    if (!d || !v) return;
    const { x, y } = pos(e);
    const tick = Math.max(0, xToTick(v, x));
    const value = valueAt(y);
    if (d.kind === 'velocity') {
      if (d.line) {
        d.changes.clear();
        sweepVelocity(d.startTick, tick, d.startValue, value);
      } else {
        sweepVelocity(d.lastTick, tick, value, value);
      }
      d.lastTick = tick;
    } else {
      const res = resolution();
      const t = Math.round(tick / res) * res;
      if (d.line) {
        d.painted.clear();
        d.t0 = Math.min(d.startTick, t);
        d.t1 = Math.max(d.startTick, t);
        for (let k = d.t0; k <= d.t1; k += res) {
          const f = d.t1 === d.t0 ? 1 : (k - d.startTick) / (t - d.startTick);
          d.painted.set(k, Math.round(d.startValue + (value - d.startValue) * f));
        }
      } else {
        const a = Math.min(d.lastTick, t);
        const b = Math.max(d.lastTick, t);
        for (let k = a; k <= b; k += res) {
          const f = b === a ? 1 : (k - d.lastTick) / (t - d.lastTick);
          d.painted.set(k, Math.round(d.lastValue + (value - d.lastValue) * f));
        }
        d.t0 = Math.min(d.t0, a);
        d.t1 = Math.max(d.t1, b);
        d.lastTick = t;
        d.lastValue = value;
      }
    }
    apply();
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    useProject.getState().endGesture(d.kind === 'velocity' ? 'Edit velocity' : 'Edit controller');
  };

  // Lane height drag.
  const onResizeDown = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startH = useUi.getState().laneHeight;
    const move = (ev: PointerEvent) =>
      useUi.getState().set({ laneHeight: Math.min(420, Math.max(50, startH - (ev.clientY - startY))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const current = laneKey(lane);
  return (
    <div className="lanes" style={{ height }} ref={wrapRef}>
      <div className="lane-resize" onPointerDown={onResizeDown} />
      <div className="lane-head" style={{ width: keysWidth }}>
        <select
          value={current}
          title="Controller lane"
          onChange={(e) => {
            const k = e.target.value;
            const preset = LANES.find((l) => l.key === k);
            useUi
              .getState()
              .set({ lane: preset ? preset.kind : { type: 'cc', controller: Number(k.slice(2)) } });
          }}
        >
          {LANES.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
              {counts.get(l.key) ? ` •${counts.get(l.key)}` : ''}
            </option>
          ))}
          {extraCcs.map((cc) => (
            <option key={cc} value={`cc${cc}`}>
              {CC_NAMES[cc] ?? `CC ${cc}`} •{counts.get(`cc${cc}`)}
            </option>
          ))}
          {lane.type === 'cc' &&
            !LANES.some((l) => l.key === current) &&
            !extraCcs.includes(lane.controller) && <option value={current}>CC {lane.controller}</option>}
        </select>
        <input
          type="number"
          min={0}
          max={127}
          title="Show any controller number"
          placeholder="CC#"
          style={{ width: '100%', height: 22, fontSize: 11 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Number((e.target as HTMLInputElement).value);
              if (n >= 0 && n <= 127) useUi.getState().set({ lane: { type: 'cc', controller: n } });
            }
          }}
        />
        <span className="muted" style={{ fontSize: 10, lineHeight: 1.2 }}>
          {lane.type === 'velocity'
            ? 'Drag to paint · Shift = ramp'
            : 'Drag to draw · Shift = line · Right-drag = erase'}
        </span>
      </div>
      <div style={{ position: 'relative', minWidth: 0, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          data-testid="controller-lane"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: 'crosshair' }}
        />
      </div>
    </div>
  );
}
