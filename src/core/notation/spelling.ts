// Key-aware pitch spelling. Each pitch class is spelled with the letter name whose
// position on the line of fifths is closest to the centre of the current key.

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface SpelledPitch {
  step: Step;
  alter: number;
  octave: number;
}

const STEPS: { step: Step; pc: number; fifths: number }[] = [
  { step: 'F', pc: 5, fifths: -1 },
  { step: 'C', pc: 0, fifths: 0 },
  { step: 'G', pc: 7, fifths: 1 },
  { step: 'D', pc: 2, fifths: 2 },
  { step: 'A', pc: 9, fifths: 3 },
  { step: 'E', pc: 4, fifths: 4 },
  { step: 'B', pc: 11, fifths: 5 },
];

const cache = new Map<string, { step: Step; alter: number }[]>();

/** Spelling table (index = pitch class) for a key. */
export function spellingTable(keyFifths: number, minor: boolean): { step: Step; alter: number }[] {
  const cacheKey = `${keyFifths}:${minor}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  // Centre of the diatonic window; minor keys lean sharpward for the raised 6th/7th.
  const centre = keyFifths + (minor ? 3 : 2);
  const table: { step: Step; alter: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    let best: { step: Step; alter: number; dist: number } | null = null;
    for (const s of STEPS) {
      const alter = ((pc - s.pc + 18) % 12) - 6; // -6..5
      if (Math.abs(alter) > 2) continue;
      const pos = s.fifths + 7 * alter;
      const dist = Math.abs(pos - centre) + (Math.abs(alter) === 2 ? 4 : 0);
      const better =
        !best ||
        dist < best.dist ||
        // Tie: sharps in sharp keys (and C), flats in flat keys.
        (dist === best.dist && (keyFifths >= 0 ? alter > best.alter : alter < best.alter));
      if (better) best = { step: s.step, alter, dist };
    }
    table.push({ step: best!.step, alter: best!.alter });
  }
  cache.set(cacheKey, table);
  return table;
}

export function spellPitch(pitch: number, keyFifths: number, minor: boolean): SpelledPitch {
  const { step, alter } = spellingTable(keyFifths, minor)[((pitch % 12) + 12) % 12];
  const natural = pitch - alter;
  return { step, alter, octave: Math.floor(natural / 12) - 1 };
}
