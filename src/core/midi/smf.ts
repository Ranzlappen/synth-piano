// Standard MIDI File (SMF) reader/writer. Supports formats 0/1/2, running status,
// SysEx, all channel messages and meta events. Ticks are absolute.

export type SmfEvent =
  | { tick: number; type: 'noteOn'; channel: number; note: number; velocity: number }
  | { tick: number; type: 'noteOff'; channel: number; note: number; velocity: number }
  | { tick: number; type: 'polyPressure'; channel: number; note: number; value: number }
  | { tick: number; type: 'cc'; channel: number; controller: number; value: number }
  | { tick: number; type: 'programChange'; channel: number; program: number }
  | { tick: number; type: 'channelPressure'; channel: number; value: number }
  | { tick: number; type: 'pitchBend'; channel: number; value: number }
  | { tick: number; type: 'meta'; metaType: number; data: Uint8Array }
  | { tick: number; type: 'sysex'; data: Uint8Array };

export interface SmfFile {
  format: 0 | 1 | 2;
  /** Ticks per quarter note. */
  ppq: number;
  tracks: SmfEvent[][];
}

export const META = {
  TEXT: 0x01,
  COPYRIGHT: 0x02,
  TRACK_NAME: 0x03,
  INSTRUMENT: 0x04,
  LYRIC: 0x05,
  MARKER: 0x06,
  CUE: 0x07,
  CHANNEL_PREFIX: 0x20,
  END_OF_TRACK: 0x2f,
  TEMPO: 0x51,
  SMPTE_OFFSET: 0x54,
  TIME_SIGNATURE: 0x58,
  KEY_SIGNATURE: 0x59,
} as const;

export class SmfParseError extends Error {}

class Reader {
  pos = 0;
  constructor(
    readonly buf: Uint8Array,
    readonly end = buf.length,
  ) {}
  get eof(): boolean {
    return this.pos >= this.end;
  }
  u8(): number {
    if (this.pos >= this.end) throw new SmfParseError('Unexpected end of data');
    return this.buf[this.pos++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
  }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new SmfParseError('Invalid variable-length quantity');
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new SmfParseError('Unexpected end of data');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n));
  }
}

export function parseSmf(input: ArrayBuffer | Uint8Array): SmfFile {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const r = new Reader(buf);
  // Some files are wrapped in a RIFF 'RMID' container.
  if (buf.length > 20 && r.ascii(4) === 'RIFF') {
    r.pos = 12;
    while (!r.eof) {
      const id = r.ascii(4);
      const len = r.u32() ;
      if (id === 'data') return parseSmf(buf.slice(r.pos, r.pos + len));
      r.pos += len + (len & 1);
    }
    throw new SmfParseError('RIFF file contains no MIDI data');
  }
  r.pos = 0;
  if (r.ascii(4) !== 'MThd') throw new SmfParseError('Not a MIDI file (missing MThd header)');
  const headerLen = r.u32();
  const format = r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  r.pos = 8 + headerLen;

  let ppq: number;
  let smpteTicksPerSecond = 0;
  if (division & 0x8000) {
    const fps = 256 - (division >> 8);
    const tpf = division & 0xff;
    smpteTicksPerSecond = (fps === 29 ? 29.97 : fps) * tpf;
    ppq = Math.round(smpteTicksPerSecond / 2); // equivalent to 120 BPM
  } else {
    ppq = division || 480;
  }

  const tracks: SmfEvent[][] = [];
  while (!r.eof && tracks.length < nTracks) {
    if (r.pos + 8 > buf.length) break;
    const id = r.ascii(4);
    const len = r.u32();
    const end = Math.min(buf.length, r.pos + len);
    if (id !== 'MTrk') {
      r.pos = end;
      continue;
    }
    tracks.push(parseTrack(new Reader(buf.subarray(0, end)), r.pos));
    r.pos = end;
  }
  if (smpteTicksPerSecond && tracks.length) {
    // Make SMPTE-timed files play at the right speed by fixing the tempo to 120 BPM.
    tracks[0] = tracks[0].filter((e) => !(e.type === 'meta' && e.metaType === META.TEMPO));
    tracks[0].unshift({ tick: 0, type: 'meta', metaType: META.TEMPO, data: tempoBytes(120) });
  }
  return { format: (format > 2 ? 1 : format) as 0 | 1 | 2, ppq, tracks };
}

function parseTrack(r: Reader, start: number): SmfEvent[] {
  r.pos = start;
  const events: SmfEvent[] = [];
  let tick = 0;
  let running = 0;
  try {
    while (!r.eof) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        if (!running) throw new SmfParseError('Running status without previous status');
        r.pos--;
        status = running;
      }
      if (status === 0xff) {
        const metaType = r.u8();
        const len = r.vlq();
        const data = r.bytes(len);
        if (metaType === META.END_OF_TRACK) break;
        events.push({ tick, type: 'meta', metaType, data });
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const len = r.vlq();
        const data = r.bytes(len);
        events.push({ tick, type: 'sysex', data: status === 0xf0 ? concat([0xf0], data) : data });
        running = 0;
        continue;
      }
      running = status;
      const channel = status & 0x0f;
      switch (status & 0xf0) {
        case 0x80:
          events.push({ tick, type: 'noteOff', channel, note: r.u8() & 0x7f, velocity: r.u8() & 0x7f });
          break;
        case 0x90: {
          const note = r.u8() & 0x7f;
          const velocity = r.u8() & 0x7f;
          events.push(
            velocity === 0
              ? { tick, type: 'noteOff', channel, note, velocity: 64 }
              : { tick, type: 'noteOn', channel, note, velocity },
          );
          break;
        }
        case 0xa0:
          events.push({ tick, type: 'polyPressure', channel, note: r.u8() & 0x7f, value: r.u8() & 0x7f });
          break;
        case 0xb0:
          events.push({ tick, type: 'cc', channel, controller: r.u8() & 0x7f, value: r.u8() & 0x7f });
          break;
        case 0xc0:
          events.push({ tick, type: 'programChange', channel, program: r.u8() & 0x7f });
          break;
        case 0xd0:
          events.push({ tick, type: 'channelPressure', channel, value: r.u8() & 0x7f });
          break;
        case 0xe0: {
          const lsb = r.u8() & 0x7f;
          const msb = r.u8() & 0x7f;
          events.push({ tick, type: 'pitchBend', channel, value: ((msb << 7) | lsb) - 8192 });
          break;
        }
        default:
          // System common/real-time bytes are not valid in files; skip them.
          running = 0;
      }
    }
  } catch (err) {
    // Truncated tracks are common in the wild — keep what was read.
    if (!(err instanceof SmfParseError)) throw err;
  }
  return events;
}

function concat(a: number[] | Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class Writer {
  private chunks: number[] = [];
  u8(v: number): void {
    this.chunks.push(v & 0xff);
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v: number): void {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  vlq(v: number): void {
    v = Math.max(0, Math.round(v));
    const bytes = [v & 0x7f];
    while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
    for (const b of bytes) this.u8(b);
  }
  bytes(b: ArrayLike<number>): void {
    for (let i = 0; i < b.length; i++) this.u8(b[i]);
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  get length(): number {
    return this.chunks.length;
  }
  toArray(): number[] {
    return this.chunks;
  }
}

const EVENT_ORDER: Record<SmfEvent['type'], number> = {
  meta: 0,
  sysex: 1,
  programChange: 2,
  cc: 3,
  pitchBend: 3,
  channelPressure: 3,
  noteOff: 4,
  noteOn: 5,
  polyPressure: 6,
};

export function sortSmfEvents(events: SmfEvent[]): SmfEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || EVENT_ORDER[a.e.type] - EVENT_ORDER[b.e.type] || a.i - b.i)
    .map((x) => x.e);
}

export function writeSmf(file: SmfFile): Uint8Array {
  const w = new Writer();
  w.ascii('MThd');
  w.u32(6);
  w.u16(file.format);
  w.u16(file.tracks.length);
  w.u16(file.ppq);
  for (const track of file.tracks) {
    const t = new Writer();
    let last = 0;
    for (const e of sortSmfEvents(track)) {
      const tick = Math.max(0, Math.round(e.tick));
      t.vlq(tick - last);
      last = tick;
      switch (e.type) {
        case 'noteOn':
          t.bytes([0x90 | e.channel, e.note & 0x7f, Math.max(1, e.velocity & 0x7f)]);
          break;
        case 'noteOff':
          t.bytes([0x80 | e.channel, e.note & 0x7f, e.velocity & 0x7f]);
          break;
        case 'polyPressure':
          t.bytes([0xa0 | e.channel, e.note & 0x7f, e.value & 0x7f]);
          break;
        case 'cc':
          t.bytes([0xb0 | e.channel, e.controller & 0x7f, e.value & 0x7f]);
          break;
        case 'programChange':
          t.bytes([0xc0 | e.channel, e.program & 0x7f]);
          break;
        case 'channelPressure':
          t.bytes([0xd0 | e.channel, e.value & 0x7f]);
          break;
        case 'pitchBend': {
          const v = Math.max(0, Math.min(16383, e.value + 8192));
          t.bytes([0xe0 | e.channel, v & 0x7f, v >> 7]);
          break;
        }
        case 'meta':
          t.u8(0xff);
          t.u8(e.metaType);
          t.vlq(e.data.length);
          t.bytes(e.data);
          break;
        case 'sysex': {
          const body = e.data[0] === 0xf0 ? e.data.subarray(1) : e.data;
          t.u8(0xf0);
          t.vlq(body.length);
          t.bytes(body);
          break;
        }
      }
    }
    t.bytes([0x00, 0xff, META.END_OF_TRACK, 0x00]);
    w.ascii('MTrk');
    w.u32(t.length);
    w.bytes(t.toArray());
  }
  return new Uint8Array(w.toArray());
}

// ---- meta helpers ----

export function tempoBytes(bpm: number): Uint8Array {
  const us = Math.round(60_000_000 / bpm);
  return new Uint8Array([(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
}

export function readTempo(data: Uint8Array): number {
  const us = (data[0] << 16) | (data[1] << 8) | data[2];
  return us > 0 ? 60_000_000 / us : 120;
}

export function timeSignatureBytes(numerator: number, denominator: number): Uint8Array {
  return new Uint8Array([numerator, Math.round(Math.log2(denominator)), 24, 8]);
}

export function readTimeSignature(data: Uint8Array): { numerator: number; denominator: number } {
  return { numerator: data[0] || 4, denominator: Math.pow(2, data[1] ?? 2) };
}

export function keySignatureBytes(fifths: number, minor: boolean): Uint8Array {
  return new Uint8Array([fifths & 0xff, minor ? 1 : 0]);
}

export function readKeySignature(data: Uint8Array): { fifths: number; mode: 'major' | 'minor' } {
  const f = data[0] > 127 ? data[0] - 256 : data[0];
  return { fifths: Math.max(-7, Math.min(7, f)), mode: data[1] === 1 ? 'minor' : 'major' };
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function readText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return String.fromCharCode(...data);
  }
}
