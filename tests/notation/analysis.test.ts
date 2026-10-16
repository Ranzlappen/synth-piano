import { describe, expect, it } from 'vitest';
import { detectKey, estimateTempo } from '@core/notation/analysis';
import { spellPitch } from '@core/notation/spelling';
import { seededRandom } from '../fixtures/performance';

describe('key detection', () => {
  it('detects major and minor keys', () => {
    const cMajor = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60].map((pitch) => ({ pitch, duration: 1 }));
    expect(detectKey(cMajor)).toMatchObject({ fifths: 0, mode: 'major' });
    const aMinor = [57, 59, 60, 62, 64, 65, 68, 69, 64, 57, 60, 64, 68, 69].map((pitch) => ({ pitch, duration: 1 }));
    expect(detectKey(aMinor)).toMatchObject({ fifths: 0, mode: 'minor' });
    const eFlat = [63, 65, 67, 68, 70, 72, 74, 75, 70, 67, 63].map((pitch) => ({ pitch, duration: 1 }));
    expect(detectKey(eFlat).fifths).toBe(-3);
  });
});

describe('pitch spelling', () => {
  const name = (p: number, f: number, minor = false) => {
    const s = spellPitch(p, f, minor);
    return `${s.step}${s.alter === 1 ? '#' : s.alter === -1 ? 'b' : s.alter === 2 ? '##' : s.alter === -2 ? 'bb' : ''}${s.octave}`;
  };
  it('uses conventional spellings for the key', () => {
    expect([61, 63, 66, 68, 70].map((p) => name(p, 0))).toEqual(['C#4', 'Eb4', 'F#4', 'G#4', 'Bb4']);
    expect(name(68, 0, true)).toBe('G#4');
    expect([61, 66, 70].map((p) => name(p, -4))).toEqual(['Db4', 'Gb4', 'Bb4']);
    expect(name(65, 1)).toBe('F4');
    expect(name(66, 6)).toBe('F#4');
    expect(name(65, 6)).toBe('E#4');
    expect(name(59, -6)).toBe('Cb4');
  });
});

describe('tempo estimation', () => {
  it('finds the tempo and phase of a jittered performance', () => {
    const rand = seededRandom(3);
    const bpm = 87;
    const beat = 60 / bpm;
    const onsets: number[] = [];
    for (let i = 0; i < 64; i++) {
      onsets.push(1.3 + i * beat + (rand() - 0.5) * 0.02);
      if (i % 2 === 0) onsets.push(1.3 + (i + 0.5) * beat + (rand() - 0.5) * 0.02);
    }
    const est = estimateTempo(onsets)!;
    expect(Math.abs(est.bpm - bpm)).toBeLessThan(1.5);
    expect(Math.abs(est.offsetSec - 1.3)).toBeLessThan(0.05);
  });

  it('returns null for too few notes', () => {
    expect(estimateTempo([0, 1])).toBeNull();
  });
});
