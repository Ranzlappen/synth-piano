import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '@core/project-io';
import { createNote, createProject } from '@core/model';

describe('project files', () => {
  it('round-trips a project', () => {
    const p = createProject();
    p.tracks[0].notes.push(createNote({ pitch: 61, tick: 10, duration: 20, velocity: 30 }));
    const back = parseProject(serializeProject(p));
    expect(back.tracks[0].notes[0]).toEqual(p.tracks[0].notes[0]);
    expect(back.meta).toEqual(p.meta);
  });

  it('repairs out-of-range values and rejects foreign files', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'synth-piano-project',
        version: 1,
        ppq: 480,
        tracks: [{ notes: [{ pitch: 200, tick: 10, duration: -5, velocity: 0 }], channel: 99 }],
      }),
    );
    expect(p.tracks[0].notes[0]).toMatchObject({ pitch: 127, tick: 20, duration: 1, velocity: 1 });
    expect(p.tracks[0].channel).toBe(15);
    expect(p.tempos[0].bpm).toBe(120);
    expect(() => parseProject('{"foo":1}')).toThrow();
    expect(() => parseProject('not json')).toThrow();
  });
});
