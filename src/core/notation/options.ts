// Every parameter the sheet music exporter understands. The export dialog edits a
// SheetExportOptions object; defaults are chosen so that a typical piano recording
// produces a readable score without touching anything.

import type { Project } from '../model';
import { GM_PROGRAMS } from '../music';

export type PaperSize = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'B4' | 'Tabloid';

export const PAPER_SIZES: Record<PaperSize, { label: string; widthMm: number; heightMm: number }> = {
  A4: { label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297 },
  Letter: { label: 'US Letter (8.5 × 11 in)', widthMm: 215.9, heightMm: 279.4 },
  Legal: { label: 'US Legal (8.5 × 14 in)', widthMm: 215.9, heightMm: 355.6 },
  A3: { label: 'A3 (297 × 420 mm)', widthMm: 297, heightMm: 420 },
  A5: { label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210 },
  B4: { label: 'B4 (250 × 353 mm)', widthMm: 250, heightMm: 353 },
  Tabloid: { label: 'Tabloid (11 × 17 in)', widthMm: 279.4, heightMm: 431.8 },
};

export type EngravingFont = 'Leipzig' | 'Bravura' | 'Leland' | 'Petaluma' | 'Gootville';
export const ENGRAVING_FONTS: { id: EngravingFont; label: string }[] = [
  { id: 'Leipzig', label: 'Leipzig (classic)' },
  { id: 'Bravura', label: 'Bravura (bold, modern)' },
  { id: 'Leland', label: 'Leland (MuseScore style)' },
  { id: 'Gootville', label: 'Gootville (light)' },
  { id: 'Petaluma', label: 'Petaluma (handwritten / jazz)' },
];

export interface SheetExportOptions {
  // ---- Score information ----
  title: string;
  subtitle: string;
  composer: string;
  arranger: string;
  copyright: string;
  /** Label at the start of the first system. */
  instrumentName: string;
  showInstrumentName: boolean;

  // ---- Content ----
  /** Track ids to include; empty means every track that contains notes. */
  trackIds: string[];
  /** Merge all selected tracks into one instrument, or write one instrument per track. */
  partMode: 'combined' | 'separate';
  /** First bar (1-based, in the project's bar numbering). */
  fromBar: number;
  /** Last bar (inclusive); 0 = until the end. */
  toBar: number;
  /** Drop empty bars at the beginning (e.g. a count-in). */
  skipLeadingEmptyBars: boolean;
  /** Written pitch = sounding pitch + transpose (semitones). For transposing instruments. */
  transpose: number;

  // ---- Tempo, meter and key ("speed") ----
  /**
   * 'project': bars come from the project's tempo map (recorded with the metronome).
   * 'free': the performance was played freely; it is re-timed using performanceBpm / offset.
   */
  timing: 'project' | 'free';
  /** Free timing: the tempo the performance was actually played at (quarter notes/min). */
  performanceBpm: number;
  /** Free timing: time (seconds from project start) of the first downbeat. */
  performanceOffsetSec: number;
  /** Rhythmic scale: 0.5 = notate in double time (halve values), 2 = half time (double values). */
  durationScale: 0.5 | 1 | 2;
  /** 'project' or an explicit signature such as '3/4' or '6/8'. */
  timeSignature: string;
  /** Length of a pickup (anacrusis) bar in quarter notes; 0 = no pickup. */
  pickupBeats: number;
  keyMode: 'auto' | 'project' | 'manual';
  /** Manual key: -7..7 sharps/flats. */
  keyFifths: number;
  keyMinor: boolean;
  showTempo: boolean;
  /** Text shown with the metronome mark, e.g. "Allegro" or "Swing". Empty = only the metronome mark. */
  tempoText: string;
  /** Displayed BPM; 0 = derive from the project / performance tempo. */
  tempoBpmOverride: number;
  /** Write project tempo changes as additional tempo marks. */
  showTempoChanges: boolean;

  // ---- Rhythm / quantisation ----
  /** Smallest written note value: 4 = quarter, 8 = eighth, 16 = sixteenth, 32 = thirty-second. */
  grid: 4 | 8 | 16 | 32;
  /** Detect eighth-note triplets beat by beat. */
  triplets: boolean;
  /** Interpret swung eighths as straight eighths. */
  swing: boolean;
  /**
   * How written note lengths are derived:
   * 'exact' – as played, 'clean' – close small gaps and detect staccato, 'legato' – hold notes until the next one.
   */
  durations: 'exact' | 'clean' | 'legato';
  /** Ignore notes shorter than this many milliseconds (ghost notes). */
  minNoteMs: number;
  /** Lengthen notes that are held by the sustain pedal (until the pedal is released). */
  extendUnderPedal: boolean;

  // ---- Staves ----
  staffMode: 'auto' | 'grand' | 'treble' | 'bass';
  /** Grand staff: 'smart' follows the hands, 'fixed' splits at splitPoint. */
  handSplit: 'smart' | 'fixed';
  /** MIDI note; notes at or above go to the upper staff (60 = middle C). */
  splitPoint: number;
  /** Independent voices per staff (2 allows held notes under moving lines). */
  voices: 1 | 2;

  // ---- Expression ----
  /** Dynamic marks (pp … ff) derived from velocities. */
  dynamics: boolean;
  dynamicsSensitivity: 'low' | 'medium' | 'high';
  /** Crescendo / diminuendo hairpins from velocity trends. */
  hairpins: boolean;
  /** Sustain pedal marks from CC64. */
  pedal: 'none' | 'symbols' | 'lines';
  /** "una corda / tre corde" from the soft pedal (CC67). */
  softPedal: boolean;
  /** Staccato dots for clearly detached short notes. */
  staccato: boolean;
  /** Accents for notes much louder than their neighbours. */
  accents: boolean;

  // ---- Page layout ----
  paper: PaperSize;
  landscape: boolean;
  marginTopMm: number;
  marginBottomMm: number;
  marginSideMm: number;
  /** Height of a five-line staff in millimetres (7 is standard piano music, 5.5 is compact). */
  staffSizeMm: number;
  /** 0 = automatic line breaks. */
  measuresPerSystem: number;
  /** 0 = as many as fit. */
  systemsPerPage: number;
  measureNumbers: 'none' | 'system' | 'every' | 'five';
  justifyVertically: boolean;
  spacing: 'compact' | 'normal' | 'spacious';
  font: EngravingFont;
  pageNumbers: boolean;
  /** Repeat the title in small print at the top of following pages. */
  runningTitle: boolean;
}

export const DEFAULT_SHEET_OPTIONS: SheetExportOptions = {
  title: '',
  subtitle: '',
  composer: '',
  arranger: '',
  copyright: '',
  instrumentName: '',
  showInstrumentName: false,

  trackIds: [],
  partMode: 'combined',
  fromBar: 1,
  toBar: 0,
  skipLeadingEmptyBars: true,
  transpose: 0,

  timing: 'project',
  performanceBpm: 100,
  performanceOffsetSec: 0,
  durationScale: 1,
  timeSignature: 'project',
  pickupBeats: 0,
  keyMode: 'auto',
  keyFifths: 0,
  keyMinor: false,
  showTempo: true,
  tempoText: '',
  tempoBpmOverride: 0,
  showTempoChanges: true,

  grid: 16,
  triplets: true,
  swing: false,
  durations: 'clean',
  minNoteMs: 30,
  extendUnderPedal: false,

  staffMode: 'auto',
  handSplit: 'smart',
  splitPoint: 60,
  voices: 2,

  dynamics: true,
  dynamicsSensitivity: 'medium',
  hairpins: true,
  pedal: 'symbols',
  softPedal: true,
  staccato: true,
  accents: false,

  paper: 'A4',
  landscape: false,
  marginTopMm: 12,
  marginBottomMm: 12,
  marginSideMm: 14,
  staffSizeMm: 7,
  measuresPerSystem: 0,
  systemsPerPage: 0,
  measureNumbers: 'system',
  justifyVertically: false,
  spacing: 'normal',
  font: 'Leipzig',
  pageNumbers: true,
  runningTitle: true,
};

/** Options for a project: defaults, then the project's metadata, then saved settings. */
export function resolveSheetOptions(
  project: Project,
  saved?: Partial<SheetExportOptions> | null,
): SheetExportOptions {
  const firstTrack = project.tracks.find((t) => t.notes.length > 0) ?? project.tracks[0];
  const base: SheetExportOptions = {
    ...DEFAULT_SHEET_OPTIONS,
    title: project.meta.title === 'Untitled' ? '' : project.meta.title,
    subtitle: project.meta.subtitle,
    composer: project.meta.composer,
    arranger: project.meta.arranger,
    copyright: project.meta.copyright,
    instrumentName: firstTrack ? instrumentLabel(firstTrack.program) : 'Piano',
    performanceBpm: Math.round(project.tempos[0]?.bpm ?? 120),
  };
  const merged = { ...base, ...(saved ?? {}) } as SheetExportOptions;
  // Saved track ids that no longer exist are dropped.
  merged.trackIds = (merged.trackIds ?? []).filter((id) => project.tracks.some((t) => t.id === id));
  return sanitizeSheetOptions(merged);
}

export function instrumentLabel(program: number): string {
  if (program <= 7) return 'Piano';
  return GM_PROGRAMS[program] ?? 'Piano';
}

const pick = <T>(v: T, allowed: readonly T[], fallback: T): T => (allowed.includes(v) ? v : fallback);
const n = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Clamps every field into its valid range (protects against corrupt saved settings). */
export function sanitizeSheetOptions(o: SheetExportOptions): SheetExportOptions {
  const d = DEFAULT_SHEET_OPTIONS;
  return {
    ...o,
    partMode: pick(o.partMode, ['combined', 'separate'], d.partMode),
    fromBar: Math.round(n(o.fromBar, 1, 9999, 1)),
    toBar: Math.round(n(o.toBar, 0, 9999, 0)),
    transpose: Math.round(n(o.transpose, -36, 36, 0)),
    timing: pick(o.timing, ['project', 'free'], d.timing),
    performanceBpm: n(o.performanceBpm, 20, 400, d.performanceBpm),
    performanceOffsetSec: n(o.performanceOffsetSec, -60, 3600, 0),
    durationScale: pick(o.durationScale, [0.5, 1, 2], 1),
    timeSignature: /^(project|\d{1,2}\/(1|2|4|8|16))$/.test(o.timeSignature) ? o.timeSignature : 'project',
    pickupBeats: n(o.pickupBeats, 0, 16, 0),
    keyMode: pick(o.keyMode, ['auto', 'project', 'manual'], d.keyMode),
    keyFifths: Math.round(n(o.keyFifths, -7, 7, 0)),
    tempoBpmOverride: n(o.tempoBpmOverride, 0, 400, 0),
    grid: pick(o.grid, [4, 8, 16, 32], d.grid),
    durations: pick(o.durations, ['exact', 'clean', 'legato'], d.durations),
    minNoteMs: n(o.minNoteMs, 0, 500, d.minNoteMs),
    staffMode: pick(o.staffMode, ['auto', 'grand', 'treble', 'bass'], d.staffMode),
    handSplit: pick(o.handSplit, ['smart', 'fixed'], d.handSplit),
    splitPoint: Math.round(n(o.splitPoint, 21, 108, 60)),
    voices: pick(o.voices, [1, 2], d.voices),
    dynamicsSensitivity: pick(o.dynamicsSensitivity, ['low', 'medium', 'high'], d.dynamicsSensitivity),
    pedal: pick(o.pedal, ['none', 'symbols', 'lines'], d.pedal),
    paper: pick(o.paper, Object.keys(PAPER_SIZES) as PaperSize[], d.paper),
    marginTopMm: n(o.marginTopMm, 0, 60, d.marginTopMm),
    marginBottomMm: n(o.marginBottomMm, 0, 60, d.marginBottomMm),
    marginSideMm: n(o.marginSideMm, 0, 60, d.marginSideMm),
    staffSizeMm: n(o.staffSizeMm, 3, 12, d.staffSizeMm),
    measuresPerSystem: Math.round(n(o.measuresPerSystem, 0, 16, 0)),
    systemsPerPage: Math.round(n(o.systemsPerPage, 0, 20, 0)),
    measureNumbers: pick(o.measureNumbers, ['none', 'system', 'every', 'five'], d.measureNumbers),
    spacing: pick(o.spacing, ['compact', 'normal', 'spacious'], d.spacing),
    font: pick(
      o.font,
      ENGRAVING_FONTS.map((f) => f.id),
      d.font,
    ),
  };
}

export function parseTimeSignature(s: string): { numerator: number; denominator: number } | null {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (!m) return null;
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  if (numerator < 1 || ![1, 2, 4, 8, 16].includes(denominator)) return null;
  return { numerator, denominator };
}
