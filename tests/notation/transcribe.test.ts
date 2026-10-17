import { describe, expect, it } from 'vitest';
import { createControl, createNote, createProject, createTrack, PPQ, type Project } from '@core/model';
import { DEFAULT_SHEET_OPTIONS, resolveSheetOptions, type SheetExportOptions } from '@core/notation/options';
import { transcribe, type NScore } from '@core/notation/transcribe';
import { toMusicXml } from '@core/notation/musicxml';
import { pianoPerformance } from '../fixtures/performance';

const q = PPQ;
const opts = (o: Partial<SheetExportOptions> = {}): SheetExportOptions => ({
  ...DEFAULT_SHEET_OPTIONS,
  ...o,
});

function simpleProject(notes: [number, number, number, number?][], extra: Partial<Project> = {}): Project {
  return createProject({
    tracks: [
      createTrack(
        {
          notes: notes.map(([pitch, tick, duration, velocity]) =>
            createNote({ pitch, tick, duration, velocity: velocity ?? 80 }),
          ),
        },
        0,
      ),
    ],
    ...extra,
  });
}

const voiceText = (score: NScore, measure: number, staff = 1, voice = 0) => {
  const vs = score.parts[0].measures[measure].voices.filter((v) => v.staff === staff);
  return vs[voice].events.map(
    (e) =>
      `${e.rest ? 'r' : e.pitches.map((p) => `${p.step}${p.alter > 0 ? '#' : p.alter < 0 ? 'b' : ''}${p.octave}`).join('+')}:${e.value.type}${'.'.repeat(e.value.dots)}${e.value.triplet ? '3' : ''}${e.pitches.some((p) => p.tieStart) ? '~' : ''}`,
  );
};

describe('transcribe', () => {
  it('writes a simple melody on a single treble staff', () => {
    const p = simpleProject([
      [72, 0, q],
      [74, q, q],
      [76, 2 * q, 2 * q],
    ]);
    const s = transcribe(p, opts());
    expect(s.parts[0].staves).toBe(1);
    expect(s.parts[0].clefs).toEqual(['treble']);
    expect(voiceText(s, 0)).toEqual(['C5:quarter', 'D5:quarter', 'E5:half']);
    expect(s.stats.measures).toBe(1);
  });

  it('quantises sloppy timing and ties notes across bar lines', () => {
    const p = simpleProject([
      [60, 15, q - 40],
      [62, q - 20, q + 10],
      [64, 2 * q + 30, 3 * q - 30],
    ]);
    const s = transcribe(p, opts({ staffMode: 'treble' }));
    expect(voiceText(s, 0)).toEqual(['C4:quarter', 'D4:quarter', 'E4:half~']);
    expect(voiceText(s, 1)).toEqual(['E4:quarter', 'r:quarter', 'r:half']);
  });

  it('splits hands onto a grand staff', () => {
    const p = simpleProject([
      [76, 0, 4 * q],
      [48, 0, 4 * q],
      [52, 0, 4 * q],
    ]);
    const s = transcribe(p, opts({ staffMode: 'grand' }));
    expect(s.parts[0].staves).toBe(2);
    expect(voiceText(s, 0, 1)).toEqual(['E5:whole']);
    expect(voiceText(s, 0, 2)).toEqual(['C3+E3:whole']);
  });

  it('detects eighth-note triplets', () => {
    const p = simpleProject([
      [60, 0, q / 3],
      [62, q / 3, q / 3],
      [64, (2 * q) / 3, q / 3],
      [65, q, q],
      [67, 2 * q, 2 * q],
    ]);
    const s = transcribe(p, opts());
    expect(voiceText(s, 0)).toEqual(['C4:eighth3', 'D4:eighth3', 'E4:eighth3', 'F4:quarter', 'G4:half']);
    const first = s.parts[0].measures[0].voices[0].events[0];
    expect(first.tuplet).toBe('start');
    expect(first.beam).toBe('begin');
    expect(first.tupletBracket).toBe(false);
  });

  it('uses two voices for a held note under a moving line', () => {
    const p = simpleProject([
      [67, 0, 4 * q],
      [72, 0, q],
      [74, q, q],
      [76, 2 * q, q],
      [77, 3 * q, q],
    ]);
    const s = transcribe(p, opts({ staffMode: 'treble' }));
    const voices = s.parts[0].measures[0].voices;
    expect(voices).toHaveLength(2);
    expect(voices.find((v) => v.stem === 'up')!.events.map((e) => e.value.type)).toEqual([
      'quarter',
      'quarter',
      'quarter',
      'quarter',
    ]);
    expect(voices.find((v) => v.stem === 'down')!.events.map((e) => e.value.type)).toEqual(['whole']);
  });

  it('marks staccato and closes small gaps', () => {
    const p = simpleProject([
      [60, 0, q / 5],
      [62, q, q / 5],
      [64, 2 * q, q - 150],
      [65, 3 * q, q],
    ]);
    const s = transcribe(p, opts());
    const ev = s.parts[0].measures[0].voices[0].events;
    expect(ev.map((e) => e.value.type)).toEqual(['quarter', 'quarter', 'quarter', 'quarter']);
    expect(ev[0].articulations).toContain('staccato');
    expect(ev[2].articulations).not.toContain('staccato');
  });

  it('writes pedal, dynamics and tempo marks from the performance', () => {
    const s = transcribe(pianoPerformance(), opts({ tempoText: 'Andante' }));
    const dirs = s.parts[0].measures.flatMap((m) => m.directions);
    expect(dirs.some((d) => d.kind === 'pedal' && d.type === 'start')).toBe(true);
    expect(dirs.some((d) => d.kind === 'pedal' && (d.type === 'change' || d.type === 'stop'))).toBe(true);
    expect(dirs.some((d) => d.kind === 'dynamic')).toBe(true);
    expect(dirs.some((d) => d.kind === 'wedge' && d.type === 'crescendo')).toBe(true);
    expect(dirs.some((d) => d.kind === 'words' && d.text === 'una corda')).toBe(true);
    const tempo = dirs.find((d) => d.kind === 'tempo');
    expect(tempo).toMatchObject({ text: 'Andante', perMinute: 100 });
    expect(s.parts[0].staves).toBe(2);
    expect(s.stats.keyName).toBe('C major');
  });

  it('supports pickup bars', () => {
    const p = simpleProject([
      [67, 3 * q, q],
      [72, 4 * q, 4 * q],
    ]);
    const s = transcribe(p, opts({ pickupBeats: 1 }));
    expect(s.measures[0]).toMatchObject({ implicit: true, length: 48, number: 0 });
    expect(voiceText(s, 0)).toEqual(['G4:quarter']);
    expect(voiceText(s, 1)).toEqual(['C5:whole']);
    expect(transcribe(p, opts()).stats.suggestedPickup).toBe(1);
  });

  it('re-times free performances with a given tempo', () => {
    // Played at 60 BPM while the project ran at 120: every beat is two project beats.
    const p = simpleProject(
      [
        [60, 0, 2 * q],
        [62, 2 * q, 2 * q],
        [64, 4 * q, 4 * q],
      ],
      { tempos: [{ tick: 0, bpm: 120 }] },
    );
    const s = transcribe(p, opts({ timing: 'free', performanceBpm: 60, performanceOffsetSec: 0 }));
    expect(voiceText(s, 0)).toEqual(['C4:quarter', 'D4:quarter', 'E4:half']);
    expect(s.stats.tempoBpm).toBe(60);
  });

  it('honours bar ranges, transposition and duration scale', () => {
    const p = simpleProject([
      [60, 0, 4 * q],
      [62, 4 * q, 4 * q],
      [64, 8 * q, 4 * q],
    ]);
    const s = transcribe(p, opts({ fromBar: 2, toBar: 2, transpose: 2, keyMode: 'manual', keyFifths: 2 }));
    expect(s.measures).toHaveLength(1);
    expect(s.measures[0].number).toBe(2);
    expect(voiceText(s, 0)).toEqual(['E4:whole']);
    const half = transcribe(p, opts({ durationScale: 0.5 }));
    expect(voiceText(half, 0)).toEqual(['C4:half', 'D4:half']);
  });

  it('skips empty count-in bars', () => {
    const p = simpleProject([[60, 8 * q, 4 * q]]);
    const s = transcribe(p, opts());
    expect(s.measures).toHaveLength(1);
    expect(s.measures[0].number).toBe(1);
  });

  it('resolves options from the project and survives empty projects', () => {
    const p = createProject();
    const o = resolveSheetOptions(p, { grid: 999 as never, title: 'X' });
    expect(o.grid).toBe(16);
    expect(o.title).toBe('X');
    const s = transcribe(p, o);
    expect(s.stats.warnings.join(' ')).toContain('No notes');
    expect(toMusicXml(s, { software: 'test', measureNumbers: 'system' })).toContain('<rest measure="yes"/>');
  });

  it('produces well-formed MusicXML', () => {
    const p = pianoPerformance();
    p.tracks[0].controls.push(createControl({ tick: 0, kind: 'cc', controller: 7, value: 100 }));
    const xml = toMusicXml(transcribe(p, opts({ title: 'A & B <test>' })), {
      software: 'test',
      measureNumbers: 'system',
    });
    expect(xml).toContain('<work-title>A &amp; B &lt;test&gt;</work-title>');
    for (const m of xml.split('<measure ').slice(1)) expect(m).toMatch(/<\/measure>/);
    expect(xml.match(/<measure /g)!.length).toBeGreaterThan(4);
  });
});
