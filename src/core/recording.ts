// Turns a live stream of timestamped MIDI messages into notes and controller events.
// Everything that carries musical dynamics is kept: note-on velocity, release velocity,
// sustain / sostenuto / soft pedal (including half-pedal values), expression, modulation,
// breath, pitch bend, channel and polyphonic aftertouch and program changes.

import { thinControls } from './edit';
import {
  createControl,
  createNote,
  sortControls,
  sortNotes,
  type ControlEvent,
  type Note,
  type Track,
} from './model';
import { CC } from './music';
import type { MidiMessage } from './midi/messages';

export interface RecordFilter {
  /** Record the sustain, sostenuto and soft pedals (CC64/66/67). */
  pedals: boolean;
  /** Record all other continuous controllers. */
  controllers: boolean;
  pitchBend: boolean;
  /** Channel and polyphonic aftertouch. */
  aftertouch: boolean;
  programChange: boolean;
  /** Only record messages from this channel (0..15) or from all channels (null). */
  channel: number | null;
}

export const DEFAULT_RECORD_FILTER: RecordFilter = {
  pedals: true,
  controllers: true,
  pitchBend: true,
  aftertouch: true,
  programChange: true,
  channel: null,
};

interface OpenNote {
  tick: number;
  velocity: number;
}

export interface RecordedTake {
  notes: Note[];
  controls: ControlEvent[];
  start: number;
  end: number;
}

export class RecordingBuffer {
  private readonly open = new Map<number, OpenNote[]>();
  private readonly notes: Note[] = [];
  private readonly controls: ControlEvent[] = [];
  private firstTick = Infinity;
  private lastTick = -Infinity;

  constructor(private readonly filter: RecordFilter = DEFAULT_RECORD_FILTER) {}

  get isEmpty(): boolean {
    return this.notes.length === 0 && this.controls.length === 0 && this.open.size === 0;
  }

  add(msg: MidiMessage, tick: number): void {
    if ('channel' in msg && this.filter.channel !== null && msg.channel !== this.filter.channel) return;
    tick = Math.max(0, Math.round(tick));
    const touch = () => {
      this.firstTick = Math.min(this.firstTick, tick);
      this.lastTick = Math.max(this.lastTick, tick);
    };
    switch (msg.type) {
      case 'noteOn': {
        // A repeated note-on for a held key ends the previous one (common with some controllers).
        const list = this.open.get(msg.note) ?? [];
        if (list.length) this.closeNote(msg.note, tick, 64);
        this.open.set(msg.note, [...(this.open.get(msg.note) ?? []), { tick, velocity: msg.velocity }]);
        touch();
        break;
      }
      case 'noteOff':
        if (this.closeNote(msg.note, tick, msg.velocity)) touch();
        break;
      case 'cc': {
        const isPedal =
          msg.controller === CC.SUSTAIN || msg.controller === CC.SOSTENUTO || msg.controller === CC.SOFT;
        if (isPedal ? !this.filter.pedals : !this.filter.controllers) return;
        // Channel mode messages are not musical data.
        if (msg.controller >= 120) return;
        this.controls.push(createControl({ tick, kind: 'cc', controller: msg.controller, value: msg.value }));
        touch();
        break;
      }
      case 'pitchBend':
        if (!this.filter.pitchBend) return;
        this.controls.push(createControl({ tick, kind: 'pitchBend', value: msg.value }));
        touch();
        break;
      case 'channelPressure':
        if (!this.filter.aftertouch) return;
        this.controls.push(createControl({ tick, kind: 'channelPressure', value: msg.value }));
        touch();
        break;
      case 'polyPressure':
        if (!this.filter.aftertouch) return;
        this.controls.push(
          createControl({ tick, kind: 'polyPressure', controller: msg.note, value: msg.value }),
        );
        touch();
        break;
      case 'programChange':
        if (!this.filter.programChange) return;
        this.controls.push(createControl({ tick, kind: 'programChange', value: msg.program }));
        touch();
        break;
      default:
        break;
    }
  }

  private closeNote(pitch: number, tick: number, releaseVelocity: number): boolean {
    const list = this.open.get(pitch);
    const start = list?.shift();
    if (!list?.length) this.open.delete(pitch);
    if (!start) return false;
    this.notes.push(
      createNote({
        pitch,
        tick: start.tick,
        duration: Math.max(1, tick - start.tick),
        velocity: start.velocity,
        releaseVelocity,
      }),
    );
    return true;
  }

  /**
   * Called when loop playback jumps from `loopEnd` back to `loopStart` while recording:
   * held notes are closed at the loop end and continue from the loop start.
   */
  wrap(loopEnd: number, loopStart: number): void {
    for (const [pitch, list] of [...this.open]) {
      const held = [...list];
      for (let i = 0; i < held.length; i++) this.closeNote(pitch, loopEnd, 64);
      this.open.set(
        pitch,
        held.map((h) => ({ tick: loopStart, velocity: h.velocity })),
      );
    }
    this.lastTick = loopStart;
  }

  /** Notes that are still held, drawn up to `currentTick` for live display. */
  pending(currentTick: number): Note[] {
    const out: Note[] = [];
    for (const [pitch, list] of this.open)
      for (const o of list)
        out.push({
          id: `rec-${pitch}-${o.tick}`,
          pitch,
          tick: o.tick,
          duration: Math.max(1, currentTick - o.tick),
          velocity: o.velocity,
          releaseVelocity: 64,
        });
    return out;
  }

  /** Completed notes so far (for live display). */
  completed(): readonly Note[] {
    return this.notes;
  }

  finish(endTick: number): RecordedTake {
    for (const pitch of [...this.open.keys()]) {
      while (this.open.get(pitch)?.length) this.closeNote(pitch, endTick, 64);
    }
    const notes = sortNotes([...this.notes]);
    const controls = thinControls(sortControls([...this.controls]));
    const start = Number.isFinite(this.firstTick) ? this.firstTick : 0;
    const end = Math.max(endTick, ...notes.map((n) => n.tick + n.duration), start);
    return { notes, controls, start, end };
  }
}

export type RecordMode = 'overdub' | 'replace';

/**
 * Merges a recorded take into a track. In `replace` mode everything that started inside
 * the recorded range is removed first (like a tape punch-in).
 */
export function mergeTake(
  track: Pick<Track, 'notes' | 'controls'>,
  take: RecordedTake,
  mode: RecordMode,
  range: { start: number; end: number },
): { notes: Note[]; controls: ControlEvent[] } {
  let notes = [...track.notes];
  let controls = [...track.controls];
  if (mode === 'replace') {
    notes = notes.filter((n) => n.tick < range.start || n.tick >= range.end);
    const recordedLanes = new Set(take.controls.map((c) => `${c.kind}:${c.controller}`));
    controls = controls.filter(
      (c) => c.tick < range.start || c.tick >= range.end || !recordedLanes.has(`${c.kind}:${c.controller}`),
    );
  }
  return {
    notes: sortNotes([...notes, ...take.notes]),
    controls: sortControls([...controls, ...take.controls]),
  };
}

/** Keeps the last few seconds of played MIDI so it can be "captured" after the fact. */
export class CaptureBuffer {
  private events: { time: number; msg: MidiMessage }[] = [];

  constructor(private readonly maxSeconds = 120) {}

  push(msg: MidiMessage, time: number): void {
    this.events.push({ time, msg });
    const cutoff = time - this.maxSeconds;
    if (this.events.length > 4096 && this.events[0].time < cutoff) {
      this.events = this.events.filter((e) => e.time >= cutoff);
    }
  }

  get size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }

  /**
   * Converts the buffered performance (since the last pause longer than `gapSeconds`)
   * into a take positioned at `atTick`, using `secondsToTicks` for the time conversion.
   */
  capture(
    atTick: number,
    ticksPerSecond: number,
    gapSeconds = 8,
    filter = DEFAULT_RECORD_FILTER,
  ): RecordedTake | null {
    if (this.events.length === 0) return null;
    let startIndex = 0;
    for (let i = this.events.length - 1; i > 0; i--) {
      if (this.events[i].time - this.events[i - 1].time > gapSeconds) {
        startIndex = i;
        break;
      }
    }
    const slice = this.events.slice(startIndex);
    const firstNote = slice.find((e) => e.msg.type === 'noteOn');
    if (!firstNote) return null;
    const t0 = firstNote.time;
    const buffer = new RecordingBuffer(filter);
    for (const e of slice) buffer.add(e.msg, atTick + Math.max(0, (e.time - t0) * ticksPerSecond));
    const last = slice[slice.length - 1].time;
    return buffer.finish(atTick + (last - t0) * ticksPerSecond);
  }
}
