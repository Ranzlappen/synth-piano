// A synthetic but realistic piano performance used by notation tests: timing jitter,
// uneven note lengths, pedal changes, a crescendo, triplets and staccato notes.
import {
  createControl,
  createNote,
  createProject,
  createTrack,
  PPQ,
  type ControlEvent,
  type Note,
  type Project,
} from '@core/model';

export function seededRandom(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function pianoPerformance(
  options: { jitterTicks?: number; bpm?: number; seed?: number } = {},
): Project {
  const rand = seededRandom(options.seed ?? 7);
  const jitter = () => Math.round((rand() - 0.5) * 2 * (options.jitterTicks ?? 40));
  const q = PPQ;
  const bar = 4 * q;
  const notes: Note[] = [];
  const controls: ControlEvent[] = [];
  const add = (pitch: number, tick: number, len: number, vel: number) =>
    notes.push(
      createNote({
        pitch,
        tick: Math.max(0, tick + jitter()),
        duration: Math.max(30, len + jitter()),
        velocity: vel,
      }),
    );

  // Bars 1-4: C major melody in eighths with a crescendo; LH whole-note bass + half-note chords.
  const melody = [
    72, 74, 76, 77, 79, 77, 76, 74, 76, 77, 79, 81, 83, 81, 79, 77, 76, 74, 72, 74, 76, 74, 72, 71,
  ];
  melody.forEach((p, i) => add(p, i * (q / 2), q / 2 - 60, 50 + Math.round(i * 2.5)));
  add(72, 12 * q, 4 * q - 80, 100);
  for (let b = 0; b < 4; b++) {
    add(48 - (b % 2) * 5, b * bar, bar - 60, 60);
    add(55 + (b % 2) * 2, b * bar + 2 * q, 2 * q - 60, 55);
    add(60, b * bar + 2 * q, 2 * q - 60, 55);
    // Pedal: down after each bar line, change mid bar.
    controls.push(createControl({ tick: b * bar + 40, kind: 'cc', controller: 64, value: 127 }));
    controls.push(createControl({ tick: b * bar + bar - 30, kind: 'cc', controller: 64, value: 0 }));
  }
  // Bar 5: eighth-note triplets in the right hand, staccato quarters in the left.
  const t0 = 4 * bar;
  [67, 69, 71, 72, 71, 69, 67, 65, 64].forEach((p, i) => add(p, t0 + i * (q / 3), q / 3 - 20, 70));
  add(67, t0 + 3 * q, q - 40, 70);
  for (let i = 0; i < 4; i++) add(43, t0 + i * q, q / 4, 75);
  // Bar 6: soft chord with the soft pedal.
  controls.push(createControl({ tick: 5 * bar - 100, kind: 'cc', controller: 67, value: 127 }));
  add(64, 5 * bar, bar - 50, 35);
  add(67, 5 * bar, bar - 50, 35);
  add(72, 5 * bar, bar - 50, 35);
  add(36, 5 * bar, bar - 50, 40);
  controls.push(createControl({ tick: 6 * bar - 10, kind: 'cc', controller: 67, value: 0 }));
  notes.sort((a, b) => a.tick - b.tick);
  controls.sort((a, b) => a.tick - b.tick);

  return createProject({
    tempos: [{ tick: 0, bpm: options.bpm ?? 100 }],
    tracks: [createTrack({ name: 'Piano', notes, controls }, 0)],
    meta: {
      title: 'Test Piece',
      subtitle: 'for piano',
      composer: 'Test Composer',
      arranger: '',
      copyright: '© 2026 Test',
    },
  });
}
