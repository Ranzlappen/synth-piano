// Pure editing operations on note and controller lists. Every function returns new
// arrays and never mutates its input, so results can be committed to undo history.

import { clamp, newId, sortControls, sortNotes, type ControlEvent, type Note } from './model';

export type IdSet = ReadonlySet<string> | null;

const isSel = (ids: IdSet, id: string): boolean => ids === null || ids.has(id);

export interface QuantizeOptions {
  /** Grid in ticks. */
  grid: number;
  /** 0..1, how far notes move toward the grid. */
  strength: number;
  /** 0..1, delays every second grid line; 1 = triplet swing. */
  swing: number;
  /** What happens to note ends. */
  ends: 'keepLength' | 'quantize';
}

export function swungGridPoint(index: number, grid: number, swing: number): number {
  const pair = Math.floor(index / 2);
  const odd = index - pair * 2 === 1;
  return pair * 2 * grid + (odd ? grid * (1 + swing / 3) : 0);
}

/** Nearest (optionally swung) grid point to a tick. */
export function nearestGridPoint(tick: number, grid: number, swing = 0): number {
  if (grid <= 0) return tick;
  if (swing <= 0) return Math.round(tick / grid) * grid;
  const base = Math.floor(tick / (2 * grid)) * 2;
  let best = tick;
  let bestDist = Infinity;
  for (let i = base - 1; i <= base + 3; i++) {
    const p = swungGridPoint(i, grid, swing);
    const d = Math.abs(p - tick);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export function quantizeNotes(notes: readonly Note[], ids: IdSet, opts: QuantizeOptions): Note[] {
  const s = clamp(opts.strength, 0, 1);
  return sortNotes(
    notes.map((n) => {
      if (!isSel(ids, n.id)) return n;
      const target = nearestGridPoint(n.tick, opts.grid, opts.swing);
      const tick = Math.max(0, Math.round(n.tick + (target - n.tick) * s));
      let duration = n.duration;
      if (opts.ends === 'quantize') {
        const end = n.tick + n.duration;
        const endTarget = Math.max(target + opts.grid, nearestGridPoint(end, opts.grid, opts.swing));
        const newEnd = Math.round(end + (endTarget - end) * s);
        duration = Math.max(1, newEnd - tick);
      }
      return { ...n, tick, duration };
    }),
  );
}

export function moveNotes(notes: readonly Note[], ids: IdSet, dTick: number, dPitch: number): Note[] {
  let minTick = Infinity;
  let minPitch = 127;
  let maxPitch = 0;
  for (const n of notes)
    if (isSel(ids, n.id)) {
      minTick = Math.min(minTick, n.tick);
      minPitch = Math.min(minPitch, n.pitch);
      maxPitch = Math.max(maxPitch, n.pitch);
    }
  if (minTick === Infinity) return [...notes];
  const dt = Math.max(dTick, -minTick);
  const dp = clamp(dPitch, -minPitch, 127 - maxPitch);
  return sortNotes(notes.map((n) => (isSel(ids, n.id) ? { ...n, tick: n.tick + dt, pitch: n.pitch + dp } : n)));
}

export function transposeNotes(notes: readonly Note[], ids: IdSet, semitones: number): Note[] {
  return moveNotes(notes, ids, 0, semitones);
}

export function resizeNotes(notes: readonly Note[], ids: IdSet, dDuration: number, minDuration = 1): Note[] {
  return notes.map((n) => (isSel(ids, n.id) ? { ...n, duration: Math.max(minDuration, n.duration + dDuration) } : n));
}

export function setNoteVelocity(notes: readonly Note[], ids: IdSet, fn: (n: Note, index: number) => number): Note[] {
  let i = 0;
  return notes.map((n) => (isSel(ids, n.id) ? { ...n, velocity: clamp(Math.round(fn(n, i++)), 1, 127) } : n));
}

/** Linear velocity ramp across the selection in time order. */
export function velocityRamp(notes: readonly Note[], ids: IdSet, from: number, to: number): Note[] {
  const sel = notes.filter((n) => isSel(ids, n.id));
  if (sel.length === 0) return [...notes];
  const t0 = Math.min(...sel.map((n) => n.tick));
  const t1 = Math.max(...sel.map((n) => n.tick));
  return setNoteVelocity(notes, ids, (n) => (t1 === t0 ? to : from + ((n.tick - t0) / (t1 - t0)) * (to - from)));
}

export function deleteNotes(notes: readonly Note[], ids: IdSet): Note[] {
  return notes.filter((n) => !isSel(ids, n.id));
}

export function duplicateNotes(
  notes: readonly Note[],
  ids: IdSet,
  offset: number,
): { notes: Note[]; newIds: string[] } {
  const copies = notes
    .filter((n) => isSel(ids, n.id))
    .map((n) => ({ ...n, id: newId('n'), tick: n.tick + offset }));
  return { notes: sortNotes([...notes, ...copies]), newIds: copies.map((c) => c.id) };
}

/** Extends each selected note up to the next selected note start (per voice-less legato). */
export function legatoNotes(notes: readonly Note[], ids: IdSet): Note[] {
  const starts = [...new Set(notes.filter((n) => isSel(ids, n.id)).map((n) => n.tick))].sort((a, b) => a - b);
  return notes.map((n) => {
    if (!isSel(ids, n.id)) return n;
    const next = starts.find((s) => s > n.tick);
    return next === undefined ? n : { ...n, duration: next - n.tick };
  });
}

export function humanizeNotes(
  notes: readonly Note[],
  ids: IdSet,
  timingTicks: number,
  velocityAmount: number,
  random: () => number = Math.random,
): Note[] {
  const r = () => (random() + random() + random()) / 1.5 - 1; // approx. gaussian in [-1, 1]
  return sortNotes(
    notes.map((n) => {
      if (!isSel(ids, n.id)) return n;
      return {
        ...n,
        tick: Math.max(0, Math.round(n.tick + r() * timingTicks)),
        velocity: clamp(Math.round(n.velocity + r() * velocityAmount), 1, 127),
      };
    }),
  );
}

/** Splits selected notes that span `tick` into two notes. */
export function splitNotesAt(notes: readonly Note[], ids: IdSet, tick: number): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    if (isSel(ids, n.id) && n.tick < tick && n.tick + n.duration > tick) {
      out.push({ ...n, duration: tick - n.tick });
      out.push({ ...n, id: newId('n'), tick, duration: n.tick + n.duration - tick });
    } else out.push(n);
  }
  return sortNotes(out);
}

/** Joins selected notes of the same pitch that touch or overlap. */
export function joinNotes(notes: readonly Note[], ids: IdSet): Note[] {
  const out: Note[] = [];
  const sorted = sortNotes([...notes]);
  const lastByPitch = new Map<number, Note>();
  for (const n of sorted) {
    if (!isSel(ids, n.id)) {
      out.push(n);
      continue;
    }
    const prev = lastByPitch.get(n.pitch);
    if (prev && prev.tick + prev.duration >= n.tick) {
      prev.duration = Math.max(prev.duration, n.tick + n.duration - prev.tick);
      continue;
    }
    const copy = { ...n };
    lastByPitch.set(n.pitch, copy);
    out.push(copy);
  }
  return sortNotes(out);
}

/** Shortens notes that overlap a later note of the same pitch (they cannot sound twice). */
export function fixOverlaps(notes: readonly Note[]): Note[] {
  const sorted = sortNotes(notes.map((n) => ({ ...n })));
  const lastByPitch = new Map<number, Note>();
  const out: Note[] = [];
  for (const n of sorted) {
    const prev = lastByPitch.get(n.pitch);
    if (prev && prev.tick + prev.duration > n.tick) {
      if (prev.tick === n.tick) {
        // Exact duplicate start: keep the louder/longer one.
        prev.duration = Math.max(prev.duration, n.duration);
        prev.velocity = Math.max(prev.velocity, n.velocity);
        continue;
      }
      prev.duration = n.tick - prev.tick;
    }
    lastByPitch.set(n.pitch, n);
    out.push(n);
  }
  return out;
}

export function notesInRect(
  notes: readonly Note[],
  t0: number,
  t1: number,
  p0: number,
  p1: number,
): Note[] {
  const [ta, tb] = t0 < t1 ? [t0, t1] : [t1, t0];
  const [pa, pb] = p0 < p1 ? [p0, p1] : [p1, p0];
  return notes.filter((n) => n.pitch >= pa && n.pitch <= pb && n.tick < tb && n.tick + n.duration > ta);
}

// ---- controllers ----

export function deleteControls(controls: readonly ControlEvent[], ids: IdSet): ControlEvent[] {
  return controls.filter((c) => !isSel(ids, c.id));
}

/** Removes controller events of the given lane inside [t0, t1). */
export function clearControlRange(
  controls: readonly ControlEvent[],
  match: (c: ControlEvent) => boolean,
  t0: number,
  t1: number,
): ControlEvent[] {
  return controls.filter((c) => !(match(c) && c.tick >= t0 && c.tick < t1));
}

export function moveControls(controls: readonly ControlEvent[], ids: IdSet, dTick: number): ControlEvent[] {
  return sortControls(controls.map((c) => (isSel(ids, c.id) ? { ...c, tick: Math.max(0, c.tick + dTick) } : c)));
}

/** Removes consecutive duplicate values per controller lane to keep recordings compact. */
export function thinControls(controls: readonly ControlEvent[]): ControlEvent[] {
  const last = new Map<string, number>();
  const out: ControlEvent[] = [];
  for (const c of sortControls([...controls])) {
    const key = `${c.kind}:${c.controller}`;
    if (c.kind !== 'programChange' && last.get(key) === c.value) continue;
    last.set(key, c.value);
    out.push(c);
  }
  return out;
}

/** Value of a controller lane at a tick (last event at or before tick). */
export function controlValueAt(
  controls: readonly ControlEvent[],
  match: (c: ControlEvent) => boolean,
  tick: number,
  fallback: number,
): number {
  let value = fallback;
  for (const c of controls) {
    if (c.tick > tick) break;
    if (match(c)) value = c.value;
  }
  return value;
}

// ---- clipboard ----

export interface ClipboardData {
  notes: Note[];
  controls: ControlEvent[];
  /** Length in ticks spanned by the copied data. */
  length: number;
}

export function copyToClipboard(notes: readonly Note[], controls: readonly ControlEvent[]): ClipboardData {
  const all = [...notes.map((n) => n.tick), ...controls.map((c) => c.tick)];
  if (all.length === 0) return { notes: [], controls: [], length: 0 };
  const start = Math.min(...all);
  const end = Math.max(...notes.map((n) => n.tick + n.duration), ...controls.map((c) => c.tick + 1));
  return {
    notes: notes.map((n) => ({ ...n, tick: n.tick - start })),
    controls: controls.map((c) => ({ ...c, tick: c.tick - start })),
    length: end - start,
  };
}

export function pasteFromClipboard(clip: ClipboardData, at: number): { notes: Note[]; controls: ControlEvent[] } {
  return {
    notes: clip.notes.map((n) => ({ ...n, id: newId('n'), tick: n.tick + at })),
    controls: clip.controls.map((c) => ({ ...c, id: newId('c'), tick: c.tick + at })),
  };
}
