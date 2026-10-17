// Canvas drawing for the piano roll: grid, notes, ruler and the vertical keyboard.
import { inScale, isBlackKey, noteName } from '@core/music';
import type { MeterMap } from '@core/timing';
import type { LoopRange, Note } from '@core/model';

export interface View {
  pxPerTick: number;
  rowHeight: number;
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
}

export const tickToX = (v: View, tick: number): number => tick * v.pxPerTick - v.scrollLeft;
export const xToTick = (v: View, x: number): number => (x + v.scrollLeft) / v.pxPerTick;
export const pitchToY = (v: View, pitch: number): number => (127 - pitch) * v.rowHeight - v.scrollTop;
export const yToPitch = (v: View, y: number): number => 127 - Math.floor((y + v.scrollTop) / v.rowHeight);

export interface Theme {
  gridBg: string;
  gridBlack: string;
  line: string;
  beat: string;
  bar: string;
  text: string;
  muted: string;
  accent: string;
  panel: string;
  border: string;
  keyWhite: string;
  keyBlack: string;
  rec: string;
}

export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    gridBg: v('--grid-bg'),
    gridBlack: v('--grid-black'),
    line: v('--grid-line'),
    beat: v('--grid-beat'),
    bar: v('--grid-bar'),
    text: v('--text'),
    muted: v('--muted'),
    accent: v('--accent'),
    panel: v('--panel'),
    border: v('--border'),
    keyWhite: v('--key-white'),
    keyBlack: v('--key-black'),
    rec: v('--rec'),
  };
}

/** Sizes a canvas for the device pixel ratio and returns its 2D context in CSS pixels. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Smallest subdivision (ticks) whose lines are at least `minPx` apart. */
function visibleStep(v: View, ticksPerBeat: number, gridTicks: number, minPx: number): number {
  const candidates = [gridTicks, ticksPerBeat / 2, ticksPerBeat, ticksPerBeat * 2];
  for (const c of candidates) if (c * v.pxPerTick >= minPx) return c;
  return Infinity;
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  v: View,
  t: Theme,
  meter: MeterMap,
  gridTicks: number,
  loop: LoopRange,
  scale: { root: number; type: string },
): void {
  ctx.fillStyle = t.gridBg;
  ctx.fillRect(0, 0, v.width, v.height);
  const top = Math.min(127, yToPitch(v, 0));
  const bottom = Math.max(0, yToPitch(v, v.height));
  const scaled = scale.type !== 'chromatic';
  for (let p = bottom; p <= top; p++) {
    const y = pitchToY(v, p);
    if (isBlackKey(p) || (scaled && !inScale(p, scale.root, scale.type))) {
      ctx.fillStyle = t.gridBlack;
      ctx.fillRect(0, y, v.width, v.rowHeight);
    }
    if (p % 12 === 0) {
      ctx.fillStyle = t.beat;
      ctx.fillRect(0, y + v.rowHeight - 1, v.width, 1);
    } else if (p % 12 === 5) {
      ctx.fillStyle = t.line;
      ctx.fillRect(0, y + v.rowHeight - 1, v.width, 1);
    }
  }
  if (loop.enabled) {
    const x0 = tickToX(v, loop.start);
    const x1 = tickToX(v, loop.end);
    ctx.fillStyle = 'rgba(79,157,255,0.06)';
    ctx.fillRect(x0, 0, x1 - x0, v.height);
  }
  const t0 = Math.max(0, xToTick(v, 0));
  const t1 = xToTick(v, v.width);
  for (const bar of meter.barsInRange(t0, t1 + 1)) {
    const step = visibleStep(v, bar.ticksPerBeat, gridTicks, 7);
    if (Number.isFinite(step)) {
      for (let tick = bar.start + step; tick < bar.end - 0.5; tick += step) {
        const x = Math.round(tickToX(v, tick)) + 0.5;
        if (x < -1 || x > v.width + 1) continue;
        const onBeat = Math.abs((tick - bar.start) % bar.ticksPerBeat) < 0.5;
        ctx.fillStyle = onBeat ? t.beat : t.line;
        ctx.fillRect(x - 0.5, 0, 1, v.height);
      }
    }
    const x = Math.round(tickToX(v, bar.start));
    ctx.fillStyle = t.bar;
    ctx.fillRect(x, 0, 1, v.height);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawNotes(
  ctx: CanvasRenderingContext2D,
  v: View,
  t: Theme,
  notes: readonly Pick<Note, 'id' | 'pitch' | 'tick' | 'duration' | 'velocity'>[],
  color: string,
  opts: { selection?: ReadonlySet<string>; ghost?: boolean; labels?: boolean; recording?: boolean },
): void {
  const t0 = xToTick(v, 0);
  const t1 = xToTick(v, v.width);
  const top = yToPitch(v, 0);
  const bottom = yToPitch(v, v.height);
  const h = Math.max(2, v.rowHeight - 1);
  ctx.font = `${Math.min(11, v.rowHeight - 3)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'middle';
  for (const n of notes) {
    if (n.tick > t1) continue;
    if (n.tick + n.duration < t0 || n.pitch > top || n.pitch < bottom) continue;
    const x = tickToX(v, n.tick);
    const y = pitchToY(v, n.pitch);
    const w = Math.max(3, n.duration * v.pxPerTick - 1);
    if (opts.ghost) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.fillRect(x, y + 1, w, h - 1);
      ctx.globalAlpha = 1;
      continue;
    }
    const selected = opts.selection?.has(n.id) ?? false;
    ctx.globalAlpha = 0.5 + (0.5 * n.velocity) / 127;
    ctx.fillStyle = opts.recording ? t.rec : color;
    roundRect(ctx, x, y + 0.5, w, h, 2.5);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Velocity bar along the bottom edge.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + 1, y + h - 2, Math.max(1, (w - 2) * (n.velocity / 127)), 1.5);
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.45)';
    roundRect(ctx, x + 0.5, y + 1, w - 1, h - 1, 2.5);
    ctx.stroke();
    if (opts.labels && w > 30 && v.rowHeight >= 11) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(noteName(n.pitch), x + 4, y + h / 2 + 0.5);
    }
  }
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  v: View,
  t: Theme,
  meter: MeterMap,
  loop: LoopRange,
  height: number,
): void {
  ctx.fillStyle = t.panel;
  ctx.fillRect(0, 0, v.width, height);
  if (loop.enabled && loop.end > loop.start) {
    const x0 = tickToX(v, loop.start);
    const x1 = tickToX(v, loop.end);
    ctx.fillStyle = 'rgba(79,157,255,0.55)';
    ctx.fillRect(x0, 0, x1 - x0, 6);
  }
  ctx.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'middle';
  const t0 = Math.max(0, xToTick(v, 0));
  const t1 = xToTick(v, v.width);
  const bars = meter.barsInRange(t0, t1 + 1);
  const barPx = bars.length ? (bars[0].end - bars[0].start) * v.pxPerTick : 100;
  const labelEvery = barPx > 40 ? 1 : barPx > 18 ? 2 : barPx > 8 ? 4 : 8;
  const before = bars.length && bars[0].index > 0 ? meter.bar(bars[0].index - 1) : null;
  let lastSig = before ? `${before.numerator}/${before.denominator}` : '';
  for (const bar of bars) {
    const x = Math.round(tickToX(v, bar.start)) + 0.5;
    const n = bar.index + 1;
    ctx.fillStyle = t.muted;
    ctx.fillRect(x - 0.5, height * 0.45, 1, height * 0.55);
    if ((n - 1) % labelEvery === 0) {
      ctx.fillStyle = t.text;
      ctx.fillText(String(n), x + 4, height * 0.62);
    }
    const sig = `${bar.numerator}/${bar.denominator}`;
    if (sig !== lastSig && bar.index > 0 && barPx > 30) {
      ctx.fillStyle = t.accent;
      ctx.fillText(sig, x + 4 + ctx.measureText(String(n)).width + 6, height * 0.62);
    }
    lastSig = sig;
    if (bar.ticksPerBeat * v.pxPerTick > 10) {
      ctx.fillStyle = t.border;
      for (let b = 1; b < bar.numerator; b++) {
        const bx = Math.round(tickToX(v, bar.start + b * bar.ticksPerBeat)) + 0.5;
        ctx.fillRect(bx - 0.5, height * 0.75, 1, height * 0.25);
      }
    }
  }
  ctx.fillStyle = t.border;
  ctx.fillRect(0, height - 1, v.width, 1);
}

export function drawKeys(
  ctx: CanvasRenderingContext2D,
  v: View,
  t: Theme,
  width: number,
  active: ReadonlyMap<number, string>,
): void {
  ctx.fillStyle = t.panel;
  ctx.fillRect(0, 0, width, v.height);
  const top = Math.min(127, yToPitch(v, 0));
  const bottom = Math.max(0, yToPitch(v, v.height));
  ctx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'middle';
  for (let p = bottom; p <= top; p++) {
    const y = pitchToY(v, p);
    const black = isBlackKey(p);
    const highlight = active.get(p);
    ctx.fillStyle = highlight ?? (black ? t.keyBlack : t.keyWhite);
    const w = black ? width * 0.62 : width;
    ctx.fillRect(0, y, w, v.rowHeight - (black ? 0 : 0.5));
    if (!black) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, y + v.rowHeight - 1, width, 1);
    }
    if (p % 12 === 0 && v.rowHeight >= 8) {
      ctx.fillStyle = highlight ? '#fff' : '#555b6b';
      ctx.fillText(noteName(p), width - 26, y + v.rowHeight / 2);
    }
  }
}
