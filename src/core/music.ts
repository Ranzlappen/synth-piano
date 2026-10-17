// Music theory helpers shared by the editor, the controller surface and the notation engine.

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PITCH_CLASS_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Scientific pitch notation, MIDI 60 = C4. */
export function noteName(pitch: number, flats = false): string {
  const names = flats ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES;
  return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function parseNoteName(name: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const pitch = (Number(m[3]) + 1) * 12 + base + acc;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}

export const isBlackKey = (pitch: number): boolean => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

export function midiToFrequency(pitch: number, a4 = 440): number {
  return a4 * Math.pow(2, (pitch - 69) / 12);
}

export const GM_PROGRAMS = [
  'Acoustic Grand Piano',
  'Bright Acoustic Piano',
  'Electric Grand Piano',
  'Honky-tonk Piano',
  'Electric Piano 1',
  'Electric Piano 2',
  'Harpsichord',
  'Clavinet',
  'Celesta',
  'Glockenspiel',
  'Music Box',
  'Vibraphone',
  'Marimba',
  'Xylophone',
  'Tubular Bells',
  'Dulcimer',
  'Drawbar Organ',
  'Percussive Organ',
  'Rock Organ',
  'Church Organ',
  'Reed Organ',
  'Accordion',
  'Harmonica',
  'Tango Accordion',
  'Acoustic Guitar (nylon)',
  'Acoustic Guitar (steel)',
  'Electric Guitar (jazz)',
  'Electric Guitar (clean)',
  'Electric Guitar (muted)',
  'Overdriven Guitar',
  'Distortion Guitar',
  'Guitar Harmonics',
  'Acoustic Bass',
  'Electric Bass (finger)',
  'Electric Bass (pick)',
  'Fretless Bass',
  'Slap Bass 1',
  'Slap Bass 2',
  'Synth Bass 1',
  'Synth Bass 2',
  'Violin',
  'Viola',
  'Cello',
  'Contrabass',
  'Tremolo Strings',
  'Pizzicato Strings',
  'Orchestral Harp',
  'Timpani',
  'String Ensemble 1',
  'String Ensemble 2',
  'Synth Strings 1',
  'Synth Strings 2',
  'Choir Aahs',
  'Voice Oohs',
  'Synth Choir',
  'Orchestra Hit',
  'Trumpet',
  'Trombone',
  'Tuba',
  'Muted Trumpet',
  'French Horn',
  'Brass Section',
  'Synth Brass 1',
  'Synth Brass 2',
  'Soprano Sax',
  'Alto Sax',
  'Tenor Sax',
  'Baritone Sax',
  'Oboe',
  'English Horn',
  'Bassoon',
  'Clarinet',
  'Piccolo',
  'Flute',
  'Recorder',
  'Pan Flute',
  'Blown Bottle',
  'Shakuhachi',
  'Whistle',
  'Ocarina',
  'Lead 1 (square)',
  'Lead 2 (sawtooth)',
  'Lead 3 (calliope)',
  'Lead 4 (chiff)',
  'Lead 5 (charang)',
  'Lead 6 (voice)',
  'Lead 7 (fifths)',
  'Lead 8 (bass + lead)',
  'Pad 1 (new age)',
  'Pad 2 (warm)',
  'Pad 3 (polysynth)',
  'Pad 4 (choir)',
  'Pad 5 (bowed)',
  'Pad 6 (metallic)',
  'Pad 7 (halo)',
  'Pad 8 (sweep)',
  'FX 1 (rain)',
  'FX 2 (soundtrack)',
  'FX 3 (crystal)',
  'FX 4 (atmosphere)',
  'FX 5 (brightness)',
  'FX 6 (goblins)',
  'FX 7 (echoes)',
  'FX 8 (sci-fi)',
  'Sitar',
  'Banjo',
  'Shamisen',
  'Koto',
  'Kalimba',
  'Bagpipe',
  'Fiddle',
  'Shanai',
  'Tinkle Bell',
  'Agogo',
  'Steel Drums',
  'Woodblock',
  'Taiko Drum',
  'Melodic Tom',
  'Synth Drum',
  'Reverse Cymbal',
  'Guitar Fret Noise',
  'Breath Noise',
  'Seashore',
  'Bird Tweet',
  'Telephone Ring',
  'Helicopter',
  'Applause',
  'Gunshot',
];

/** Well known controller numbers with friendly names. */
export const CC_NAMES: Record<number, string> = {
  0: 'Bank Select',
  1: 'Modulation',
  2: 'Breath',
  4: 'Foot Controller',
  5: 'Portamento Time',
  7: 'Volume',
  8: 'Balance',
  10: 'Pan',
  11: 'Expression',
  64: 'Sustain Pedal',
  65: 'Portamento',
  66: 'Sostenuto Pedal',
  67: 'Soft Pedal',
  68: 'Legato',
  71: 'Resonance',
  72: 'Release Time',
  73: 'Attack Time',
  74: 'Brightness',
  91: 'Reverb',
  93: 'Chorus',
  120: 'All Sound Off',
  121: 'Reset Controllers',
  123: 'All Notes Off',
};

export function ccName(cc: number): string {
  return CC_NAMES[cc] ? `${CC_NAMES[cc]} (CC${cc})` : `CC${cc}`;
}

export const CC = {
  MODULATION: 1,
  BREATH: 2,
  FOOT: 4,
  VOLUME: 7,
  PAN: 10,
  EXPRESSION: 11,
  SUSTAIN: 64,
  SOSTENUTO: 66,
  SOFT: 67,
  ALL_SOUND_OFF: 120,
  RESET_CONTROLLERS: 121,
  ALL_NOTES_OFF: 123,
} as const;

export interface ChordType {
  id: string;
  label: string;
  intervals: number[];
}

export const CHORD_TYPES: ChordType[] = [
  { id: 'maj', label: 'maj', intervals: [0, 4, 7] },
  { id: 'min', label: 'm', intervals: [0, 3, 7] },
  { id: 'dim', label: 'dim', intervals: [0, 3, 6] },
  { id: 'aug', label: 'aug', intervals: [0, 4, 8] },
  { id: 'sus2', label: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', label: 'sus4', intervals: [0, 5, 7] },
  { id: '7', label: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', label: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7', label: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'm7b5', label: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', label: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'add9', label: 'add9', intervals: [0, 4, 7, 14] },
  { id: '6', label: '6', intervals: [0, 4, 7, 9] },
  { id: 'm6', label: 'm6', intervals: [0, 3, 7, 9] },
  { id: '9', label: '9', intervals: [0, 4, 7, 10, 14] },
  { id: '5', label: '5 (power)', intervals: [0, 7, 12] },
];

export function chordPitches(root: number, typeId: string, inversion = 0): number[] {
  const type = CHORD_TYPES.find((c) => c.id === typeId) ?? CHORD_TYPES[0];
  const pitches = type.intervals.map((i) => root + i);
  for (let i = 0; i < inversion % pitches.length; i++) {
    const p = pitches.shift()!;
    pitches.push(p + 12);
  }
  return pitches.filter((p) => p >= 0 && p <= 127);
}

export function chordLabel(root: number, typeId: string): string {
  const type = CHORD_TYPES.find((c) => c.id === typeId) ?? CHORD_TYPES[0];
  const name = PITCH_CLASS_NAMES[root % 12];
  return type.id === 'maj' ? name : `${name}${type.label}`;
}

export interface ScaleType {
  id: string;
  label: string;
  steps: number[];
}

export const SCALES: ScaleType[] = [
  { id: 'chromatic', label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'major', label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodic', label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'pentatonic', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minpentatonic', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
];

export function inScale(pitch: number, root: number, scaleId: string): boolean {
  const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
  return scale.steps.includes((((pitch - root) % 12) + 12) % 12);
}

/** Dynamic markings and the velocity at their centre (MuseScore/Finale convention). */
export const DYNAMIC_LEVELS = [
  { mark: 'ppp', velocity: 16 },
  { mark: 'pp', velocity: 33 },
  { mark: 'p', velocity: 49 },
  { mark: 'mp', velocity: 64 },
  { mark: 'mf', velocity: 80 },
  { mark: 'f', velocity: 96 },
  { mark: 'ff', velocity: 112 },
  { mark: 'fff', velocity: 126 },
] as const;

export type DynamicMark = (typeof DYNAMIC_LEVELS)[number]['mark'];

/** Index into DYNAMIC_LEVELS for a velocity. */
export function dynamicLevelIndex(velocity: number): number {
  let best = 0;
  for (let i = 1; i < DYNAMIC_LEVELS.length; i++) {
    const boundary = (DYNAMIC_LEVELS[i - 1].velocity + DYNAMIC_LEVELS[i].velocity) / 2;
    if (velocity >= boundary) best = i;
  }
  return best;
}

/** Italian tempo term commonly associated with a quarter-note tempo. */
export function tempoTerm(bpm: number): string {
  if (bpm < 40) return 'Grave';
  if (bpm < 60) return 'Largo';
  if (bpm < 66) return 'Larghetto';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 156) return 'Allegro';
  if (bpm < 176) return 'Vivace';
  if (bpm < 200) return 'Presto';
  return 'Prestissimo';
}

export const KEY_NAMES_MAJOR: Record<number, string> = {
  [-7]: 'Cb major',
  [-6]: 'Gb major',
  [-5]: 'Db major',
  [-4]: 'Ab major',
  [-3]: 'Eb major',
  [-2]: 'Bb major',
  [-1]: 'F major',
  0: 'C major',
  1: 'G major',
  2: 'D major',
  3: 'A major',
  4: 'E major',
  5: 'B major',
  6: 'F# major',
  7: 'C# major',
};

export const KEY_NAMES_MINOR: Record<number, string> = {
  [-7]: 'Ab minor',
  [-6]: 'Eb minor',
  [-5]: 'Bb minor',
  [-4]: 'F minor',
  [-3]: 'C minor',
  [-2]: 'G minor',
  [-1]: 'D minor',
  0: 'A minor',
  1: 'E minor',
  2: 'B minor',
  3: 'F# minor',
  4: 'C# minor',
  5: 'G# minor',
  6: 'D# minor',
  7: 'A# minor',
};

export function keyName(fifths: number, mode: 'major' | 'minor'): string {
  return (mode === 'minor' ? KEY_NAMES_MINOR : KEY_NAMES_MAJOR)[fifths] ?? `${fifths} fifths`;
}

/** Tonic pitch class for a key signature. */
export function keyTonic(fifths: number, mode: 'major' | 'minor'): number {
  const major = (((fifths * 7) % 12) + 12) % 12;
  return mode === 'minor' ? (major + 9) % 12 : major;
}
