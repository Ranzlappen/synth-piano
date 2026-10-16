import {
  clamp,
  createProject,
  createTrack,
  newId,
  PPQ,
  sortControls,
  sortNotes,
  type ControlEvent,
  type ControlKind,
  type Note,
  type Project,
  type Track,
} from './model';

export const PROJECT_EXTENSION = 'synthpiano';

export class ProjectFormatError extends Error {}

export function serializeProject(project: Project): string {
  return JSON.stringify(project);
}

type Json = Record<string, unknown>;

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : []);

const CONTROL_KINDS: ControlKind[] = ['cc', 'pitchBend', 'channelPressure', 'polyPressure', 'programChange'];

/** Parses and validates a project file, repairing anything out of range. */
export function parseProject(text: string): Project {
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('The file is not a valid project (JSON parse error).');
  }
  if (!raw || typeof raw !== 'object' || raw.format !== 'synth-piano-project') {
    throw new ProjectFormatError('The file is not a Synth Piano project.');
  }
  const version = num(raw.version, 1);
  if (version > 1) throw new ProjectFormatError(`Project version ${version} is newer than this app supports.`);

  const ppq = num(raw.ppq, PPQ, 24, 15360);
  const scale = PPQ / ppq;
  const t = (v: unknown): number => Math.max(0, Math.round(num(v, 0) * scale));

  const base = createProject();
  const meta = (raw.meta ?? {}) as Json;
  const project: Project = {
    ...base,
    meta: {
      title: str(meta.title, 'Untitled'),
      subtitle: str(meta.subtitle),
      composer: str(meta.composer),
      arranger: str(meta.arranger),
      copyright: str(meta.copyright),
    },
    tempos: arr(raw.tempos).map((e) => ({ tick: t(e.tick), bpm: num(e.bpm, 120, 10, 999) })),
    timeSignatures: arr(raw.timeSignatures).map((e) => ({
      tick: t(e.tick),
      numerator: Math.round(num(e.numerator, 4, 1, 32)),
      denominator: [1, 2, 4, 8, 16, 32].includes(e.denominator as number) ? (e.denominator as number) : 4,
    })),
    keySignatures: arr(raw.keySignatures).map((e) => ({
      tick: t(e.tick),
      fifths: Math.round(num(e.fifths, 0, -7, 7)),
      mode: e.mode === 'minor' ? ('minor' as const) : ('major' as const),
    })),
    markers: arr(raw.markers).map((e) => ({ id: str(e.id) || newId('m'), tick: t(e.tick), name: str(e.name, 'Marker') })),
    tracks: arr(raw.tracks).map((e, i) => parseTrack(e, i, t)),
    loop: (() => {
      const l = (raw.loop ?? {}) as Json;
      const start = t(l.start);
      const end = Math.max(start + 1, t(l.end ?? PPQ * 16));
      return { enabled: bool(l.enabled), start, end };
    })(),
    sheetExport: raw.sheetExport && typeof raw.sheetExport === 'object' ? (raw.sheetExport as Json) : undefined,
  };
  if (project.tempos.length === 0 || project.tempos[0].tick !== 0) project.tempos.unshift({ tick: 0, bpm: 120 });
  if (project.timeSignatures.length === 0 || project.timeSignatures[0].tick !== 0)
    project.timeSignatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
  if (project.keySignatures.length === 0) project.keySignatures.push({ tick: 0, fifths: 0, mode: 'major' });
  if (project.tracks.length === 0) project.tracks.push(createTrack({ name: 'Piano' }, 0));
  return project;
}

function parseTrack(e: Json, index: number, t: (v: unknown) => number): Track {
  const base = createTrack({}, index);
  const seen = new Set<string>();
  const uniqueId = (id: unknown, prefix: string): string => {
    let s = str(id);
    if (!s || seen.has(s)) s = newId(prefix);
    seen.add(s);
    return s;
  };
  const notes: Note[] = arr(e.notes)
    .map((n) => ({
      id: uniqueId(n.id, 'n'),
      pitch: Math.round(num(n.pitch, 60, 0, 127)),
      tick: t(n.tick),
      duration: Math.max(1, t(n.duration)),
      velocity: Math.round(num(n.velocity, 100, 1, 127)),
      releaseVelocity: Math.round(num(n.releaseVelocity, 64, 0, 127)),
    }));
  const controls: ControlEvent[] = arr(e.controls)
    .filter((c) => CONTROL_KINDS.includes(c.kind as ControlKind))
    .map((c) => {
      const kind = c.kind as ControlKind;
      return {
        id: uniqueId(c.id, 'c'),
        tick: t(c.tick),
        kind,
        controller: Math.round(num(c.controller, 0, 0, 127)),
        value: kind === 'pitchBend' ? Math.round(num(c.value, 0, -8192, 8191)) : Math.round(num(c.value, 0, 0, 127)),
      };
    });
  return {
    ...base,
    id: str(e.id) || base.id,
    name: str(e.name, base.name),
    color: /^#[0-9a-f]{6}$/i.test(str(e.color)) ? str(e.color) : base.color,
    channel: Math.round(num(e.channel, 0, 0, 15)),
    program: Math.round(num(e.program, 0, 0, 127)),
    volume: Math.round(num(e.volume, 100, 0, 127)),
    pan: Math.round(num(e.pan, 64, 0, 127)),
    mute: bool(e.mute),
    solo: bool(e.solo),
    armed: bool(e.armed),
    output: str(e.output, 'internal') || 'internal',
    notes: sortNotes(notes),
    controls: sortControls(controls),
  };
}
