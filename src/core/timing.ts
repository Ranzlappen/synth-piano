import type { TempoEvent, TimeSignatureEvent } from './model';

interface TempoSegment {
  tick: number;
  sec: number;
  bpm: number;
}

/** Converts between ticks and seconds for a (possibly changing) tempo. */
export class TempoMap {
  private readonly segs: TempoSegment[];

  constructor(
    tempos: readonly TempoEvent[],
    readonly ppq: number,
  ) {
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
    if (sorted.length === 0 || sorted[0].tick > 0) sorted.unshift({ tick: 0, bpm: sorted[0]?.bpm ?? 120 });
    const segs: TempoSegment[] = [];
    let sec = 0;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (i > 0) {
        const prev = segs[segs.length - 1];
        sec = prev.sec + ((t.tick - prev.tick) / ppq) * (60 / prev.bpm);
        if (t.tick === prev.tick) segs.pop();
      }
      segs.push({ tick: t.tick, sec, bpm: Math.max(1, t.bpm) });
    }
    this.segs = segs;
  }

  private segForTick(tick: number): TempoSegment {
    const s = this.segs;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  private segForSec(sec: number): TempoSegment {
    const s = this.segs;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].sec <= sec) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  tickToSeconds(tick: number): number {
    const seg = this.segForTick(tick);
    return seg.sec + ((tick - seg.tick) / this.ppq) * (60 / seg.bpm);
  }

  secondsToTick(sec: number): number {
    const seg = this.segForSec(sec);
    return seg.tick + ((sec - seg.sec) * seg.bpm * this.ppq) / 60;
  }

  bpmAt(tick: number): number {
    return this.segForTick(tick).bpm;
  }

  get events(): readonly TempoSegment[] {
    return this.segs;
  }
}

export interface MeterSegment {
  tick: number;
  /** Zero-based index of the first bar of this segment. */
  bar: number;
  numerator: number;
  denominator: number;
  ticksPerBeat: number;
  ticksPerBar: number;
}

export interface BarInfo {
  /** Zero-based bar index. */
  index: number;
  start: number;
  end: number;
  numerator: number;
  denominator: number;
  ticksPerBeat: number;
}

export interface MusicalPosition {
  /** One-based bar number. */
  bar: number;
  /** One-based beat within the bar. */
  beat: number;
  /** Ticks within the beat. */
  tick: number;
}

/** Bar/beat arithmetic for a sequence of time signatures. */
export class MeterMap {
  readonly segs: MeterSegment[];

  constructor(
    sigs: readonly TimeSignatureEvent[],
    readonly ppq: number,
  ) {
    const sorted = [...sigs].sort((a, b) => a.tick - b.tick);
    if (sorted.length === 0 || sorted[0].tick > 0)
      sorted.unshift({
        tick: 0,
        numerator: sorted[0]?.numerator ?? 4,
        denominator: sorted[0]?.denominator ?? 4,
      });
    const segs: MeterSegment[] = [];
    for (const s of sorted) {
      const ticksPerBeat = (ppq * 4) / s.denominator;
      const ticksPerBar = ticksPerBeat * s.numerator;
      if (segs.length === 0) {
        segs.push({
          tick: 0,
          bar: 0,
          numerator: s.numerator,
          denominator: s.denominator,
          ticksPerBeat,
          ticksPerBar,
        });
        continue;
      }
      const prev = segs[segs.length - 1];
      // Snap the change onto the next bar line of the previous signature.
      const barsSince = Math.max(0, Math.ceil((s.tick - prev.tick) / prev.ticksPerBar - 1e-9));
      const tick = prev.tick + barsSince * prev.ticksPerBar;
      const bar = prev.bar + barsSince;
      if (tick === prev.tick) segs.pop();
      segs.push({ tick, bar, numerator: s.numerator, denominator: s.denominator, ticksPerBeat, ticksPerBar });
    }
    this.segs = segs;
  }

  segmentAt(tick: number): MeterSegment {
    const s = this.segs;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  private segmentForBar(bar: number): MeterSegment {
    const s = this.segs;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].bar <= bar) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  barIndexAt(tick: number): number {
    const seg = this.segmentAt(tick);
    return seg.bar + Math.floor((tick - seg.tick) / seg.ticksPerBar);
  }

  barStart(index: number): number {
    const seg = this.segmentForBar(index);
    return seg.tick + (index - seg.bar) * seg.ticksPerBar;
  }

  bar(index: number): BarInfo {
    const seg = this.segmentForBar(index);
    const start = seg.tick + (index - seg.bar) * seg.ticksPerBar;
    return {
      index,
      start,
      end: start + seg.ticksPerBar,
      numerator: seg.numerator,
      denominator: seg.denominator,
      ticksPerBeat: seg.ticksPerBeat,
    };
  }

  /** Bars overlapping [startTick, endTick). */
  barsInRange(startTick: number, endTick: number): BarInfo[] {
    const out: BarInfo[] = [];
    for (let i = this.barIndexAt(startTick); ; i++) {
      const b = this.bar(i);
      if (b.start >= endTick) break;
      out.push(b);
    }
    return out;
  }

  position(tick: number): MusicalPosition {
    const seg = this.segmentAt(tick);
    const barOffset = Math.floor((tick - seg.tick) / seg.ticksPerBar);
    const inBar = tick - seg.tick - barOffset * seg.ticksPerBar;
    const beat = Math.floor(inBar / seg.ticksPerBeat);
    return {
      bar: seg.bar + barOffset + 1,
      beat: beat + 1,
      tick: Math.round(inBar - beat * seg.ticksPerBeat),
    };
  }

  tickOfPosition(pos: MusicalPosition): number {
    const b = this.bar(pos.bar - 1);
    return b.start + (pos.beat - 1) * b.ticksPerBeat + pos.tick;
  }

  ticksPerBeatAt(tick: number): number {
    return this.segmentAt(tick).ticksPerBeat;
  }
}

export function formatPosition(pos: MusicalPosition): string {
  return `${pos.bar}.${pos.beat}.${String(Math.max(0, pos.tick)).padStart(3, '0')}`;
}

export function formatClock(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${sign}${m}:${rest.toFixed(3).padStart(6, '0')}`;
}

/** Grid sizes offered in the editor, as fractions of a whole note. */
export const GRID_OPTIONS = [
  { label: '1/1', value: 1 },
  { label: '1/2', value: 2 },
  { label: '1/4', value: 4 },
  { label: '1/8', value: 8 },
  { label: '1/16', value: 16 },
  { label: '1/32', value: 32 },
  { label: '1/4T', value: 6 },
  { label: '1/8T', value: 12 },
  { label: '1/16T', value: 24 },
] as const;

/** Ticks for a grid given as "1/value" of a whole note (triplets use 6, 12, 24). */
export function gridTicks(value: number, ppq: number): number {
  return (ppq * 4) / value;
}

export function snapTick(tick: number, grid: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  if (grid <= 0) return Math.round(tick);
  const f = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  return f(tick / grid) * grid;
}
