// Musical analysis used by the notation engine: key detection and tempo estimation.

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Key signature (fifths) of a major key by tonic pitch class. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export interface KeyEstimate {
  fifths: number;
  mode: 'major' | 'minor';
  tonic: number;
  /** Pearson correlation of the best key (0..1, higher = more certain). */
  confidence: number;
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Krumhansl–Schmuckler key finding, weighting pitch classes by duration. */
export function detectKey(notes: readonly { pitch: number; duration: number }[]): KeyEstimate {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.pitch % 12) + 12) % 12] += Math.min(n.duration, 4) + 0.25;
  if (hist.every((h) => h === 0)) return { fifths: 0, mode: 'major', tonic: 0, confidence: 0 };
  let best: KeyEstimate = { fifths: 0, mode: 'major', tonic: 0, confidence: -Infinity };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = hist.map((_, i) => hist[(i + tonic) % 12]);
    const maj = correlation(rotated, MAJOR_PROFILE);
    const min = correlation(rotated, MINOR_PROFILE);
    if (maj > best.confidence) best = { fifths: MAJOR_FIFTHS[tonic], mode: 'major', tonic, confidence: maj };
    if (min > best.confidence)
      best = { fifths: MAJOR_FIFTHS[(tonic + 3) % 12], mode: 'minor', tonic, confidence: min };
  }
  // Prefer the enharmonic spelling with fewer accidentals (Gb vs F#: 6 either way -> keep sharps).
  if (best.fifths < -6) best.fifths += 12;
  return { ...best, confidence: Math.max(0, best.confidence) };
}

export interface TempoEstimate {
  bpm: number;
  /** Time (s) of the first beat at or before the first note. */
  offsetSec: number;
  confidence: number;
}

/**
 * Estimates the tempo of a freely played performance by fitting a beat grid to the note
 * onsets. Returns the best tempo between 40 and 220 BPM and the phase of the grid.
 */
export function estimateTempo(onsetsSec: readonly number[], weights?: readonly number[]): TempoEstimate | null {
  if (onsetsSec.length < 4) return null;
  // Merge near-simultaneous onsets (chords) into single weighted events.
  const order = onsetsSec.map((t, i) => [t, weights?.[i] ?? 1] as const).sort((a, b) => a[0] - b[0]);
  const events: { t: number; w: number }[] = [];
  for (const [t, w] of order) {
    const last = events[events.length - 1];
    if (last && t - last.t < 0.04) last.w += w * 0.5;
    else events.push({ t, w });
  }
  if (events.length < 4) return null;
  const ev = events.slice(0, 600);
  const totalW = ev.reduce((s, e) => s + e.w, 0);
  const sigma = 0.03;
  const k = 1 / (2 * sigma * sigma);

  const scoreFor = (period: number, phase: number): number => {
    let s = 0;
    for (const e of ev) {
      const x = (e.t - phase) / period;
      const dBeat = Math.abs(x - Math.round(x)) * period;
      const dHalf = Math.abs(x - 0.5 - Math.round(x - 0.5)) * period;
      s += e.w * Math.max(Math.exp(-dBeat * dBeat * k), 0.55 * Math.exp(-dHalf * dHalf * k));
    }
    return s / totalW;
  };
  const prior = (bpm: number): number => Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.7) ** 2);

  const anchors = ev.slice(0, Math.min(12, ev.length)).map((e) => e.t);
  let best = { bpm: 120, phase: ev[0].t, score: -Infinity, raw: 0 };
  for (let bpm = 40; bpm <= 220; bpm += 0.5) {
    const period = 60 / bpm;
    for (const a of anchors) {
      const raw = scoreFor(period, a);
      const score = raw * (0.65 + 0.35 * prior(bpm));
      if (score > best.score) best = { bpm, phase: a, score, raw };
    }
  }
  // Refine around the best candidate.
  for (let bpm = best.bpm - 0.5; bpm <= best.bpm + 0.5; bpm += 0.05) {
    const period = 60 / bpm;
    for (let dp = -0.02; dp <= 0.02; dp += 0.005) {
      const raw = scoreFor(period, best.phase + dp);
      const score = raw * (0.65 + 0.35 * prior(bpm));
      if (score > best.score) best = { bpm, phase: best.phase + dp, score, raw };
    }
  }
  const period = 60 / best.bpm;
  const first = ev[0].t;
  const beatsBefore = Math.floor((first - best.phase) / period + 0.15);
  const offsetSec = best.phase + beatsBefore * period;
  return { bpm: Math.round(best.bpm * 10) / 10, offsetSec, confidence: best.raw };
}

/**
 * Suggests a pickup length (in quarter notes) when the music starts late in the first bar.
 * Returns 0 when the first note is on (or close to) the downbeat.
 */
export function suggestPickup(firstOnsetInBarBeats: number, barLengthBeats: number): number {
  if (firstOnsetInBarBeats < 0.25 || firstOnsetInBarBeats >= barLengthBeats) return 0;
  const pickup = barLengthBeats - firstOnsetInBarBeats;
  // Round to an eighth note.
  return Math.round(pickup * 2) / 2;
}
