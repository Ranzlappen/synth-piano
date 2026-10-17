// Project data model. Everything here is plain JSON-serialisable data so it can be
// saved to disk, diffed by immer for undo/redo and shared between processes.

/** Internal timeline resolution (ticks per quarter note). High enough for live recording. */
export const PPQ = 960;

export type ControlKind = 'cc' | 'pitchBend' | 'channelPressure' | 'polyPressure' | 'programChange';

export interface Note {
  id: string;
  /** MIDI note number 0..127 (60 = middle C, C4). */
  pitch: number;
  /** Start position in ticks. */
  tick: number;
  /** Length in ticks (> 0). */
  duration: number;
  /** Note-on velocity 1..127. */
  velocity: number;
  /** Note-off (release) velocity 0..127. 64 when the device does not send one. */
  releaseVelocity: number;
}

export interface ControlEvent {
  id: string;
  tick: number;
  kind: ControlKind;
  /** Controller number for `cc`, note number for `polyPressure`, otherwise 0. */
  controller: number;
  /** cc/pressure/program: 0..127, pitchBend: -8192..8191. */
  value: number;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  /** MIDI channel 0..15. */
  channel: number;
  /** General MIDI program 0..127. */
  program: number;
  /** Initial CC7 volume 0..127. */
  volume: number;
  /** Initial CC10 pan 0..127 (64 = centre). */
  pan: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  /** 'internal' for the built-in synth, otherwise a MIDI output port name. */
  output: string;
  notes: Note[];
  controls: ControlEvent[];
}

export interface TempoEvent {
  tick: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface TimeSignatureEvent {
  /** Must be on a bar boundary of the preceding signature. */
  tick: number;
  numerator: number;
  denominator: number;
}

export interface KeySignatureEvent {
  tick: number;
  /** -7..7, number of sharps (positive) or flats (negative). */
  fifths: number;
  mode: 'major' | 'minor';
}

export interface Marker {
  id: string;
  tick: number;
  name: string;
}

export interface ProjectMeta {
  title: string;
  subtitle: string;
  composer: string;
  arranger: string;
  copyright: string;
}

export interface LoopRange {
  enabled: boolean;
  start: number;
  end: number;
}

export interface Project {
  format: 'synth-piano-project';
  version: 1;
  ppq: number;
  meta: ProjectMeta;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
  keySignatures: KeySignatureEvent[];
  markers: Marker[];
  tracks: Track[];
  loop: LoopRange;
  /** Last used sheet music export settings (partial, merged with defaults). */
  sheetExport?: Record<string, unknown>;
}

export const TRACK_COLORS = [
  '#4f9dff',
  '#ff8a3d',
  '#3ddc97',
  '#e55cff',
  '#ffd23d',
  '#ff4f6d',
  '#3dd6ff',
  '#a98bff',
  '#8fdc3d',
  '#ff7ac6',
];

let idCounter = 0;
/** Short unique id, unique within a session and practically unique across saves. */
export function newId(prefix = ''): string {
  idCounter = (idCounter + 1) % 0x100000;
  const rand = Math.floor(Math.random() * 0x1000000).toString(36);
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function createTrack(partial: Partial<Track> = {}, index = 0): Track {
  return {
    id: newId('t'),
    name: `Track ${index + 1}`,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    channel: 0,
    program: 0,
    volume: 100,
    pan: 64,
    mute: false,
    solo: false,
    armed: index === 0,
    output: 'internal',
    notes: [],
    controls: [],
    ...partial,
  };
}

export function createProject(partial: Partial<Project> = {}): Project {
  return {
    format: 'synth-piano-project',
    version: 1,
    ppq: PPQ,
    meta: { title: 'Untitled', subtitle: '', composer: '', arranger: '', copyright: '' },
    tempos: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    keySignatures: [{ tick: 0, fifths: 0, mode: 'major' }],
    markers: [],
    tracks: [createTrack({ name: 'Piano' }, 0)],
    loop: { enabled: false, start: 0, end: PPQ * 16 },
    ...partial,
  };
}

export function createNote(partial: Omit<Note, 'id' | 'releaseVelocity'> & Partial<Note>): Note {
  return { id: newId('n'), releaseVelocity: 64, ...partial };
}

export function createControl(
  partial: Omit<ControlEvent, 'id' | 'controller'> & Partial<ControlEvent>,
): ControlEvent {
  return { id: newId('c'), controller: 0, ...partial };
}

export const byTick = <T extends { tick: number }>(a: T, b: T): number => a.tick - b.tick;

/** Sort notes by start, then pitch — the canonical order used everywhere. */
export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

export function sortControls(controls: ControlEvent[]): ControlEvent[] {
  return controls.sort((a, b) => a.tick - b.tick);
}

/** Last tick that contains musical data in the project. */
export function projectEndTick(project: Project): number {
  let end = 0;
  for (const t of project.tracks) {
    for (const n of t.notes) end = Math.max(end, n.tick + n.duration);
    for (const c of t.controls) end = Math.max(end, c.tick);
  }
  return end;
}

/** Tracks that should be heard, honouring mute and solo. */
export function audibleTracks(project: Project): Track[] {
  const soloed = project.tracks.some((t) => t.solo);
  return project.tracks.filter((t) => (soloed ? t.solo : !t.mute));
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
