import { describe, expect, it } from 'vitest';
import { parseSmf, writeSmf, META, tempoBytes, readTempo, type SmfEvent } from '@core/midi/smf';
import { projectToSmf, smfToProject } from '@core/midi/convert';
import { createControl, createNote, createProject, createTrack } from '@core/model';

describe('SMF reader/writer', () => {
  it('round-trips all channel event types', () => {
    const events: SmfEvent[] = [
      { tick: 0, type: 'meta', metaType: META.TEMPO, data: tempoBytes(90) },
      { tick: 0, type: 'programChange', channel: 2, program: 5 },
      { tick: 0, type: 'noteOn', channel: 2, note: 60, velocity: 100 },
      { tick: 10, type: 'cc', channel: 2, controller: 64, value: 127 },
      { tick: 20, type: 'pitchBend', channel: 2, value: -4096 },
      { tick: 30, type: 'channelPressure', channel: 2, value: 77 },
      { tick: 40, type: 'polyPressure', channel: 2, note: 60, value: 33 },
      { tick: 480, type: 'noteOff', channel: 2, note: 60, velocity: 40 },
      { tick: 500, type: 'sysex', data: new Uint8Array([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]) },
    ];
    const bytes = writeSmf({ format: 1, ppq: 480, tracks: [events] });
    const parsed = parseSmf(bytes);
    expect(parsed.ppq).toBe(480);
    expect(parsed.tracks[0].map((e) => e.type)).toEqual(events.map((e) => e.type));
    const pb = parsed.tracks[0].find((e) => e.type === 'pitchBend');
    expect(pb && 'value' in pb && pb.value).toBe(-4096);
    const tempo = parsed.tracks[0][0];
    expect(tempo.type === 'meta' && readTempo(tempo.data)).toBeCloseTo(90, 1);
  });

  it('parses running status and note-on with zero velocity', () => {
    // Header + one track: 90 3C 64, (running) 3C 00 after 96 ticks
    const track = [0x00, 0x90, 0x3c, 0x64, 0x60, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00];
    const bytes = new Uint8Array([
      ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96],
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length],
      ...track,
    ]);
    const smf = parseSmf(bytes);
    expect(smf.tracks[0]).toHaveLength(2);
    expect(smf.tracks[0][1]).toMatchObject({ type: 'noteOff', tick: 96, note: 60 });
  });

  it('rejects non-MIDI data', () => {
    expect(() => parseSmf(new TextEncoder().encode('hello world, not midi'))).toThrow();
  });
});

describe('project <-> SMF conversion', () => {
  it('preserves notes, velocities, pedals, bends and tempo', () => {
    const project = createProject({
      tempos: [
        { tick: 0, bpm: 100 },
        { tick: 3840, bpm: 80 },
      ],
      timeSignatures: [{ tick: 0, numerator: 3, denominator: 4 }],
      tracks: [
        createTrack(
          {
            name: 'Piano',
            channel: 0,
            program: 0,
            notes: [
              createNote({ pitch: 60, tick: 0, duration: 960, velocity: 90, releaseVelocity: 30 }),
              createNote({ pitch: 64, tick: 960, duration: 480, velocity: 50 }),
            ],
            controls: [
              createControl({ tick: 10, kind: 'cc', controller: 64, value: 127 }),
              createControl({ tick: 900, kind: 'cc', controller: 64, value: 0 }),
              createControl({ tick: 100, kind: 'pitchBend', value: 2000 }),
              createControl({ tick: 200, kind: 'channelPressure', value: 40 }),
            ],
          },
          0,
        ),
        createTrack({ name: 'Bass', channel: 1, program: 33, notes: [createNote({ pitch: 36, tick: 0, duration: 1920, velocity: 70 })] }, 1),
      ],
    });
    const back = smfToProject(parseSmf(writeSmf(projectToSmf(project))), 'test.mid');
    expect(back.tempos).toEqual(project.tempos);
    expect(back.timeSignatures).toEqual(project.timeSignatures);
    expect(back.tracks).toHaveLength(2);
    expect(back.tracks[0].notes.map((n) => [n.pitch, n.tick, n.duration, n.velocity, n.releaseVelocity])).toEqual([
      [60, 0, 960, 90, 30],
      [64, 960, 480, 50, 64],
    ]);
    expect(back.tracks[0].controls.map((c) => [c.kind, c.tick, c.value])).toEqual([
      ['cc', 10, 127],
      ['pitchBend', 100, 2000],
      ['channelPressure', 200, 40],
      ['cc', 900, 0],
    ]);
    expect(back.tracks[1]).toMatchObject({ name: 'Bass', channel: 1, program: 33 });
  });

  it('rescales foreign PPQ and splits format-0 files by channel', () => {
    const smf = {
      format: 0 as const,
      ppq: 96,
      tracks: [
        [
          { tick: 0, type: 'noteOn', channel: 0, note: 60, velocity: 100 },
          { tick: 0, type: 'noteOn', channel: 9, note: 36, velocity: 100 },
          { tick: 96, type: 'noteOff', channel: 0, note: 60, velocity: 0 },
          { tick: 48, type: 'noteOff', channel: 9, note: 36, velocity: 0 },
        ] as SmfEvent[],
      ],
    };
    const p = smfToProject(smf, 'song.mid');
    expect(p.meta.title).toBe('song');
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].notes[0].duration).toBe(960);
    expect(p.tracks[1].channel).toBe(9);
    expect(p.tracks[1].name).toContain('Drums');
  });
});
