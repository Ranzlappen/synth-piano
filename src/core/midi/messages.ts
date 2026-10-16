// Decoding/encoding of raw MIDI 1.0 byte messages as delivered by Web MIDI.

export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'polyPressure'; channel: number; note: number; value: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'channelPressure'; channel: number; value: number }
  | { type: 'pitchBend'; channel: number; value: number }
  | { type: 'sysex'; data: Uint8Array }
  | { type: 'clock' | 'start' | 'continue' | 'stop' | 'activeSensing' | 'reset' }
  | { type: 'songPosition'; beats: number }
  | { type: 'unknown'; data: Uint8Array };

export function decodeMidi(data: ArrayLike<number>): MidiMessage {
  const status = data[0] ?? 0;
  if (status === 0xf0) return { type: 'sysex', data: Uint8Array.from(data) };
  switch (status) {
    case 0xf8:
      return { type: 'clock' };
    case 0xfa:
      return { type: 'start' };
    case 0xfb:
      return { type: 'continue' };
    case 0xfc:
      return { type: 'stop' };
    case 0xfe:
      return { type: 'activeSensing' };
    case 0xff:
      return { type: 'reset' };
    case 0xf2:
      return { type: 'songPosition', beats: (data[1] ?? 0) | ((data[2] ?? 0) << 7) };
  }
  const channel = status & 0x0f;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;
  switch (status & 0xf0) {
    case 0x80:
      return { type: 'noteOff', channel, note: d1, velocity: d2 };
    case 0x90:
      return d2 === 0
        ? { type: 'noteOff', channel, note: d1, velocity: 64 }
        : { type: 'noteOn', channel, note: d1, velocity: d2 };
    case 0xa0:
      return { type: 'polyPressure', channel, note: d1, value: d2 };
    case 0xb0:
      return { type: 'cc', channel, controller: d1, value: d2 };
    case 0xc0:
      return { type: 'programChange', channel, program: d1 };
    case 0xd0:
      return { type: 'channelPressure', channel, value: d1 };
    case 0xe0:
      return { type: 'pitchBend', channel, value: ((d2 << 7) | d1) - 8192 };
  }
  return { type: 'unknown', data: Uint8Array.from(data) };
}

export function encodeMidi(msg: MidiMessage): number[] {
  switch (msg.type) {
    case 'noteOn':
      return [0x90 | msg.channel, msg.note & 0x7f, Math.max(1, msg.velocity & 0x7f)];
    case 'noteOff':
      return [0x80 | msg.channel, msg.note & 0x7f, msg.velocity & 0x7f];
    case 'polyPressure':
      return [0xa0 | msg.channel, msg.note & 0x7f, msg.value & 0x7f];
    case 'cc':
      return [0xb0 | msg.channel, msg.controller & 0x7f, msg.value & 0x7f];
    case 'programChange':
      return [0xc0 | msg.channel, msg.program & 0x7f];
    case 'channelPressure':
      return [0xd0 | msg.channel, msg.value & 0x7f];
    case 'pitchBend': {
      const v = Math.max(0, Math.min(16383, Math.round(msg.value) + 8192));
      return [0xe0 | msg.channel, v & 0x7f, v >> 7];
    }
    case 'sysex':
      return Array.from(msg.data);
    case 'clock':
      return [0xf8];
    case 'start':
      return [0xfa];
    case 'continue':
      return [0xfb];
    case 'stop':
      return [0xfc];
    case 'activeSensing':
      return [0xfe];
    case 'reset':
      return [0xff];
    case 'songPosition':
      return [0xf2, msg.beats & 0x7f, (msg.beats >> 7) & 0x7f];
    case 'unknown':
      return Array.from(msg.data);
  }
}

export function isChannelMessage(
  msg: MidiMessage,
): msg is Extract<MidiMessage, { channel: number }> {
  return 'channel' in msg;
}

export function withChannel<T extends MidiMessage>(msg: T, channel: number): T {
  return isChannelMessage(msg) ? { ...msg, channel } : msg;
}

export function describeMidi(msg: MidiMessage): string {
  switch (msg.type) {
    case 'noteOn':
      return `Note On  ch${msg.channel + 1} ${msg.note} vel ${msg.velocity}`;
    case 'noteOff':
      return `Note Off ch${msg.channel + 1} ${msg.note} vel ${msg.velocity}`;
    case 'cc':
      return `CC${msg.controller} ch${msg.channel + 1} = ${msg.value}`;
    case 'pitchBend':
      return `Pitch Bend ch${msg.channel + 1} ${msg.value}`;
    case 'programChange':
      return `Program ch${msg.channel + 1} ${msg.program + 1}`;
    case 'channelPressure':
      return `Aftertouch ch${msg.channel + 1} ${msg.value}`;
    case 'polyPressure':
      return `Poly AT ch${msg.channel + 1} ${msg.note} ${msg.value}`;
    case 'sysex':
      return `SysEx (${msg.data.length} bytes)`;
    default:
      return msg.type;
  }
}

/** Velocity response curves applied to incoming / on-screen velocities. */
export type VelocityCurve = 'linear' | 'soft' | 'hard' | 'fixed';

export function applyVelocityCurve(velocity: number, curve: VelocityCurve, fixed = 100): number {
  const x = Math.max(1, Math.min(127, velocity)) / 127;
  let y: number;
  switch (curve) {
    case 'soft':
      y = Math.pow(x, 0.6); // easier to play loud
      break;
    case 'hard':
      y = Math.pow(x, 1.6); // need more force for loud
      break;
    case 'fixed':
      return Math.max(1, Math.min(127, Math.round(fixed)));
    default:
      y = x;
  }
  return Math.max(1, Math.min(127, Math.round(y * 127)));
}
