// Metrical structure and decomposition of time spans into notatable note values.
// All positions are integer "divisions" (DIV per quarter note) relative to the bar start.

/** Divisions per quarter note. Divisible by 16ths (12), 32nds (6), 64ths (3) and triplet 8ths (16). */
export const DIV = 48;

export type NoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th';

export interface NoteValue {
  type: NoteType;
  dots: number;
  /** Length in divisions (already including the tuplet ratio). */
  duration: number;
  /** Member of an eighth-note triplet (3:2). */
  triplet: boolean;
}

const BASE: { type: NoteType; duration: number }[] = [
  { type: 'whole', duration: 192 },
  { type: 'half', duration: 96 },
  { type: 'quarter', duration: 48 },
  { type: 'eighth', duration: 24 },
  { type: '16th', duration: 12 },
  { type: '32nd', duration: 6 },
  { type: '64th', duration: 3 },
];

/** Straight note values (with up to one dot), longest first. */
const STRAIGHT_VALUES: NoteValue[] = BASE.flatMap((b) => {
  const plain = { type: b.type, dots: 0, duration: b.duration, triplet: false };
  return b.duration >= 6 ? [{ type: b.type, dots: 1, duration: (b.duration * 3) / 2, triplet: false }, plain] : [plain];
}).sort((a, b) => b.duration - a.duration);

export interface Meter {
  numerator: number;
  denominator: number;
}

export function isCompound(m: Meter): boolean {
  return m.numerator % 3 === 0 && m.numerator >= 6 && m.denominator >= 4;
}

export function measureLength(m: Meter): number {
  return (m.numerator * DIV * 4) / m.denominator;
}

/** Length of the felt beat (dotted for compound meters). */
export function beatLength(m: Meter): number {
  const unit = (DIV * 4) / m.denominator;
  return isCompound(m) ? unit * 3 : unit;
}

/** Span over which short notes are beamed together. */
export function beamGroupLength(m: Meter): number {
  if (isCompound(m)) return beatLength(m);
  if (m.denominator === 8) return m.numerator % 2 === 0 && m.numerator <= 4 ? DIV : (DIV * 3) / 2;
  if (m.denominator === 2) return DIV * 2;
  if (m.denominator === 16) return DIV / 2;
  return DIV;
}

/**
 * Metrical strength of a position inside the bar: 0 = downbeat, 1 = half bar,
 * 2 = beat, 3 = half/third of a beat, 4 = finer subdivision, 5 = off-grid.
 */
export function strengthAt(pos: number, m: Meter): number {
  if (pos === 0) return 0;
  const bar = measureLength(m);
  const beat = beatLength(m);
  const beats = Math.round(bar / beat);
  if (beats >= 4 && beats % 2 === 0 && pos === bar / 2) return 1;
  if (pos % beat === 0) return 2;
  const sub = isCompound(m) ? beat / 3 : beat / 2;
  if (pos % sub === 0) return 3;
  const sub2 = sub / 2;
  if (Number.isInteger(sub2) && pos % sub2 === 0) return 4;
  return 5;
}

/** True when [start, end) crosses a boundary that is stronger than the start position allows. */
function crossesForbiddenBoundary(start: number, end: number, m: Meter, step: number): boolean {
  const limit = Math.min(strengthAt(start, m), 3);
  for (let p = start + step - (start % step); p < end; p += step) {
    if (p > start && strengthAt(p, m) < limit) return true;
  }
  return false;
}

export interface Piece {
  start: number;
  value: NoteValue;
}

/**
 * Splits [start, end) inside one bar into note values that respect the meter.
 * `tripletBeats` lists the quarter-note beats (by index within the bar) that use
 * eighth-note triplets; spans inside them become 3:2 values.
 */
export function decompose(
  start: number,
  end: number,
  m: Meter,
  tripletBeats: ReadonlySet<number>,
  isRest: boolean,
): Piece[] {
  const pieces: Piece[] = [];
  const bar = measureLength(m);
  if (isRest && start === 0 && end === bar) {
    return [{ start: 0, value: { type: 'whole', dots: 0, duration: bar, triplet: false } }];
  }
  let pos = start;
  let guard = 0;
  while (pos < end && guard++ < 512) {
    const beatIndex = Math.floor(pos / DIV);
    const beatStart = beatIndex * DIV;
    const beatEnd = beatStart + DIV;
    if (tripletBeats.has(beatIndex) && !(pos === beatStart && end >= beatEnd)) {
      const segEnd = Math.min(end, beatEnd);
      const len = segEnd - pos;
      const d = len >= 32 ? 32 : 16;
      if (len < 16) {
        // Off the triplet grid (should not happen after quantisation) – absorb the remainder.
        pieces.push({ start: pos, value: { type: 'eighth', dots: 0, duration: len, triplet: true } });
        pos = segEnd;
        continue;
      }
      pieces.push({ start: pos, value: { type: d === 32 ? 'quarter' : 'eighth', dots: 0, duration: d, triplet: true } });
      pos += d;
      continue;
    }
    // Straight values may not run into a triplet beat.
    let limit = end;
    for (let b = beatIndex + 1; b * DIV < end; b++) {
      if (tripletBeats.has(b)) {
        limit = b * DIV;
        break;
      }
    }
    const candidates = STRAIGHT_VALUES.filter((v) => {
      if (pos + v.duration > limit) return false;
      if (isRest && v.dots > 0 && !(isCompound(m) && v.duration === beatLength(m) && pos % v.duration === 0)) return false;
      if (crossesForbiddenBoundary(pos, pos + v.duration, m, 3)) return false;
      // Dotted values must start on a position aligned to their undotted base.
      if (v.dots > 0 && pos % ((v.duration * 2) / 3 / 2) !== 0) return false;
      return true;
    });
    const choice = candidates[0];
    if (!choice) {
      const len = limit - pos;
      const fallback = STRAIGHT_VALUES.find((v) => v.duration <= len) ?? STRAIGHT_VALUES[STRAIGHT_VALUES.length - 1];
      pieces.push({ start: pos, value: { ...fallback, duration: Math.max(1, Math.min(len, fallback.duration)) } });
      pos += Math.max(1, Math.min(len, fallback.duration));
      continue;
    }
    pieces.push({ start: pos, value: choice });
    pos += choice.duration;
  }
  return pieces;
}

/** Note type for a beat-unit display (metronome marks). */
export function beatUnitFor(m: Meter): { unit: NoteType; dotted: boolean; quarterFactor: number } {
  if (isCompound(m)) {
    const base = m.denominator === 8 ? 'quarter' : m.denominator === 16 ? 'eighth' : 'half';
    const q = (4 / m.denominator) * 3;
    return { unit: base, dotted: true, quarterFactor: q };
  }
  switch (m.denominator) {
    case 2:
      return { unit: 'half', dotted: false, quarterFactor: 2 };
    case 8:
      return { unit: 'eighth', dotted: false, quarterFactor: 0.5 };
    case 16:
      return { unit: '16th', dotted: false, quarterFactor: 0.25 };
    case 1:
      return { unit: 'whole', dotted: false, quarterFactor: 4 };
    default:
      return { unit: 'quarter', dotted: false, quarterFactor: 1 };
  }
}
