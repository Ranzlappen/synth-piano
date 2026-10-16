import { describe, expect, it } from 'vitest';
import { MeterMap, TempoMap, formatClock, formatPosition } from '@core/timing';

describe('TempoMap', () => {
  it('converts ticks and seconds at constant tempo', () => {
    const m = new TempoMap([{ tick: 0, bpm: 120 }], 960);
    expect(m.tickToSeconds(960)).toBeCloseTo(0.5);
    expect(m.secondsToTick(2)).toBeCloseTo(3840);
  });

  it('handles tempo changes in both directions', () => {
    const m = new TempoMap(
      [
        { tick: 0, bpm: 120 },
        { tick: 1920, bpm: 60 },
      ],
      960,
    );
    expect(m.tickToSeconds(1920)).toBeCloseTo(1);
    expect(m.tickToSeconds(2880)).toBeCloseTo(2);
    expect(m.secondsToTick(2)).toBeCloseTo(2880);
    expect(m.bpmAt(100)).toBe(120);
    expect(m.bpmAt(2000)).toBe(60);
  });

  it('extrapolates negative ticks (count-in)', () => {
    const m = new TempoMap([{ tick: 0, bpm: 60 }], 960);
    expect(m.tickToSeconds(-960)).toBeCloseTo(-1);
  });
});

describe('MeterMap', () => {
  it('computes bar positions with signature changes', () => {
    const m = new MeterMap(
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 3840 * 2, numerator: 3, denominator: 4 },
        { tick: 3840 * 2 + 2880, numerator: 6, denominator: 8 },
      ],
      960,
    );
    expect(m.barIndexAt(0)).toBe(0);
    expect(m.barStart(2)).toBe(7680);
    expect(m.bar(2).numerator).toBe(3);
    expect(m.barStart(3)).toBe(7680 + 2880);
    expect(m.bar(3).ticksPerBeat).toBe(480);
    expect(m.position(7680 + 960 + 10)).toEqual({ bar: 3, beat: 2, tick: 10 });
    expect(m.tickOfPosition({ bar: 3, beat: 2, tick: 10 })).toBe(7680 + 970);
    expect(m.barsInRange(0, 7681).map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('snaps mid-bar signature changes to the next bar line', () => {
    const m = new MeterMap(
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 1000, numerator: 3, denominator: 4 },
      ],
      960,
    );
    expect(m.segs[1].tick).toBe(3840);
  });

  it('formats positions and clock times', () => {
    expect(formatPosition({ bar: 1, beat: 2, tick: 5 })).toBe('1.2.005');
    expect(formatClock(61.5)).toBe('1:01.500');
  });
});
