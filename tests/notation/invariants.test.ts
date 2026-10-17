import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET_OPTIONS, type SheetExportOptions } from '@core/notation/options';
import { transcribe } from '@core/notation/transcribe';
import { createNote, createProject, createTrack, PPQ } from '@core/model';
import { pianoPerformance, seededRandom } from '../fixtures/performance';

function randomProject(seed: number) {
  const rand = seededRandom(seed);
  const notes = [];
  let t = Math.floor(rand() * PPQ * 4);
  for (let i = 0; i < 150; i++) {
    const chord = 1 + Math.floor(rand() * 3);
    for (let c = 0; c < chord; c++)
      notes.push(
        createNote({
          pitch: 30 + Math.floor(rand() * 70),
          tick: t + Math.floor(rand() * 30),
          duration: 20 + Math.floor(rand() * PPQ * 3),
          velocity: 1 + Math.floor(rand() * 126),
        }),
      );
    t += Math.floor(rand() * PPQ);
  }
  return createProject({ tracks: [createTrack({ notes }, 0)] });
}

const variants: Partial<SheetExportOptions>[] = [
  {},
  { grid: 8, triplets: false },
  { grid: 32, voices: 1 },
  { durations: 'exact', staffMode: 'grand', handSplit: 'fixed' },
  { durations: 'legato', swing: true },
  { timeSignature: '3/4' },
  { timeSignature: '6/8' },
  { timeSignature: '5/8' },
  { timeSignature: '2/2' },
  { pickupBeats: 1.5 },
  { timing: 'free', performanceBpm: 73, performanceOffsetSec: 0.37 },
  { durationScale: 2 },
  { durationScale: 0.5, pickupBeats: 1 },
  { extendUnderPedal: true, accents: true, dynamicsSensitivity: 'high' },
];

describe('notation invariants', () => {
  for (const [i, v] of variants.entries()) {
    it(`every voice fills its bar exactly (variant ${i}: ${JSON.stringify(v)})`, () => {
      for (const project of [
        pianoPerformance({ jitterTicks: 80 }),
        randomProject(i + 1),
        randomProject(i + 100),
      ]) {
        const score = transcribe(project, { ...DEFAULT_SHEET_OPTIONS, ...v });
        for (const part of score.parts) {
          part.measures.forEach((pm, mi) => {
            const m = score.measures[mi];
            expect(pm.voices.length).toBeGreaterThan(0);
            for (const voice of pm.voices) {
              const total = voice.events.reduce((s, e) => s + e.value.duration, 0);
              expect(total, `measure ${mi} staff ${voice.staff} voice ${voice.voice}`).toBe(m.length);
              let pos = voice.events[0]?.start ?? 0;
              for (const e of voice.events) {
                expect(e.start).toBe(pos);
                expect(e.value.duration).toBeGreaterThan(0);
                pos += e.value.duration;
              }
              // Tuplets must be balanced.
              let open = 0;
              for (const e of voice.events) {
                if (e.tuplet === 'start') open++;
                if (e.tuplet === 'stop') open--;
                expect(open).toBeGreaterThanOrEqual(0);
                expect(open).toBeLessThanOrEqual(1);
              }
            }
            for (const d of pm.directions) {
              expect(d.offset).toBeGreaterThanOrEqual(0);
              expect(d.offset).toBeLessThanOrEqual(m.length);
            }
          });
        }
      }
    });
  }
});
