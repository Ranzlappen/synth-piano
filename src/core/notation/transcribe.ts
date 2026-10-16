// MIDI performance -> notated score.
//
// Pipeline: select tracks -> map ticks/seconds to notation time -> drop ghost notes ->
// (swing straightening) -> per-beat triplet detection & quantisation -> staff (hand)
// assignment -> note length clean-up & staccato -> voice allocation -> bar splitting,
// metrical note values, ties, tuplets, beams -> dynamics, hairpins, pedal & tempo marks.

import type { ControlEvent, Project, Track } from '../model';
import { DYNAMIC_LEVELS, dynamicLevelIndex, keyName, type DynamicMark } from '../music';
import { MeterMap, TempoMap } from '../timing';
import { detectKey } from './analysis';
import { parseTimeSignature, type SheetExportOptions } from './options';
import {
  beamGroupLength,
  beatUnitFor,
  decompose,
  DIV,
  isCompound,
  measureLength,
  type Meter,
  type NoteType,
  type NoteValue,
} from './rhythm';
import { spellPitch, type Step } from './spelling';

// ---------------------------------------------------------------------------
// Score model
// ---------------------------------------------------------------------------

export interface NPitch {
  midi: number;
  step: Step;
  alter: number;
  octave: number;
  tieStart: boolean;
  tieStop: boolean;
}

export interface NEvent {
  /** Position in divisions from the bar start. */
  start: number;
  rest: boolean;
  /** Whole-bar rest. */
  measureRest: boolean;
  value: NoteValue;
  pitches: NPitch[];
  tuplet?: 'start' | 'stop';
  tupletBracket?: boolean;
  beam?: 'begin' | 'continue' | 'end';
  articulations: ('staccato' | 'accent')[];
}

export interface NVoice {
  staff: number;
  voice: number;
  stem?: 'up' | 'down';
  events: NEvent[];
}

export type NDirection =
  | { kind: 'dynamic'; mark: DynamicMark; staff: number; offset: number }
  | { kind: 'wedge'; type: 'crescendo' | 'diminuendo' | 'stop'; staff: number; offset: number }
  | { kind: 'pedal'; type: 'start' | 'stop' | 'change'; line: boolean; staff: number; offset: number }
  | { kind: 'words'; text: string; staff: number; offset: number; placement: 'above' | 'below'; italic: boolean }
  | {
      kind: 'tempo';
      text: string;
      unit: NoteType;
      dotted: boolean;
      perMinute: number;
      quarterBpm: number;
      showMetronome: boolean;
      staff: number;
      offset: number;
    };

export interface NPartMeasure {
  voices: NVoice[];
  directions: NDirection[];
}

export interface NPart {
  id: string;
  name: string;
  staves: 1 | 2;
  clefs: ('treble' | 'bass')[];
  measures: NPartMeasure[];
}

export interface NMeasureInfo {
  index: number;
  number: number;
  implicit: boolean;
  /** Start in divisions from the beginning of the score. */
  start: number;
  length: number;
  /** Pickup bars: distance from the (virtual) full bar start to the pickup start. */
  metricOffset: number;
  meter: Meter;
  showMeter: boolean;
  keyFifths: number;
  keyMinor: boolean;
  showKey: boolean;
  newSystem: boolean;
}

export interface TranscriptionStats {
  notes: number;
  measures: number;
  keyName: string;
  keyFifths: number;
  keyMinor: boolean;
  tempoBpm: number;
  droppedShort: number;
  droppedOutside: number;
  suggestedPickup: number;
  warnings: string[];
}

export interface NScore {
  title: string;
  subtitle: string;
  composer: string;
  arranger: string;
  copyright: string;
  showInstrumentNames: boolean;
  divisions: number;
  measures: NMeasureInfo[];
  parts: NPart[];
  stats: TranscriptionStats;
}

// ---------------------------------------------------------------------------
// Working types
// ---------------------------------------------------------------------------

interface WNote {
  pitch: number;
  /** Unquantised position in divisions from the score start. */
  on: number;
  off: number;
  velocity: number;
  qOn: number;
  qOff: number;
  staff: number;
  staccato: boolean;
  accent: boolean;
}

interface Chord {
  on: number;
  off: number;
  notes: WNote[];
}

interface Frame {
  startBeat: number;
  lengthBeats: number;
  meter: Meter;
  barNumber: number;
}

interface PartSource {
  id: string;
  name: string;
  tracks: Track[];
}

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function transcribe(project: Project, o: SheetExportOptions): NScore {
  const warnings: string[] = [];
  const ppq = project.ppq;
  const tempoMap = new TempoMap(project.tempos, ppq);
  const meterMap = new MeterMap(project.timeSignatures, ppq);
  const scale = o.durationScale;
  const sigOverride = o.timeSignature !== 'project' ? parseTimeSignature(o.timeSignature) : null;
  const useProjectMeter = o.timing === 'project' && scale === 1 && !sigOverride;

  // ---- tracks / parts ----
  const selected = (
    o.trackIds.length ? project.tracks.filter((t) => o.trackIds.includes(t.id)) : project.tracks
  ).filter((t) => t.notes.length > 0);
  if (selected.some((t) => t.channel === 9))
    warnings.push('Drum tracks (channel 10) are written as pitched notes.');
  const parts: PartSource[] =
    o.partMode === 'separate'
      ? selected.map((t) => ({ id: t.id, name: t.name, tracks: [t] }))
      : [{ id: 'P1', name: o.instrumentName || 'Piano', tracks: selected }];
  if (parts.length === 0) parts.push({ id: 'P1', name: o.instrumentName || 'Piano', tracks: [] });

  // ---- time mapping ----
  const beatsOfTick = (tick: number): number =>
    o.timing === 'free'
      ? ((tempoMap.tickToSeconds(tick) - o.performanceOffsetSec) * o.performanceBpm * scale) / 60
      : (tick / ppq) * scale;

  let lastTick = 0;
  for (const t of selected) for (const n of t.notes) lastTick = Math.max(lastTick, n.tick + n.duration);
  const fromBarIdx = Math.max(0, o.fromBar - 1);
  const constMeter: Meter = sigOverride ?? (() => {
    const seg = meterMap.segmentAt(o.timing === 'free' ? 0 : meterMap.barStart(fromBarIdx));
    return { numerator: seg.numerator, denominator: seg.denominator };
  })();
  const pickup = Math.max(0, o.pickupBeats);

  // Measures as frames in (scaled) quarter beats.
  let frames: Frame[] = [];
  const lastBeat = beatsOfTick(lastTick);
  if (useProjectMeter) {
    const firstFull = pickup > 0 ? fromBarIdx + 1 : fromBarIdx;
    const lastIdx = o.toBar > 0 ? Math.max(firstFull, o.toBar - 1) : Math.max(firstFull, meterMap.barIndexAt(Math.max(0, lastTick - 1)));
    if (pickup > 0) {
      const b = meterMap.bar(fromBarIdx);
      frames.push({
        startBeat: meterMap.barStart(firstFull) / ppq - pickup,
        lengthBeats: pickup,
        meter: { numerator: b.numerator, denominator: b.denominator },
        barNumber: 0,
      });
    }
    for (let i = firstFull; i <= lastIdx; i++) {
      const b = meterMap.bar(i);
      frames.push({
        startBeat: b.start / ppq,
        lengthBeats: (b.end - b.start) / ppq,
        meter: { numerator: b.numerator, denominator: b.denominator },
        barNumber: i + 1,
      });
    }
  } else {
    const L = measureLength(constMeter) / DIV;
    const firstDownbeat =
      o.timing === 'free'
        ? fromBarIdx * L + pickup
        : beatsOfTick(meterMap.barStart(pickup > 0 ? fromBarIdx + 1 : fromBarIdx));
    if (pickup > 0)
      frames.push({ startBeat: firstDownbeat - pickup, lengthBeats: pickup, meter: constMeter, barNumber: 0 });
    const maxBars = o.toBar > 0 ? Math.max(1, o.toBar - o.fromBar + 1 - (pickup > 0 ? 1 : 0)) : 10000;
    for (let i = 0; i < maxBars; i++) {
      const start = firstDownbeat + i * L;
      if (i > 0 && start >= lastBeat - EPS) break;
      frames.push({ startBeat: start, lengthBeats: L, meter: constMeter, barNumber: o.fromBar + i + (pickup > 0 ? 1 : 0) });
    }
  }

  // ---- collect notes per part in beats ----
  interface RawNote {
    pitch: number;
    onBeat: number;
    offBeat: number;
    velocity: number;
    part: number;
    tickOn: number;
  }
  let droppedShort = 0;
  const raw: RawNote[] = [];
  parts.forEach((p, partIndex) => {
    for (const track of p.tracks) {
      const pedal = o.extendUnderPedal ? pedalIntervals(track.controls, 64) : [];
      const sorted = [...track.notes].sort((a, b) => a.tick - b.tick);
      sorted.forEach((n, i) => {
        let endTick = n.tick + n.duration;
        if (pedal.length) {
          const iv = pedal.find(([d, u]) => endTick >= d && endTick < u);
          if (iv) {
            const nextSame = sorted.slice(i + 1).find((m) => m.pitch === n.pitch);
            endTick = Math.min(iv[1], nextSame ? nextSame.tick : Infinity);
          }
        }
        const secs = tempoMap.tickToSeconds(n.tick + n.duration) - tempoMap.tickToSeconds(n.tick);
        if (secs * 1000 < o.minNoteMs) {
          droppedShort++;
          return;
        }
        raw.push({
          pitch: Math.min(127, Math.max(0, n.pitch + o.transpose)),
          onBeat: beatsOfTick(n.tick),
          offBeat: beatsOfTick(endTick),
          velocity: n.velocity,
          part: partIndex,
          tickOn: n.tick,
        });
      });
    }
  });

  // ---- skip leading empty bars ----
  if (o.skipLeadingEmptyBars && pickup === 0 && raw.length && frames.length > 1) {
    const firstOn = Math.min(...raw.map((r) => r.onBeat));
    let skip = 0;
    while (skip < frames.length - 1 && frames[skip].startBeat + frames[skip].lengthBeats <= firstOn + 1 / 16) skip++;
    if (skip > 0) {
      frames = frames.slice(skip);
      if (o.fromBar <= 1) {
        const shift = frames[0].barNumber - 1;
        frames = frames.map((f) => ({ ...f, barNumber: f.barNumber - shift }));
      }
    }
  }
  if (frames.length === 0) frames.push({ startBeat: 0, lengthBeats: 4, meter: { numerator: 4, denominator: 4 }, barNumber: 1 });

  // Suggest a pickup when the music starts late in the first bar.
  let suggestedPickup = 0;
  if (pickup === 0 && raw.length) {
    const f = frames[0];
    const firstOn = Math.min(...raw.map((r) => r.onBeat)) - f.startBeat;
    if (firstOn >= 0.5 && firstOn < f.lengthBeats) suggestedPickup = Math.round((f.lengthBeats - firstOn) * 2) / 2;
  }

  // ---- measures in divisions ----
  const origin = frames[0].startBeat;
  const measures: NMeasureInfo[] = frames.map((f, index) => ({
    index,
    number: f.barNumber,
    implicit: f.barNumber === 0,
    start: Math.round((f.startBeat - origin) * DIV),
    length: Math.round(f.lengthBeats * DIV),
    metricOffset: f.barNumber === 0 ? Math.max(0, measureLength(f.meter) - Math.round(f.lengthBeats * DIV)) : 0,
    meter: f.meter,
    showMeter: false,
    keyFifths: 0,
    keyMinor: false,
    showKey: false,
    newSystem: false,
  }));
  measures.forEach((m, i) => {
    const prev = measures[i - 1];
    m.showMeter =
      i === 0 ||
      (i === 1 && measures[0].implicit) ||
      prev.meter.numerator !== m.meter.numerator ||
      prev.meter.denominator !== m.meter.denominator;
    if (i === 1 && measures[0].implicit) m.showMeter = false;
  });
  let scoreEnd = measures[measures.length - 1].start + measures[measures.length - 1].length;
  const measureAt = (pos: number): NMeasureInfo => {
    let lo = 0;
    let hi = measures.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measures[mid].start <= pos) lo = mid;
      else hi = mid - 1;
    }
    return measures[lo];
  };

  // ---- to divisions, range filter, swing ----
  let droppedOutside = 0;
  const notesByPart: WNote[][] = parts.map(() => []);
  const grid = (DIV * 4) / o.grid;
  for (const r of raw) {
    let on = (r.onBeat - origin) * DIV;
    let off = (r.offBeat - origin) * DIV;
    if (on < -grid / 2 || on >= scoreEnd - grid / 2) {
      droppedOutside++;
      continue;
    }
    if (o.swing && o.grid >= 8) {
      const m = measureAt(Math.max(0, on));
      if (!isCompound(m.meter)) {
        on = m.start + straightenSwing(on - m.start);
        off = measureAt(Math.max(0, off)).start + straightenSwing(off - measureAt(Math.max(0, off)).start);
      }
    }
    notesByPart[r.part].push({
      pitch: r.pitch,
      on: Math.max(0, on),
      off: Math.max(on + 1, off),
      velocity: r.velocity,
      qOn: 0,
      qOff: 0,
      staff: 1,
      staccato: false,
      accent: false,
    });
  }

  // ---- key ----
  let keyFifths = 0;
  let keyMinor = false;
  const allNotes = notesByPart.flat();
  if (o.keyMode === 'manual') {
    keyFifths = o.keyFifths;
    keyMinor = o.keyMinor;
  } else if (o.keyMode === 'project') {
    const startTick = useProjectMeter ? meterMap.barStart(fromBarIdx) : 0;
    const ks = [...project.keySignatures].filter((k) => k.tick <= startTick).pop() ?? project.keySignatures[0];
    keyFifths = normaliseFifths((ks?.fifths ?? 0) + 7 * o.transpose);
    keyMinor = ks?.mode === 'minor';
  } else {
    const est = detectKey(allNotes.map((n) => ({ pitch: n.pitch, duration: (n.off - n.on) / DIV })));
    keyFifths = est.fifths;
    keyMinor = est.mode === 'minor';
  }
  for (const m of measures) {
    m.keyFifths = keyFifths;
    m.keyMinor = keyMinor;
  }
  measures[0].showKey = true;
  if (o.measuresPerSystem > 0) {
    let count = 0;
    for (const m of measures) {
      if (m.implicit) continue;
      if (count > 0 && count % o.measuresPerSystem === 0) m.newSystem = true;
      count++;
    }
  }

  const initialBpm =
    o.tempoBpmOverride > 0
      ? o.tempoBpmOverride
      : o.timing === 'free'
        ? o.performanceBpm * scale
        : tempoMap.bpmAt(Math.max(0, (origin / scale) * ppq)) * scale;

  // ---- quantise every part, then drop trailing bars that only contain rests ----
  const tripletsByPart = notesByPart.map((notes) =>
    o.triplets ? detectTripletBeats(notes, measures, measureAt, grid) : new Map<number, Set<number>>(),
  );
  const cleanedByPart = notesByPart.map((notes, i) => {
    quantizeNotes(notes, measureAt, tripletsByPart[i], grid, scoreEnd);
    return dedupe(notes);
  });
  const contentEnd = cleanedByPart.reduce((mx, ns) => ns.reduce((m2, n) => Math.max(m2, n.qOff), mx), 0);
  if (contentEnd > 0) {
    const lastIndex = measureAt(contentEnd - 1).index;
    if (lastIndex < measures.length - 1) {
      measures.length = lastIndex + 1;
      scoreEnd = measures[lastIndex].start + measures[lastIndex].length;
    }
  }

  // ---- per part processing ----
  const outParts: NPart[] = parts.map((p, partIndex) => {
    const tripletBeats = tripletsByPart[partIndex];
    const cleaned = cleanedByPart[partIndex];
    if (o.accents) markAccents(cleaned);

    // Staff layout.
    const staffMode = chooseStaffMode(o.staffMode, cleaned);
    const staves: 1 | 2 = staffMode === 'grand' ? 2 : 1;
    const clefs: ('treble' | 'bass')[] = staffMode === 'grand' ? ['treble', 'bass'] : [staffMode === 'bass' ? 'bass' : 'treble'];
    if (staves === 2) assignHands(cleaned, o.handSplit, o.splitPoint);

    const partMeasures: NPartMeasure[] = measures.map(() => ({ voices: [], directions: [] }));
    for (let staff = 1; staff <= staves; staff++) {
      const staffNotes = cleaned.filter((n) => n.staff === staff);
      adjustDurations(staffNotes, o, grid);
      const voices = allocateVoices(staffNotes, o.voices);
      voices.forEach((chords, vIndex) => {
        const voiceNumber = (staff - 1) * 4 + vIndex + 1;
        const perMeasure = layoutVoice(chords, measures, tripletBeats, vIndex === 0, keyFifths, keyMinor);
        perMeasure.forEach((events, mi) => {
          if (events) partMeasures[mi].voices.push({ staff, voice: voiceNumber, events });
        });
      });
    }
    // Stems for measures with two voices on a staff.
    for (const pm of partMeasures) {
      for (let staff = 1; staff <= staves; staff++) {
        const vs = pm.voices.filter((v) => v.staff === staff);
        if (vs.length < 2) continue;
        const avg = (v: NVoice) => {
          const ps = v.events.flatMap((e) => e.pitches.map((x) => x.midi));
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
        };
        const [a, b] = vs;
        const upper = avg(a) >= avg(b) ? a : b;
        for (const v of vs) v.stem = v === upper ? 'up' : 'down';
      }
    }
    for (const pm of partMeasures) for (const v of pm.voices) beamAndTuplets(v, measures[partMeasures.indexOf(pm)]);

    const expressionStaff = 1;
    const bottomStaff = staves;
    const addDirection = (pos: number, d: NDirection) => {
      const m = measureAt(Math.max(0, Math.min(scoreEnd - 1, pos)));
      partMeasures[m.index].directions.push({ ...d, offset: Math.max(0, Math.min(m.length, pos - m.start)) } as NDirection);
    };

    let dynamics = o.dynamics ? computeDynamics(cleaned, measures, o.dynamicsSensitivity) : [];
    const hairpins = o.hairpins ? computeHairpins(cleaned) : [];
    // A mark in the middle of a hairpin interrupts it; the hairpin already shows the change.
    dynamics = dynamics.filter((d) => !hairpins.some((h) => d.pos > h.start && d.pos < h.end));
    if (o.hairpins) {
      for (const h of hairpins) {
        addDirection(h.start, { kind: 'wedge', type: h.type, staff: expressionStaff, offset: 0 });
        addDirection(h.end, { kind: 'wedge', type: 'stop', staff: expressionStaff, offset: 0 });
        if (!o.dynamics) continue;
        // A hairpin leads to a dynamic: add the target level unless one is already close by.
        if (dynamics.some((d) => Math.abs(d.pos - h.end) <= DIV)) continue;
        const before = [...dynamics].filter((d) => d.pos <= h.start).pop();
        const around = cleaned.filter((n) => Math.abs(n.qOn - h.end) <= DIV / 2);
        if (!around.length) continue;
        const level = dynamicLevelIndex(loudness(around.map((n) => n.velocity)));
        const prevLevel = before ? DYNAMIC_LEVELS.findIndex((l) => l.mark === before.mark) : -1;
        const moved = h.type === 'crescendo' ? level > prevLevel : level < prevLevel;
        if (prevLevel >= 0 && moved) dynamics.push({ pos: Math.min(...around.map((n) => n.qOn)), mark: DYNAMIC_LEVELS[level].mark });
      }
    }
    for (const d of dynamics) addDirection(d.pos, { kind: 'dynamic', mark: d.mark, staff: expressionStaff, offset: 0 });
    const controls = p.tracks.flatMap((t) => t.controls);
    const toDiv = (tick: number) => (beatsOfTick(tick) - origin) * DIV;
    const snap = (pos: number) => Math.round(pos / grid) * grid;
    if (o.pedal !== 'none') {
      for (const ev of pedalMarks(controls, toDiv, snap, scoreEnd, grid, o.pedal === 'lines'))
        addDirection(ev.pos, { kind: 'pedal', type: ev.type, line: o.pedal === 'lines', staff: bottomStaff, offset: 0 });
    }
    if (o.softPedal) {
      for (const [d, u] of pedalIntervals(controls, 67)) {
        const ds = snap(toDiv(d));
        const us = snap(toDiv(u));
        if (us <= 0 || ds >= scoreEnd || us - ds < grid) continue;
        addDirection(Math.max(0, ds), { kind: 'words', text: 'una corda', staff: bottomStaff, offset: 0, placement: 'below', italic: true });
        if (us < scoreEnd)
          addDirection(us, { kind: 'words', text: 'tre corde', staff: bottomStaff, offset: 0, placement: 'below', italic: true });
      }
    }
    if (partIndex === 0 && o.showTempo) {
      for (const t of tempoMarks(project, o, initialBpm, beatsOfTick, origin, scoreEnd, measures, warnings))
        addDirection(t.pos, {
          kind: 'tempo',
          text: t.text,
          unit: t.unit,
          dotted: t.dotted,
          perMinute: t.perMinute,
          quarterBpm: t.quarterBpm,
          showMetronome: true,
          staff: 1,
          offset: 0,
        });
    }
    for (const pm of partMeasures) pm.directions.sort((a, b) => a.offset - b.offset);
    return { id: p.id, name: p.name, staves, clefs, measures: partMeasures };
  });

  if (droppedOutside > 0) warnings.push(`${droppedOutside} note(s) outside the selected bars were skipped.`);
  if (droppedShort > 0) warnings.push(`${droppedShort} very short note(s) were ignored (shorter than ${o.minNoteMs} ms).`);
  if (selected.length === 0) warnings.push('No notes to export — select tracks that contain notes.');

  return {
    title: o.title,
    subtitle: o.subtitle,
    composer: o.composer,
    arranger: o.arranger,
    copyright: o.copyright,
    showInstrumentNames: o.showInstrumentName || o.partMode === 'separate',
    divisions: DIV,
    measures,
    parts: outParts,
    stats: {
      notes: allNotes.length,
      measures: measures.filter((m) => !m.implicit).length,
      keyName: keyName(keyFifths, keyMinor ? 'minor' : 'major'),
      keyFifths,
      keyMinor,
      tempoBpm: Math.round(initialBpm * 10) / 10,
      droppedShort,
      droppedOutside,
      suggestedPickup,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseFifths(f: number): number {
  let x = ((f % 12) + 12) % 12; // 0..11
  if (x > 6) x -= 12; // -5..6
  return x;
}

/** Maps swung eighths (long-short 2:1) onto straight eighths within each quarter. */
function straightenSwing(pos: number): number {
  const beat = Math.floor(pos / DIV);
  const p = (pos - beat * DIV) / DIV;
  const mapped = p < 2 / 3 ? p * 0.75 : 0.5 + (p - 2 / 3) * 1.5;
  return beat * DIV + mapped * DIV;
}

/** Sustain-style pedal intervals [downTick, upTick) for a controller. */
export function pedalIntervals(controls: readonly ControlEvent[], controller: number): [number, number][] {
  const out: [number, number][] = [];
  let down: number | null = null;
  const events = controls.filter((c) => c.kind === 'cc' && c.controller === controller).sort((a, b) => a.tick - b.tick);
  for (const c of events) {
    if (c.value >= 64 && down === null) down = c.tick;
    else if (c.value < 64 && down !== null) {
      out.push([down, c.tick]);
      down = null;
    }
  }
  if (down !== null) out.push([down, Infinity]);
  return out;
}

function detectTripletBeats(
  notes: WNote[],
  measures: NMeasureInfo[],
  measureAt: (pos: number) => NMeasureInfo,
  grid: number,
): Map<number, Set<number>> {
  const buckets = new Map<string, number[]>();
  for (const n of notes) {
    const m = measureAt(n.on);
    if (isCompound(m.meter) || m.meter.denominator > 4) continue;
    const pos = n.on - m.start + m.metricOffset;
    const b = Math.floor((pos + grid / 2) / DIV);
    const r = pos - b * DIV;
    const key = `${m.index}:${b}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }
  const result = new Map<number, Set<number>>();
  for (const [key, rs] of buckets) {
    const [mi, b] = key.split(':').map(Number);
    const m = measures[mi];
    if (b * DIV < m.metricOffset || (b + 1) * DIV > m.metricOffset + m.length) continue;
    let errS = 0;
    let errT = 0;
    let hits = 0;
    for (const r of rs) {
      const ds = Math.abs(r - Math.round(r / grid) * grid);
      const tIndex = Math.round(r / 16);
      const dt = Math.abs(r - tIndex * 16);
      errS += ds;
      errT += dt;
      if ((tIndex === 1 || tIndex === 2) && dt < 5 && ds > 2) hits++;
    }
    if (hits >= 2 && errT <= errS * 0.75) {
      const set = result.get(mi) ?? new Set<number>();
      set.add(b);
      result.set(mi, set);
    }
  }
  return result;
}

function snapPosition(
  pos: number,
  measureAt: (pos: number) => NMeasureInfo,
  tripletBeats: Map<number, Set<number>>,
  grid: number,
  preferEnd: boolean,
): { q: number; triplet: boolean } {
  const m = measureAt(Math.max(0, preferEnd ? pos - EPS : pos));
  const vStart = m.start - m.metricOffset;
  const rel = pos - vStart;
  const set = tripletBeats.get(m.index);
  const beatIndex = Math.floor(rel / DIV);
  const roundBeat = Math.floor((rel + grid / 2) / DIV);
  const b = preferEnd ? beatIndex : roundBeat;
  if (set?.has(b)) {
    return { q: vStart + b * DIV + Math.round((rel - b * DIV) / 16) * 16, triplet: true };
  }
  if (!preferEnd && set?.has(beatIndex) && !set.has(roundBeat)) {
    return { q: vStart + beatIndex * DIV + Math.round((rel - beatIndex * DIV) / 16) * 16, triplet: true };
  }
  return { q: vStart + Math.round(rel / grid) * grid, triplet: false };
}

function quantizeNotes(
  notes: WNote[],
  measureAt: (pos: number) => NMeasureInfo,
  tripletBeats: Map<number, Set<number>>,
  grid: number,
  scoreEnd: number,
): void {
  for (const n of notes) {
    const on = snapPosition(n.on, measureAt, tripletBeats, grid, false);
    const off = snapPosition(n.off, measureAt, tripletBeats, grid, true);
    n.qOn = Math.max(0, Math.min(scoreEnd - (on.triplet ? 16 : grid), on.q));
    const minLen = on.triplet ? 16 : grid;
    n.qOff = Math.min(scoreEnd, Math.max(n.qOn + minLen, off.q));
  }
}

/** Removes duplicate pitches at the same position and trims same-pitch overlaps. */
function dedupe(notes: WNote[]): WNote[] {
  const sorted = [...notes].sort((a, b) => a.qOn - b.qOn || a.pitch - b.pitch);
  const out: WNote[] = [];
  const lastByPitch = new Map<number, WNote>();
  for (const n of sorted) {
    const prev = lastByPitch.get(n.pitch);
    if (prev && prev.qOn === n.qOn) {
      prev.qOff = Math.max(prev.qOff, n.qOff);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    if (prev && prev.qOff > n.qOn) prev.qOff = n.qOn;
    lastByPitch.set(n.pitch, n);
    out.push(n);
  }
  return out;
}

function markAccents(notes: WNote[]): void {
  // `notes` is sorted by qOn; neighbours are notes within one beat at other positions.
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (const n of notes) {
    while (hi < notes.length && notes[hi].qOn <= n.qOn + DIV) sum += notes[hi++].velocity;
    while (notes[lo].qOn < n.qOn - DIV) sum -= notes[lo++].velocity;
    let count = hi - lo;
    let total = sum;
    for (let i = lo; i < hi; i++) {
      if (notes[i].qOn === n.qOn) {
        count--;
        total -= notes[i].velocity;
      }
    }
    if (count < 2) continue;
    if (n.velocity >= 64 && n.velocity >= total / count + 20) n.accent = true;
  }
}

function chooseStaffMode(mode: SheetExportOptions['staffMode'], notes: WNote[]): 'grand' | 'treble' | 'bass' {
  if (mode !== 'auto') return mode;
  if (notes.length === 0) return 'grand';
  const below = notes.filter((n) => n.pitch < 60).length / notes.length;
  const above = 1 - below;
  if (below > 0.12 && above > 0.12) return 'grand';
  const min = Math.min(...notes.map((n) => n.pitch));
  const max = Math.max(...notes.map((n) => n.pitch));
  if (max - min > 24 && min < 55 && max > 64) return 'grand';
  return below > 0.5 ? 'bass' : 'treble';
}

/** Distributes notes over the two hands (staff 1 = right, 2 = left). */
function assignHands(notes: WNote[], mode: 'smart' | 'fixed', split: number): void {
  if (mode === 'fixed') {
    for (const n of notes) n.staff = n.pitch >= split ? 1 : 2;
    return;
  }
  const groups = new Map<number, WNote[]>();
  for (const n of notes) {
    const g = groups.get(n.qOn) ?? [];
    g.push(n);
    groups.set(n.qOn, g);
  }
  const onsets = [...groups.keys()].sort((a, b) => a - b);
  const upper = notes.filter((n) => n.pitch >= split);
  const lower = notes.filter((n) => n.pitch < split);
  let right = upper.length ? upper.reduce((s, n) => s + n.pitch, 0) / upper.length : split + 12;
  let left = lower.length ? lower.reduce((s, n) => s + n.pitch, 0) / lower.length : split - 12;
  const held: WNote[] = [];
  for (const t of onsets) {
    const g = groups.get(t)!.sort((a, b) => a.pitch - b.pitch);
    for (let i = held.length - 1; i >= 0; i--) if (held[i].qOff <= t) held.splice(i, 1);
    const heldL = held.filter((h) => h.staff === 2).map((h) => h.pitch);
    const heldR = held.filter((h) => h.staff === 1).map((h) => h.pitch);
    let bestK = 0;
    let bestCost = Infinity;
    for (let k = 0; k <= g.length; k++) {
      const l = [...g.slice(0, k).map((n) => n.pitch), ...heldL];
      const r = [...g.slice(k).map((n) => n.pitch), ...heldR];
      let cost = 0;
      for (const n of g.slice(0, k)) cost += Math.abs(n.pitch - left);
      for (const n of g.slice(k)) cost += Math.abs(n.pitch - right);
      const span = (ps: number[]) => (ps.length ? Math.max(...ps) - Math.min(...ps) : 0);
      const gl = g.slice(0, k).map((n) => n.pitch);
      const gr = g.slice(k).map((n) => n.pitch);
      // Stretch of the newly struck notes is hard; including held notes it is softer
      // (held notes may be released early or sustained by the pedal).
      cost += 10 * Math.max(0, span(gl) - 12) + 10 * Math.max(0, span(gr) - 12);
      cost += 3 * Math.max(0, span(l) - 14) + 3 * Math.max(0, span(r) - 14);
      // Splitting a close chord between the hands is unusual.
      if (gl.length && gr.length && Math.min(...gr) - Math.max(...gl) < 5) cost += 15;
      // Notes far on the "wrong" side of the split are unlikely.
      for (const n of g.slice(0, k)) cost += 1.5 * Math.max(0, n.pitch - (split + 7));
      for (const n of g.slice(k)) cost += 1.5 * Math.max(0, split - 7 - n.pitch);
      // Hands should not cross.
      if (l.length && r.length && Math.max(...l) > Math.min(...r)) cost += 30;
      if (cost < bestCost) {
        bestCost = cost;
        bestK = k;
      }
    }
    g.forEach((n, i) => (n.staff = i < bestK ? 2 : 1));
    const lp = g.slice(0, bestK);
    const rp = g.slice(bestK);
    if (lp.length) left = 0.7 * left + 0.3 * (lp.reduce((s, n) => s + n.pitch, 0) / lp.length);
    if (rp.length) right = 0.7 * right + 0.3 * (rp.reduce((s, n) => s + n.pitch, 0) / rp.length);
    held.push(...g);
  }
}

/** Closes small gaps (clean/legato) and detects staccato. */
function adjustDurations(notes: WNote[], o: SheetExportOptions, grid: number): void {
  const onsets = [...new Set(notes.map((n) => n.qOn))].sort((a, b) => a - b);
  const nextOnset = (t: number): number | undefined => {
    let lo = 0;
    let hi = onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (onsets[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return onsets[lo];
  };
  for (const n of notes) {
    const next = nextOnset(n.qOn);
    if (next === undefined) continue;
    const ioi = next - n.qOn;
    const rawLen = n.off - n.on;
    if (o.durations !== 'exact' && o.staccato && ioi <= DIV && rawLen <= 0.45 * ioi && rawLen < DIV * 0.6) {
      n.staccato = true;
      n.qOff = next;
      continue;
    }
    const gap = next - n.qOff;
    if (gap <= 0) continue;
    if (o.durations === 'clean' && gap <= Math.max(grid, 0.3 * ioi)) n.qOff = next;
    else if (o.durations === 'legato' && ioi <= DIV * 4) n.qOff = next;
  }
}

/** Distributes notes over one or two voices; returns chords per voice in time order. */
function allocateVoices(notes: WNote[], maxVoices: 1 | 2): Chord[][] {
  const groups = new Map<number, WNote[]>();
  for (const n of notes) {
    const g = groups.get(n.qOn) ?? [];
    g.push(n);
    groups.set(n.qOn, g);
  }
  const onsets = [...groups.keys()].sort((a, b) => a - b);
  if (maxVoices === 1) {
    return [
      onsets.map((t, i) => {
        const g = groups.get(t)!;
        const next = onsets[i + 1] ?? Infinity;
        return { on: t, off: Math.min(Math.max(...g.map((n) => n.qOff)), next), notes: g };
      }),
    ];
  }
  const voices: Chord[][] = [[], []];
  const lastOf = (v: number) => voices[v][voices[v].length - 1];
  const endOf = (v: number) => lastOf(v)?.off ?? -Infinity;
  const avgPitch = (ns: WNote[]) => ns.reduce((s, n) => s + n.pitch, 0) / ns.length;
  const truncate = (v: number, t: number) => {
    const last = lastOf(v);
    if (last && last.off > t) last.off = t;
  };
  const place = (chord: Chord) => {
    const free = [0, 1].filter((v) => endOf(v) <= chord.on);
    let v: number;
    if (free.length === 2) {
      // Keep lines continuous: pick the voice whose last chord is closest in pitch.
      const p = avgPitch(chord.notes);
      const d0 = lastOf(0) ? Math.abs(avgPitch(lastOf(0).notes) - p) : 0;
      const d1 = lastOf(1) ? Math.abs(avgPitch(lastOf(1).notes) - p) : Infinity;
      v = d1 < d0 ? 1 : 0;
    } else if (free.length === 1) v = free[0];
    else {
      v = endOf(0) <= endOf(1) ? 0 : 1;
      truncate(v, chord.on);
    }
    voices[v].push(chord);
  };
  for (const t of onsets) {
    const g = groups.get(t)!.sort((a, b) => b.pitch - a.pitch);
    const offs = [...new Set(g.map((n) => n.qOff))];
    if (offs.length === 1) {
      place({ on: t, off: offs[0], notes: g });
      continue;
    }
    // Split into an upper and a lower chord with as uniform lengths as possible.
    let bestK = 1;
    let bestCost = Infinity;
    for (let k = 1; k < g.length; k++) {
      const cost = (part: WNote[]) => {
        const max = Math.max(...part.map((n) => n.qOff));
        return part.reduce((s, n) => s + (max - n.qOff), 0);
      };
      const c = cost(g.slice(0, k)) + cost(g.slice(k));
      if (c < bestCost) {
        bestCost = c;
        bestK = k;
      }
    }
    const upperNotes = g.slice(0, bestK);
    const lowerNotes = g.slice(bestK);
    const upperChord = { on: t, off: Math.max(...upperNotes.map((n) => n.qOff)), notes: upperNotes };
    const lowerChord = { on: t, off: Math.max(...lowerNotes.map((n) => n.qOff)), notes: lowerNotes };
    if (upperChord.off === lowerChord.off) {
      place({ on: t, off: upperChord.off, notes: g });
      continue;
    }
    for (const v of [0, 1]) truncate(v, t);
    voices[0].push(upperChord);
    voices[1].push(lowerChord);
  }
  // Pull second-voice chords into the first voice wherever the first voice is silent
  // or has an identical rhythm — keeps the score as simple as possible.
  // Voice 0 stays sorted and non-overlapping, so overlap checks are a binary search.
  // Voice 0 only grows, so a single pass in time order is sufficient.
  const v0 = voices[0];
  const keep: Chord[] = [];
  for (const c of voices[1]) {
    let lo = 0;
    let hi = v0.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (v0[mid].off <= c.on) lo = mid + 1;
      else hi = mid;
    }
    // v0[lo] is the first chord ending after c starts.
    const first = v0[lo];
    if (!first || first.on >= c.off) {
      v0.splice(lo, 0, c);
      continue;
    }
    const second = v0[lo + 1];
    if (first.on === c.on && first.off === c.off && (!second || second.on >= c.off)) {
      first.notes.push(...c.notes);
      continue;
    }
    keep.push(c);
  }
  voices[1] = keep;
  return voices[1].length ? voices : [voices[0]];
}

/**
 * Converts a voice's chords into per-measure event lists (with rests, ties and metrical
 * note values). Secondary voices only appear in measures where they have notes.
 */
function layoutVoice(
  chords: Chord[],
  measures: NMeasureInfo[],
  tripletBeats: Map<number, Set<number>>,
  primary: boolean,
  keyFifths: number,
  keyMinor: boolean,
): (NEvent[] | null)[] {
  const out: (NEvent[] | null)[] = measures.map(() => null);
  const emptySet = new Set<number>();
  // Chord segments per measure.
  const perMeasure = new Map<number, { start: number; end: number; chord: Chord; first: boolean; last: boolean }[]>();
  for (const c of chords) {
    const startM = measures.findIndex((m) => c.on < m.start + m.length);
    for (let mi = Math.max(0, startM); mi < measures.length; mi++) {
      const m = measures[mi];
      if (m.start >= c.off) break;
      const s = Math.max(c.on, m.start);
      const e = Math.min(c.off, m.start + m.length);
      if (e <= s) continue;
      const list = perMeasure.get(mi) ?? [];
      const off = m.metricOffset - m.start;
      list.push({ start: s + off, end: e + off, chord: c, first: s === c.on, last: e === c.off });
      perMeasure.set(mi, list);
    }
  }
  measures.forEach((m, mi) => {
    const segs = (perMeasure.get(mi) ?? []).sort((a, b) => a.start - b.start);
    if (!primary && segs.length === 0) return;
    const triplets = tripletBeats.get(mi) ?? emptySet;
    const events: NEvent[] = [];
    const barEnd = m.metricOffset + m.length;
    let cursor = m.metricOffset;
    const pushRest = (from: number, to: number) => {
      const fullBar = !m.implicit && from === 0 && to === m.length;
      for (const p of decompose(from, to, m.meter, triplets, true)) {
        events.push({
          start: p.start,
          rest: true,
          measureRest: fullBar,
          value: fullBar ? { ...p.value, duration: m.length } : p.value,
          pitches: [],
          articulations: [],
        });
      }
    };
    for (const seg of segs) {
      if (seg.start > cursor) pushRest(cursor, seg.start);
      const pieces = decompose(Math.max(cursor, seg.start), seg.end, m.meter, triplets, false);
      pieces.forEach((p, i) => {
        const tieStop = i > 0 || !seg.first;
        const tieStart = i < pieces.length - 1 || !seg.last;
        const notes = [...seg.chord.notes].sort((a, b) => a.pitch - b.pitch);
        const articulations: ('staccato' | 'accent')[] = [];
        if (i === 0 && seg.first) {
          if (notes.some((n) => n.accent)) articulations.push('accent');
          if (notes.every((n) => n.staccato) && !tieStart) articulations.push('staccato');
        }
        events.push({
          start: p.start,
          rest: false,
          measureRest: false,
          value: p.value,
          pitches: notes.map((n) => ({ midi: n.pitch, ...spellPitch(n.pitch, keyFifths, keyMinor), tieStart, tieStop })),
          articulations,
        });
      });
      cursor = Math.max(cursor, seg.end);
    }
    if (cursor < barEnd) pushRest(cursor, barEnd);
    out[mi] = events;
  });
  return out;
}

const BEAMABLE: ReadonlySet<NoteType> = new Set(['eighth', '16th', '32nd', '64th']);

function beamAndTuplets(v: NVoice, m: NMeasureInfo): void {
  const groupLen = beamGroupLength(m.meter);
  // Beams: runs of consecutive short notes inside a beam group.
  let run: NEvent[] = [];
  let runGroup = -1;
  let runTriplet = false;
  const flush = () => {
    if (run.length >= 2) run.forEach((e, i) => (e.beam = i === 0 ? 'begin' : i === run.length - 1 ? 'end' : 'continue'));
    run = [];
  };
  for (const e of v.events) {
    const group = Math.floor(e.start / groupLen);
    const beamable = !e.rest && BEAMABLE.has(e.value.type);
    if (!beamable || group !== runGroup || e.value.triplet !== runTriplet) flush();
    if (beamable) {
      run.push(e);
      runGroup = group;
      runTriplet = e.value.triplet;
    }
  }
  flush();
  // Tuplets: consecutive triplet events within the same beat.
  let i = 0;
  while (i < v.events.length) {
    const e = v.events[i];
    if (!e.value.triplet) {
      i++;
      continue;
    }
    const beat = Math.floor(e.start / DIV);
    let j = i;
    while (j + 1 < v.events.length && v.events[j + 1].value.triplet && Math.floor(v.events[j + 1].start / DIV) === beat) j++;
    const members = v.events.slice(i, j + 1);
    const fullyBeamed =
      members.every((x) => !x.rest && x.beam) && members[0].beam === 'begin' && members[members.length - 1].beam === 'end';
    members[0].tuplet = 'start';
    members[members.length - 1].tuplet = members.length === 1 ? 'start' : 'stop';
    members[0].tupletBracket = !fullyBeamed;
    i = j + 1;
  }
}

function computeDynamics(
  notes: WNote[],
  measures: NMeasureInfo[],
  sensitivity: 'low' | 'medium' | 'high',
): { pos: number; mark: DynamicMark }[] {
  // Analysis windows: half bars (high), bars (medium) or two bars (low).
  const windows: { start: number; end: number }[] = [];
  for (const m of measures) {
    if (sensitivity === 'high' && m.length >= DIV * 2) {
      const half = Math.round(m.length / 2 / DIV) * DIV || m.length / 2;
      windows.push({ start: m.start, end: m.start + half }, { start: m.start + half, end: m.start + m.length });
    } else windows.push({ start: m.start, end: m.start + m.length });
  }
  if (sensitivity === 'low') {
    for (let i = 0; i + 1 < windows.length; i++) {
      windows[i].end = windows[i + 1].end;
      windows.splice(i + 1, 1);
    }
  }
  const values = windows.map((w) => {
    const ns = notes.filter((n) => n.qOn >= w.start && n.qOn < w.end);
    if (!ns.length) return null;
    return { pos: Math.min(...ns.map((n) => n.qOn)), v: loudness(ns.map((n) => n.velocity)) };
  });
  const present = values.filter((x): x is { pos: number; v: number } => x !== null);
  const smoothed = present.map((x, i) => {
    const prev = present[i - 1]?.v ?? x.v;
    const next = present[i + 1]?.v ?? x.v;
    return { pos: x.pos, v: 0.6 * x.v + 0.2 * prev + 0.2 * next };
  });
  const hysteresis = sensitivity === 'high' ? 3 : sensitivity === 'medium' ? 6 : 14;
  const out: { pos: number; mark: DynamicMark }[] = [];
  let current = -1;
  for (const s of smoothed) {
    const level = dynamicLevelIndex(s.v);
    if (current === -1) {
      current = level;
      out.push({ pos: s.pos, mark: DYNAMIC_LEVELS[level].mark });
      continue;
    }
    if (level === current) continue;
    if (Math.abs(s.v - DYNAMIC_LEVELS[current].velocity) < 8 + hysteresis) continue;
    current = level;
    out.push({ pos: s.pos, mark: DYNAMIC_LEVELS[level].mark });
  }
  return out;
}

/** Perceived loudness of a group of notes: the mean of the louder half (melody dominates). */
function loudness(velocities: number[]): number {
  const sorted = [...velocities].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  return top.reduce((s, v) => s + v, 0) / top.length;
}

/** Crescendo / diminuendo hairpins from steady velocity trends of the loudest note per beat. */
function computeHairpins(notes: WNote[]): { start: number; end: number; type: 'crescendo' | 'diminuendo' }[] {
  const byBeat = new Map<number, number>();
  for (const n of notes) {
    const b = Math.floor(n.qOn / DIV);
    byBeat.set(b, Math.max(byBeat.get(b) ?? 0, n.velocity));
  }
  const pts = [...byBeat.entries()].sort((a, b) => a[0] - b[0]).map(([b, v]) => ({ x: b, v }));
  const fit = (seg: { x: number; v: number }[]) => {
    const n = seg.length;
    const mx = seg.reduce((s, p) => s + p.x, 0) / n;
    const mv = seg.reduce((s, p) => s + p.v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const p of seg) {
      sxy += (p.x - mx) * (p.v - mv);
      sxx += (p.x - mx) ** 2;
      syy += (p.v - mv) ** 2;
    }
    const slope = sxx ? sxy / sxx : 0;
    const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
    // Share of steps that move in the direction of the trend (flat steps count half).
    let agree = 0;
    for (let i = 1; i < n; i++) {
      const d = seg[i].v - seg[i - 1].v;
      agree += Math.abs(d) <= 1 ? 0.5 : Math.sign(d) === Math.sign(slope) ? 1 : 0;
    }
    return { slope, r2, change: slope * (seg[n - 1].x - seg[0].x), monotonic: agree / (n - 1) };
  };
  const out: { start: number; end: number; type: 'crescendo' | 'diminuendo' }[] = [];
  let i = 0;
  while (i < pts.length - 3) {
    let bestJ = -1;
    let bestType: 'crescendo' | 'diminuendo' = 'crescendo';
    for (let j = i + 3; j < pts.length && pts[j].x - pts[i].x <= 32; j++) {
      // Do not bridge long silences.
      if (pts[j].x - pts[j - 1].x > 2) break;
      const f = fit(pts.slice(i, j + 1));
      if (f.r2 >= 0.55 && f.monotonic >= 0.7 && Math.abs(f.slope) >= 2 && Math.abs(f.change) >= 14) {
        bestJ = j;
        bestType = f.slope > 0 ? 'crescendo' : 'diminuendo';
      }
    }
    if (bestJ > 0) {
      out.push({ start: pts[i].x * DIV, end: pts[bestJ].x * DIV, type: bestType });
      i = bestJ + 1;
    } else i++;
  }
  return out;
}

function pedalMarks(
  controls: readonly ControlEvent[],
  toDiv: (tick: number) => number,
  snap: (pos: number) => number,
  scoreEnd: number,
  grid: number,
  lines: boolean,
): { pos: number; type: 'start' | 'stop' | 'change' }[] {
  const intervals = pedalIntervals(controls, 64)
    .map(([d, u]) => [snap(toDiv(d)), u === Infinity ? scoreEnd : snap(toDiv(u))] as [number, number])
    .map(([d, u]) => [Math.max(0, d), Math.min(scoreEnd, u)] as [number, number])
    .filter(([d, u]) => u - d >= grid && d < scoreEnd && u > 0);
  const out: { pos: number; type: 'start' | 'stop' | 'change' }[] = [];
  for (let i = 0; i < intervals.length; i++) {
    const [d, u] = intervals[i];
    const prev = intervals[i - 1];
    if (prev && d - prev[1] <= grid) {
      // Quick release + re-press: a pedal change.
      out.pop();
      const at = Math.max(prev[1], d);
      if (lines) out.push({ pos: at, type: 'stop' }, { pos: at, type: 'start' });
      else out.push({ pos: at, type: 'change' });
    } else out.push({ pos: d, type: 'start' });
    out.push({ pos: Math.min(u, scoreEnd), type: 'stop' });
  }
  return out;
}

function tempoMarks(
  project: Project,
  o: SheetExportOptions,
  startBpm: number,
  beatsOfTick: (tick: number) => number,
  origin: number,
  scoreEnd: number,
  measures: NMeasureInfo[],
  warnings: string[],
): { pos: number; text: string; unit: NoteType; dotted: boolean; perMinute: number; quarterBpm: number }[] {
  const first = measures.find((m) => !m.implicit) ?? measures[0];
  const unit = beatUnitFor(first.meter);
  const scale = o.durationScale;
  const out = [
    {
      pos: 0,
      text: o.tempoText,
      unit: unit.unit,
      dotted: unit.dotted,
      perMinute: Math.round(startBpm / unit.quarterFactor),
      quarterBpm: startBpm,
    },
  ];
  if (o.timing !== 'project' || !o.showTempoChanges || o.tempoBpmOverride > 0) return out;
  const changes = project.tempos
    .map((t) => ({ pos: Math.round(((beatsOfTick(t.tick) - origin) * DIV) / DIV) * DIV, bpm: t.bpm * scale }))
    .filter((c) => c.pos > 0 && c.pos < scoreEnd);
  if (changes.length === 0) return out;
  const bars = measures.length;
  if (changes.length > Math.max(4, bars / 2)) {
    warnings.push('The tempo map changes very often (rubato); only the initial tempo is shown.');
    return out;
  }
  let last = startBpm;
  for (const c of changes) {
    if (Math.abs(c.bpm - last) < 1) continue;
    last = c.bpm;
    const m = measures.find((x) => c.pos >= x.start && c.pos < x.start + x.length) ?? first;
    const u = beatUnitFor(m.meter);
    out.push({ pos: c.pos, text: '', unit: u.unit, dotted: u.dotted, perMinute: Math.round(c.bpm / u.quarterFactor), quarterBpm: c.bpm });
  }
  return out;
}
