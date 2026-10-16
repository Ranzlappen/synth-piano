import { describe, expect, it } from 'vitest';
import { beatLength, beamGroupLength, decompose, DIV, strengthAt } from '@core/notation/rhythm';

const fourFour = { numerator: 4, denominator: 4 };
const sixEight = { numerator: 6, denominator: 8 };
const none = new Set<number>();
const fmt = (pieces: ReturnType<typeof decompose>) =>
  pieces.map((p) => `${p.start}:${p.value.type}${'.'.repeat(p.value.dots)}${p.value.triplet ? '3' : ''}`);

describe('rhythm', () => {
  it('knows metrical strength', () => {
    expect(strengthAt(0, fourFour)).toBe(0);
    expect(strengthAt(96, fourFour)).toBe(1);
    expect(strengthAt(48, fourFour)).toBe(2);
    expect(strengthAt(24, fourFour)).toBe(3);
    expect(strengthAt(72, sixEight)).toBe(2);
    expect(beatLength(sixEight)).toBe(72);
    expect(beamGroupLength(sixEight)).toBe(72);
  });

  it('writes plain values on strong positions', () => {
    expect(fmt(decompose(0, 192, fourFour, none, false))).toEqual(['0:whole']);
    expect(fmt(decompose(0, 144, fourFour, none, false))).toEqual(['0:half.']);
    expect(fmt(decompose(0, 72, fourFour, none, false))).toEqual(['0:quarter.']);
  });

  it('does not hide the middle of a 4/4 bar', () => {
    expect(fmt(decompose(48, 144, fourFour, none, false))).toEqual(['48:quarter', '96:quarter']);
  });

  it('splits syncopations at the beat', () => {
    expect(fmt(decompose(24, 72, fourFour, none, false))).toEqual(['24:eighth', '48:eighth']);
    expect(fmt(decompose(12, 48, fourFour, none, false))).toEqual(['12:eighth.']);
  });

  it('handles compound meters', () => {
    expect(fmt(decompose(0, 144, sixEight, none, false))).toEqual(['0:half.']);
    expect(fmt(decompose(24, 72, sixEight, none, false))).toEqual(['24:quarter']);
    expect(fmt(decompose(48, 96, sixEight, none, false))).toEqual(['48:eighth', '72:eighth']);
  });

  it('writes triplets inside triplet beats', () => {
    const trip = new Set([1]);
    expect(fmt(decompose(48, 96, fourFour, trip, false))).toEqual(['48:quarter']);
    expect(fmt(decompose(48, 80, fourFour, trip, false))).toEqual(['48:quarter3']);
    expect(fmt(decompose(64, 96, fourFour, trip, false))).toEqual(['64:quarter3']);
    expect(fmt(decompose(0, 64, fourFour, trip, false))).toEqual(['0:quarter', '48:eighth3']);
  });

  it('writes whole-bar rests and avoids dotted rests', () => {
    expect(decompose(0, 192, fourFour, none, true)[0].value.duration).toBe(192);
    expect(fmt(decompose(0, 72, fourFour, none, true))).toEqual(['0:quarter', '48:eighth']);
    expect(DIV).toBe(48);
  });
});
