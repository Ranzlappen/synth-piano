import { describe, expect, it } from 'vitest';
import { CaptureBuffer, mergeTake, RecordingBuffer } from '@core/recording';
import { createNote } from '@core/model';

describe('RecordingBuffer', () => {
  it('records notes with velocity, release velocity and pedals', () => {
    const r = new RecordingBuffer();
    r.add({ type: 'cc', channel: 0, controller: 64, value: 127 }, 0);
    r.add({ type: 'noteOn', channel: 0, note: 60, velocity: 88 }, 10);
    r.add({ type: 'cc', channel: 0, controller: 64, value: 45 }, 300); // half pedal
    r.add({ type: 'noteOff', channel: 0, note: 60, velocity: 20 }, 500);
    r.add({ type: 'pitchBend', channel: 0, value: 1000 }, 520);
    r.add({ type: 'channelPressure', channel: 0, value: 66 }, 530);
    r.add({ type: 'cc', channel: 0, controller: 123, value: 0 }, 540); // mode message ignored
    const take = r.finish(1000);
    expect(take.notes).toHaveLength(1);
    expect(take.notes[0]).toMatchObject({ pitch: 60, tick: 10, duration: 490, velocity: 88, releaseVelocity: 20 });
    expect(take.controls.map((c) => [c.kind, c.controller, c.value])).toEqual([
      ['cc', 64, 127],
      ['cc', 64, 45],
      ['pitchBend', 0, 1000],
      ['channelPressure', 0, 66],
    ]);
  });

  it('closes hanging notes when finishing and on loop wrap', () => {
    const r = new RecordingBuffer();
    r.add({ type: 'noteOn', channel: 0, note: 60, velocity: 100 }, 3000);
    r.wrap(3840, 0);
    expect(r.pending(100)[0].tick).toBe(0);
    const take = r.finish(200);
    expect(take.notes.map((n) => [n.tick, n.duration])).toEqual([
      [0, 200],
      [3000, 840],
    ]);
  });

  it('applies the channel filter', () => {
    const r = new RecordingBuffer({ pedals: true, controllers: true, pitchBend: true, aftertouch: true, programChange: true, channel: 1 });
    r.add({ type: 'noteOn', channel: 0, note: 60, velocity: 100 }, 0);
    r.add({ type: 'noteOff', channel: 0, note: 60, velocity: 0 }, 10);
    expect(r.finish(20).notes).toHaveLength(0);
  });
});

describe('mergeTake', () => {
  it('replaces material inside the range in replace mode', () => {
    const existing = { notes: [createNote({ pitch: 50, tick: 0, duration: 10, velocity: 1 }), createNote({ pitch: 51, tick: 5000, duration: 10, velocity: 1 })], controls: [] };
    const take = { notes: [createNote({ pitch: 60, tick: 100, duration: 10, velocity: 1 })], controls: [], start: 100, end: 200 };
    expect(mergeTake(existing, take, 'replace', { start: 0, end: 1000 }).notes.map((n) => n.pitch)).toEqual([60, 51]);
    expect(mergeTake(existing, take, 'overdub', { start: 0, end: 1000 }).notes.map((n) => n.pitch)).toEqual([50, 60, 51]);
  });
});

describe('CaptureBuffer', () => {
  it('captures the last phrase after a pause', () => {
    const c = new CaptureBuffer();
    c.push({ type: 'noteOn', channel: 0, note: 40, velocity: 50 }, 0);
    c.push({ type: 'noteOff', channel: 0, note: 40, velocity: 0 }, 0.5);
    c.push({ type: 'noteOn', channel: 0, note: 60, velocity: 90 }, 20);
    c.push({ type: 'noteOff', channel: 0, note: 60, velocity: 0 }, 21);
    const take = c.capture(1000, 1920);
    expect(take?.notes.map((n) => [n.pitch, n.tick, n.duration])).toEqual([[60, 1000, 1920]]);
  });
});
