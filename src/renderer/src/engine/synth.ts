// Polyphonic 16-channel synthesizer built on Web Audio. It responds to the musical
// performance data the app records: note-on/off velocity, sustain (incl. half pedal),
// sostenuto and soft pedals, volume/expression, pan, modulation, pitch bend,
// channel aftertouch and RPN pitch-bend range.

import { midiToFrequency } from '@core/music';
import type { MidiMessage } from '@core/midi/messages';
import type { AudioOut } from './audio';
import { DrumKit } from './drums';
import { patchForProgram, type PatchDef } from './patches';

const MAX_VOICES = 96;

interface ChannelState {
  program: number;
  patch: PatchDef;
  volume: number;
  expression: number;
  pan: number;
  sustain: number;
  sostenuto: boolean;
  soft: boolean;
  modulation: number;
  pressure: number;
  bend: number;
  bendRange: number;
  rpn: [number, number];
  input: GainNode;
  panner: StereoPannerNode;
  send: GainNode;
  vibratoLfo: OscillatorNode;
  vibratoDepth: GainNode;
}

interface Voice {
  channel: number;
  note: number;
  start: number;
  velocity: number;
  sources: AudioScheduledSourceNode[];
  /** Oscillators following pitch bend: [node, base detune in cents]. */
  pitched: [OscillatorNode, number][];
  amp: GainNode;
  held: boolean;
  sustained: boolean;
  sostenuto: boolean;
  releasing: boolean;
  end: number;
}

export class Synth {
  private readonly channels: ChannelState[] = [];
  private voices: Voice[] = [];
  private readonly waves = new Map<string, PeriodicWave>();
  private readonly noise: AudioBuffer;
  private readonly drums: DrumKit;

  constructor(private readonly out: AudioOut) {
    const { ctx } = out;
    for (let ch = 0; ch < 16; ch++) {
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const send = ctx.createGain();
      send.gain.value = 0.35;
      input.connect(panner).connect(out.master);
      panner.connect(send).connect(out.reverb);
      const vibratoLfo = ctx.createOscillator();
      vibratoLfo.frequency.value = 5.4;
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 0;
      vibratoLfo.connect(vibratoDepth);
      vibratoLfo.start();
      this.channels.push({
        program: 0,
        patch: patchForProgram(0),
        volume: 100,
        expression: 127,
        pan: 64,
        sustain: 0,
        sostenuto: false,
        soft: false,
        modulation: 0,
        pressure: 0,
        bend: 0,
        bendRange: 2,
        rpn: [127, 127],
        input,
        panner,
        send,
        vibratoLfo,
        vibratoDepth,
      });
      this.updateGain(ch, ctx.currentTime);
    }
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.drums = new DrumKit(ctx, this.channels[9].input, this.noise);
  }

  get activeVoices(): number {
    const now = this.out.ctx.currentTime;
    return this.voices.filter((v) => v.end > now).length;
  }

  handle(msg: MidiMessage, time?: number): void {
    const t = Math.max(time ?? 0, this.out.ctx.currentTime);
    switch (msg.type) {
      case 'noteOn':
        this.noteOn(msg.channel, msg.note, msg.velocity, t);
        break;
      case 'noteOff':
        this.noteOff(msg.channel, msg.note, msg.velocity, t);
        break;
      case 'cc':
        this.controlChange(msg.channel, msg.controller, msg.value, t);
        break;
      case 'programChange':
        this.programChange(msg.channel, msg.program);
        break;
      case 'pitchBend':
        this.pitchBend(msg.channel, msg.value, t);
        break;
      case 'channelPressure':
        this.channels[msg.channel].pressure = msg.value;
        this.updateVibrato(msg.channel, t);
        break;
      default:
        break;
    }
  }

  // ---- notes ----

  noteOn(channel: number, note: number, velocity: number, time: number): void {
    if (velocity <= 0) return this.noteOff(channel, note, 64, time);
    const ch = this.channels[channel];
    if (channel === 9) {
      this.drums.play(note, ch.soft ? velocity * 0.75 : velocity, time);
      return;
    }
    // Re-striking a key damps the previous vibration of the same string.
    for (const v of this.voices)
      if (v.channel === channel && v.note === note && !v.releasing) this.releaseVoice(v, time, 0.015);
    this.enforcePolyphony(time);
    this.voices.push(this.createVoice(channel, note, velocity, time));
  }

  noteOff(channel: number, note: number, releaseVelocity: number, time: number): void {
    if (channel === 9) return;
    const ch = this.channels[channel];
    for (const v of this.voices) {
      if (v.channel !== channel || v.note !== note || !v.held) continue;
      v.held = false;
      if (ch.sustain >= 64 || v.sostenuto) {
        v.sustained = true;
        continue;
      }
      this.releaseVoice(v, time, this.releaseTime(ch, releaseVelocity));
    }
  }

  private releaseTime(ch: ChannelState, releaseVelocity: number): number {
    // Faster key release -> shorter damping; partially pressed sustain pedal (half pedal)
    // lets strings ring longer.
    const base = ch.patch.release * (1.25 - (releaseVelocity / 127) * 0.5);
    const halfPedal = ch.sustain > 8 && ch.sustain < 64 ? 1 + (ch.sustain / 64) * 5 : 1;
    return (base * halfPedal) / 3;
  }

  private createVoice(channel: number, note: number, velocity: number, t: number): Voice {
    const { ctx } = this.out;
    const ch = this.channels[channel];
    const patch = ch.patch;
    const freq = midiToFrequency(note);
    const vel = Math.min(127, velocity * (ch.soft ? 0.78 : 1)) / 127;
    const velGain = Math.pow(vel, 1.7);
    const peak = patch.level * (0.08 + 0.92 * velGain) * 0.35;

    const amp = ctx.createGain();
    amp.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = patch.filter.q;
    const keyFactor = Math.pow(2, ((note - 60) / 12) * patch.filter.keytrack);
    const brightness = ch.soft ? 0.7 : 1;
    const cutoff = Math.min(
      18000,
      (patch.filter.cutoff + patch.filter.velocity * Math.pow(vel, 1.5)) * keyFactor * brightness,
    );
    filter.frequency.setValueAtTime(Math.min(18000, cutoff * (1 + patch.filter.envAmount)), t);
    filter.frequency.setTargetAtTime(cutoff, t + patch.attack, patch.filter.envDecay);
    filter.connect(amp).connect(ch.input);

    const sources: AudioScheduledSourceNode[] = [];
    const pitched: [OscillatorNode, number][] = [];
    const bendCents = (ch.bend / 8192) * ch.bendRange * 100;
    for (const def of patch.oscillators) {
      const osc = ctx.createOscillator();
      if (def.wave === 'partials') osc.setPeriodicWave(this.wave(def.partials!, def.partialsSoft, vel));
      else osc.type = def.wave;
      osc.frequency.value = freq * def.ratio;
      const baseDetune = def.detune ?? 0;
      osc.detune.value = baseDetune + bendCents;
      ch.vibratoDepth.connect(osc.detune);
      const g = ctx.createGain();
      g.gain.value = def.gain;
      if (def.decay) g.gain.setTargetAtTime(0, t, def.decay * Math.pow(2, -(note - 60) / 24));
      osc.connect(g).connect(filter);
      osc.start(t);
      sources.push(osc);
      pitched.push([osc, baseDetune]);
    }
    if (patch.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = freq * patch.fm.ratio;
      const index = ctx.createGain();
      const depth = freq * patch.fm.index * (0.3 + vel);
      index.gain.setValueAtTime(depth, t);
      index.gain.setTargetAtTime(depth * 0.05, t, patch.fm.decay);
      mod.connect(index);
      for (const [osc] of pitched.slice(0, 1)) index.connect(osc.frequency);
      mod.start(t);
      sources.push(mod);
    }
    if (patch.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(12000, freq * 3 + 1200);
      bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(patch.noise * velGain * 0.6, t);
      ng.gain.setTargetAtTime(0, t, 0.018);
      src.connect(bp).connect(ng).connect(filter);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.25);
    }

    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + patch.attack);
    if (patch.percussive) {
      // Lower strings ring longer.
      const tau = patch.decay * Math.pow(2, -(note - 60) / 30);
      amp.gain.setTargetAtTime(peak * patch.sustain, t + patch.attack, tau / 3);
    } else {
      amp.gain.setTargetAtTime(peak * patch.sustain, t + patch.attack, patch.decay / 3);
    }
    const end =
      patch.percussive && patch.sustain === 0
        ? t + patch.decay * Math.pow(2, -(note - 60) / 30) * 3
        : Infinity;
    if (Number.isFinite(end)) for (const s of sources) s.stop(end);
    sources[0]?.addEventListener(
      'ended',
      () => {
        for (const [osc] of pitched) {
          try {
            ch.vibratoDepth.disconnect(osc.detune);
          } catch {
            /* not connected */
          }
        }
        amp.disconnect();
      },
      { once: true },
    );
    return {
      channel,
      note,
      start: t,
      velocity,
      sources,
      pitched,
      amp,
      held: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      end,
    };
  }

  private wave(bright: number[], soft: number[] | undefined, vel: number): PeriodicWave {
    // Three velocity layers between the soft and bright spectra.
    const layer = vel < 0.4 ? 0 : vel < 0.75 ? 1 : 2;
    const key = `${bright.length}:${bright[1]}:${soft?.[1] ?? ''}:${layer}`;
    let w = this.waves.get(key);
    if (!w) {
      const mix = layer / 2;
      const amps = bright.map((b, i) => (soft ? soft[i] * (1 - mix) + b * mix : b));
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => (imag[i + 1] = a));
      w = this.out.ctx.createPeriodicWave(real, imag);
      this.waves.set(key, w);
    }
    return w;
  }

  private releaseVoice(v: Voice, time: number, tau: number): void {
    if (v.releasing) return;
    v.releasing = true;
    const g = v.amp.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(time);
    else g.cancelScheduledValues(time);
    g.setTargetAtTime(0, time, Math.max(0.005, tau));
    const stop = Math.min(v.end, time + Math.max(0.05, tau * 8));
    v.end = stop;
    for (const s of v.sources) {
      try {
        s.stop(stop);
      } catch {
        /* already stopped */
      }
    }
  }

  private enforcePolyphony(time: number): void {
    const now = this.out.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    const active = this.voices.filter((v) => !v.releasing);
    if (active.length < MAX_VOICES) return;
    // Steal the oldest released-by-pedal voice first, then the oldest overall.
    const victim = active.find((v) => !v.held) ?? active[0];
    this.releaseVoice(victim, time, 0.01);
  }

  // ---- controllers ----

  controlChange(channel: number, cc: number, value: number, time: number): void {
    const ch = this.channels[channel];
    switch (cc) {
      case 1:
        ch.modulation = value;
        this.updateVibrato(channel, time);
        break;
      case 6:
        if (ch.rpn[0] === 0 && ch.rpn[1] === 0) ch.bendRange = Math.max(0, Math.min(24, value));
        break;
      case 7:
        ch.volume = value;
        this.updateGain(channel, time);
        break;
      case 10:
        ch.pan = value;
        ch.panner.pan.setTargetAtTime((value - 64) / 63, time, 0.02);
        break;
      case 11:
        ch.expression = value;
        this.updateGain(channel, time);
        break;
      case 64: {
        const wasDown = ch.sustain >= 64;
        ch.sustain = value;
        if (wasDown && value < 64) {
          for (const v of this.voices) {
            if (v.channel === channel && v.sustained && !v.held && !v.sostenuto && !v.releasing)
              this.releaseVoice(v, time, this.releaseTime(ch, 64));
          }
        }
        break;
      }
      case 66: {
        const down = value >= 64;
        if (down && !ch.sostenuto)
          for (const v of this.voices) if (v.channel === channel && v.held) v.sostenuto = true;
        if (!down && ch.sostenuto) {
          for (const v of this.voices) {
            if (v.channel !== channel || !v.sostenuto) continue;
            v.sostenuto = false;
            if (!v.held && ch.sustain < 64) this.releaseVoice(v, time, this.releaseTime(ch, 64));
          }
        }
        ch.sostenuto = down;
        break;
      }
      case 67:
        ch.soft = value >= 64;
        break;
      case 91:
        ch.send.gain.setTargetAtTime((value / 127) * 0.9, time, 0.05);
        break;
      case 100:
        ch.rpn[1] = value;
        break;
      case 101:
        ch.rpn[0] = value;
        break;
      case 120:
        this.allSoundOff(channel);
        break;
      case 121:
        this.resetControllers(channel, time);
        break;
      case 123:
        this.allNotesOff(channel, time);
        break;
    }
  }

  pitchBend(channel: number, value: number, time: number): void {
    const ch = this.channels[channel];
    ch.bend = value;
    const cents = (value / 8192) * ch.bendRange * 100;
    for (const v of this.voices) {
      if (v.channel !== channel) continue;
      for (const [osc, base] of v.pitched) osc.detune.setTargetAtTime(base + cents, time, 0.004);
    }
  }

  programChange(channel: number, program: number): void {
    const ch = this.channels[channel];
    ch.program = program;
    ch.patch = patchForProgram(program);
    this.updateVibrato(channel, this.out.ctx.currentTime);
  }

  private updateGain(channel: number, time: number): void {
    const ch = this.channels[channel];
    const g = Math.pow(ch.volume / 127, 1.6) * Math.pow(ch.expression / 127, 1.6);
    ch.input.gain.setTargetAtTime(g, time, 0.015);
  }

  private updateVibrato(channel: number, time: number): void {
    const ch = this.channels[channel];
    const depth = ch.patch.vibrato * 0.4 + (ch.modulation / 127) * 45 + (ch.pressure / 127) * 20;
    ch.vibratoDepth.gain.setTargetAtTime(depth, time, 0.05);
  }

  resetControllers(channel: number, time: number): void {
    const ch = this.channels[channel];
    ch.expression = 127;
    ch.modulation = 0;
    ch.pressure = 0;
    ch.sostenuto = false;
    ch.soft = false;
    this.controlChange(channel, 64, 0, time);
    this.pitchBend(channel, 0, time);
    this.updateGain(channel, time);
    this.updateVibrato(channel, time);
  }

  allNotesOff(channel: number | null = null, time = this.out.ctx.currentTime): void {
    for (const v of this.voices) {
      if (channel !== null && v.channel !== channel) continue;
      v.held = false;
      v.sustained = false;
      v.sostenuto = false;
      this.releaseVoice(v, time, 0.08);
    }
  }

  allSoundOff(channel: number | null = null): void {
    const t = this.out.ctx.currentTime;
    for (const v of this.voices)
      if (channel === null || v.channel === channel) this.releaseVoice(v, t, 0.005);
    if (channel === null || channel === 9) this.drums.stopAll();
  }

  /** Stops everything and resets all channels (used by Stop and Panic). */
  panic(): void {
    const t = this.out.ctx.currentTime;
    this.allSoundOff(null);
    for (let ch = 0; ch < 16; ch++) this.resetControllers(ch, t);
  }
}
