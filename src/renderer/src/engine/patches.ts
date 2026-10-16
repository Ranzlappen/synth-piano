// Sound definitions for the built-in synthesizer. Every General MIDI program is mapped
// onto one of these patches, so imported files sound reasonable without a sound font.

export interface OscDef {
  /** Built-in waveform, or 'partials' for a custom harmonic spectrum. */
  wave: OscillatorType | 'partials';
  /** Frequency ratio to the note frequency (1 = unison, 0.5 = octave down). */
  ratio: number;
  gain: number;
  detune?: number;
  /** Harmonic amplitudes for 'partials' (bright, used at high velocity). */
  partials?: number[];
  /** Harmonic amplitudes at low velocity (falls back to `partials`). */
  partialsSoft?: number[];
  /** Exponential decay time of this oscillator alone (s), for bell-like spectra. */
  decay?: number;
}

export interface PatchDef {
  id: string;
  name: string;
  oscillators: OscDef[];
  /** Frequency-modulation operator (electric piano / bell tines). */
  fm?: { ratio: number; index: number; decay: number };
  attack: number;
  /** Percussive patches decay naturally; `decay` is the time constant at middle C. */
  percussive: boolean;
  decay: number;
  sustain: number;
  release: number;
  filter: {
    cutoff: number;
    q: number;
    velocity: number;
    keytrack: number;
    envAmount: number;
    envDecay: number;
  };
  /** Hammer / pick noise at note start (0..1). */
  noise: number;
  vibrato: number;
  /** Amplitude scaling so patches have similar loudness. */
  level: number;
}

/** Piano spectrum: 1/n^p roll-off with the hammer striking at 1/7 of the string. */
function pianoPartials(p: number): number[] {
  return Array.from({ length: 24 }, (_, i) => {
    const n = i + 1;
    return (Math.abs(Math.sin((Math.PI * n) / 7.3)) + 0.08) / Math.pow(n, p);
  });
}

export const PATCHES: Record<string, PatchDef> = {
  piano: {
    id: 'piano',
    name: 'Grand Piano',
    oscillators: [
      {
        wave: 'partials',
        ratio: 1,
        gain: 0.55,
        detune: -2.5,
        partials: pianoPartials(1.05),
        partialsSoft: pianoPartials(1.9),
      },
      {
        wave: 'partials',
        ratio: 1,
        gain: 0.55,
        detune: 2.5,
        partials: pianoPartials(1.15),
        partialsSoft: pianoPartials(2.1),
      },
      { wave: 'sine', ratio: 2, gain: 0.06, detune: 4, decay: 0.6 },
    ],
    attack: 0.002,
    percussive: true,
    decay: 2.6,
    sustain: 0,
    release: 0.28,
    filter: { cutoff: 900, q: 0.4, velocity: 7000, keytrack: 0.9, envAmount: 2.2, envDecay: 0.9 },
    noise: 0.18,
    vibrato: 0,
    level: 0.9,
  },
  epiano: {
    id: 'epiano',
    name: 'Electric Piano',
    oscillators: [
      { wave: 'sine', ratio: 1, gain: 0.8 },
      { wave: 'sine', ratio: 1, gain: 0.25, detune: 6 },
    ],
    fm: { ratio: 14, index: 1.6, decay: 0.35 },
    attack: 0.002,
    percussive: true,
    decay: 2.2,
    sustain: 0,
    release: 0.35,
    filter: { cutoff: 2500, q: 0.3, velocity: 6000, keytrack: 0.5, envAmount: 0.8, envDecay: 0.6 },
    noise: 0.04,
    vibrato: 0,
    level: 0.85,
  },
  clav: {
    id: 'clav',
    name: 'Harpsichord / Clavinet',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.45 },
      { wave: 'square', ratio: 2, gain: 0.15 },
    ],
    attack: 0.001,
    percussive: true,
    decay: 1.4,
    sustain: 0,
    release: 0.12,
    filter: { cutoff: 2200, q: 2, velocity: 4000, keytrack: 0.6, envAmount: 2, envDecay: 0.25 },
    noise: 0.12,
    vibrato: 0,
    level: 0.6,
  },
  mallet: {
    id: 'mallet',
    name: 'Mallets / Bells',
    oscillators: [
      { wave: 'sine', ratio: 1, gain: 0.7 },
      { wave: 'sine', ratio: 3.99, gain: 0.25, decay: 0.25 },
      { wave: 'sine', ratio: 10.6, gain: 0.08, decay: 0.08 },
    ],
    attack: 0.001,
    percussive: true,
    decay: 1.8,
    sustain: 0,
    release: 0.6,
    filter: { cutoff: 6000, q: 0.2, velocity: 5000, keytrack: 0.3, envAmount: 0.4, envDecay: 0.4 },
    noise: 0.06,
    vibrato: 0,
    level: 0.75,
  },
  organ: {
    id: 'organ',
    name: 'Organ',
    oscillators: [
      {
        wave: 'partials',
        ratio: 1,
        gain: 0.5,
        partials: [1, 0.85, 0.6, 0.55, 0.35, 0.3, 0.12, 0.3, 0.1, 0.08, 0, 0.15],
      },
      { wave: 'sine', ratio: 0.5, gain: 0.28 },
      { wave: 'partials', ratio: 1, gain: 0.25, detune: 7, partials: [1, 0.6, 0.4, 0.3] },
    ],
    attack: 0.012,
    percussive: false,
    decay: 0.1,
    sustain: 1,
    release: 0.06,
    filter: { cutoff: 6000, q: 0.3, velocity: 0, keytrack: 0.2, envAmount: 0, envDecay: 1 },
    noise: 0.02,
    vibrato: 5,
    level: 0.5,
  },
  pluck: {
    id: 'pluck',
    name: 'Plucked String',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.45 },
      { wave: 'triangle', ratio: 1, gain: 0.35, detune: 5 },
    ],
    attack: 0.002,
    percussive: true,
    decay: 1.6,
    sustain: 0,
    release: 0.18,
    filter: { cutoff: 700, q: 1.2, velocity: 4500, keytrack: 0.8, envAmount: 3, envDecay: 0.18 },
    noise: 0.1,
    vibrato: 0,
    level: 0.75,
  },
  bass: {
    id: 'bass',
    name: 'Bass',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.4 },
      { wave: 'sine', ratio: 1, gain: 0.55 },
      { wave: 'sine', ratio: 0.5, gain: 0.25 },
    ],
    attack: 0.004,
    percussive: true,
    decay: 2.2,
    sustain: 0.2,
    release: 0.1,
    filter: { cutoff: 380, q: 1.6, velocity: 1800, keytrack: 0.4, envAmount: 2.5, envDecay: 0.22 },
    noise: 0.05,
    vibrato: 0,
    level: 0.8,
  },
  strings: {
    id: 'strings',
    name: 'Strings',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.3, detune: -9 },
      { wave: 'sawtooth', ratio: 1, gain: 0.3, detune: 8 },
      { wave: 'sawtooth', ratio: 1, gain: 0.2, detune: 1 },
    ],
    attack: 0.22,
    percussive: false,
    decay: 0.6,
    sustain: 0.85,
    release: 0.6,
    filter: { cutoff: 1800, q: 0.5, velocity: 2500, keytrack: 0.5, envAmount: 0.3, envDecay: 0.8 },
    noise: 0,
    vibrato: 6,
    level: 0.55,
  },
  pad: {
    id: 'pad',
    name: 'Warm Pad',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.25, detune: -12 },
      { wave: 'sawtooth', ratio: 1, gain: 0.25, detune: 12 },
      { wave: 'triangle', ratio: 0.5, gain: 0.35 },
    ],
    attack: 0.45,
    percussive: false,
    decay: 1,
    sustain: 0.9,
    release: 1.2,
    filter: { cutoff: 1100, q: 0.7, velocity: 1500, keytrack: 0.4, envAmount: 0.6, envDecay: 1.5 },
    noise: 0,
    vibrato: 3,
    level: 0.55,
  },
  brass: {
    id: 'brass',
    name: 'Brass',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.45, detune: -4 },
      { wave: 'sawtooth', ratio: 1, gain: 0.35, detune: 4 },
    ],
    attack: 0.045,
    percussive: false,
    decay: 0.3,
    sustain: 0.8,
    release: 0.18,
    filter: { cutoff: 700, q: 1, velocity: 3500, keytrack: 0.6, envAmount: 2.2, envDecay: 0.25 },
    noise: 0.03,
    vibrato: 4,
    level: 0.55,
  },
  reed: {
    id: 'reed',
    name: 'Reed / Flute',
    oscillators: [
      { wave: 'square', ratio: 1, gain: 0.3 },
      { wave: 'sine', ratio: 1, gain: 0.5 },
    ],
    attack: 0.04,
    percussive: false,
    decay: 0.2,
    sustain: 0.85,
    release: 0.12,
    filter: { cutoff: 1500, q: 0.8, velocity: 3000, keytrack: 0.7, envAmount: 0.6, envDecay: 0.3 },
    noise: 0.05,
    vibrato: 7,
    level: 0.6,
  },
  lead: {
    id: 'lead',
    name: 'Synth Lead',
    oscillators: [
      { wave: 'sawtooth', ratio: 1, gain: 0.35, detune: -6 },
      { wave: 'square', ratio: 1, gain: 0.25, detune: 6 },
    ],
    attack: 0.006,
    percussive: false,
    decay: 0.25,
    sustain: 0.75,
    release: 0.15,
    filter: { cutoff: 1400, q: 3, velocity: 4000, keytrack: 0.5, envAmount: 1.6, envDecay: 0.3 },
    noise: 0,
    vibrato: 4,
    level: 0.5,
  },
};

/** General MIDI program -> patch id. */
export function patchForProgram(program: number): PatchDef {
  const p = program & 0x7f;
  let id: string;
  if (p <= 3) id = 'piano';
  else if (p <= 5) id = 'epiano';
  else if (p <= 7) id = 'clav';
  else if (p <= 15) id = 'mallet';
  else if (p <= 23) id = 'organ';
  else if (p <= 31) id = 'pluck';
  else if (p <= 39) id = 'bass';
  else if (p === 45 || p === 46) id = 'pluck';
  else if (p === 47) id = 'bass';
  else if (p <= 51) id = 'strings';
  else if (p <= 55) id = 'pad';
  else if (p <= 63) id = 'brass';
  else if (p <= 79) id = 'reed';
  else if (p <= 87) id = 'lead';
  else if (p <= 103) id = 'pad';
  else if (p <= 111) id = 'pluck';
  else if (p <= 119) id = 'mallet';
  else id = 'pad';
  return PATCHES[id];
}
