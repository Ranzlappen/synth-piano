import { describe, expect, it } from 'vitest';
import {
  copyToClipboard,
  duplicateNotes,
  fixOverlaps,
  humanizeNotes,
  joinNotes,
  legatoNotes,
  moveNotes,
  nearestGridPoint,
  pasteFromClipboard,
  quantizeNotes,
  splitNotesAt,
  thinControls,
  velocityRamp,
} from '@core/edit';
import { createControl, createNote, type Note } from '@core/model';

const n = (pitch: number, tick: number, duration: number, velocity = 100): Note =>
  createNote({ pitch, tick, duration, velocity });

describe('editing operations', () => {
  it('quantizes starts with strength and ends', () => {
    const notes = [n(60, 250, 200), n(62, 470, 500)];
    const q = quantizeNotes(notes, null, { grid: 240, strength: 1, swing: 0, ends: 'quantize' });
    expect(q.map((x) => [x.tick, x.duration])).toEqual([
      [240, 240],
      [480, 480],
    ]);
    const half = quantizeNotes(notes, null, { grid: 240, strength: 0.5, swing: 0, ends: 'keepLength' });
    expect(half[0].tick).toBe(245);
  });

  it('supports swing grids', () => {
    expect(nearestGridPoint(300, 240, 1)).toBe(320);
    expect(nearestGridPoint(470, 240, 1)).toBe(480);
  });

  it('moves notes but keeps them in range', () => {
    const notes = [n(126, 100, 10), n(60, 50, 10)];
    const moved = moveNotes(notes, null, -1000, 5);
    expect(moved.map((x) => [x.pitch, x.tick])).toEqual([
      [61, 0],
      [127, 50],
    ]);
  });

  it('duplicates, splits, joins and legatos', () => {
    const a = n(60, 0, 960);
    const d = duplicateNotes([a], new Set([a.id]), 960);
    expect(d.notes).toHaveLength(2);
    expect(d.notes[1].tick).toBe(960);
    const split = splitNotesAt([a], null, 480);
    expect(split.map((x) => [x.tick, x.duration])).toEqual([
      [0, 480],
      [480, 480],
    ]);
    const joined = joinNotes(split, null);
    expect(joined).toHaveLength(1);
    expect(joined[0].duration).toBe(960);
    const leg = legatoNotes([n(60, 0, 100), n(62, 480, 100)], null);
    expect(leg[0].duration).toBe(480);
  });

  it('fixes overlapping notes of the same pitch', () => {
    const fixed = fixOverlaps([n(60, 0, 1000), n(60, 500, 100), n(60, 500, 300, 120)]);
    expect(fixed.map((x) => [x.tick, x.duration, x.velocity])).toEqual([
      [0, 500, 100],
      [500, 300, 120],
    ]);
  });

  it('ramps velocity and humanizes deterministically', () => {
    const notes = [n(60, 0, 10), n(60, 100, 10), n(60, 200, 10)];
    expect(velocityRamp(notes, null, 20, 100).map((x) => x.velocity)).toEqual([20, 60, 100]);
    const h = humanizeNotes(notes, null, 0, 0, () => 0.5);
    expect(h.map((x) => x.velocity)).toEqual([100, 100, 100]);
  });

  it('copies and pastes relative to the earliest event', () => {
    const clip = copyToClipboard(
      [n(60, 1000, 100)],
      [createControl({ tick: 900, kind: 'cc', controller: 64, value: 127 })],
    );
    expect(clip.notes[0].tick).toBe(100);
    const pasted = pasteFromClipboard(clip, 5000);
    expect(pasted.notes[0].tick).toBe(5100);
    expect(pasted.controls[0].tick).toBe(5000);
  });

  it('thins redundant controller values', () => {
    const c = [0, 10, 20, 30].map((tick, i) =>
      createControl({ tick, kind: 'cc', controller: 11, value: i < 3 ? 50 : 60 }),
    );
    expect(thinControls(c).map((x) => x.tick)).toEqual([0, 30]);
  });
});
