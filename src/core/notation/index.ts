import type { Project } from '../model';
import { TempoMap } from '../timing';
import { estimateTempo, type TempoEstimate } from './analysis';
import { buildPageHeadersMei, buildVerovioOptions, pageGeometry, type PageGeometry } from './engrave';
import { toMusicXml } from './musicxml';
import type { SheetExportOptions } from './options';
import { transcribe, type TranscriptionStats } from './transcribe';

export * from './options';
export { transcribe } from './transcribe';
export { toMusicXml } from './musicxml';
export { buildPageHeadersMei, buildVerovioOptions, injectPageHeaders, pageGeometry } from './engrave';
export { detectKey, estimateTempo } from './analysis';

export interface SheetMusicJob {
  musicxml: string;
  verovioOptions: Record<string, unknown>;
  pageHeaders: string;
  geometry: PageGeometry;
  stats: TranscriptionStats;
}

/** Everything the engraver needs for a project and a set of export options. */
export function buildSheetMusic(project: Project, options: SheetExportOptions, software = 'Synth Piano'): SheetMusicJob {
  const score = transcribe(project, options);
  const programs: Record<string, number> = {};
  for (const p of score.parts) {
    const track = project.tracks.find((t) => t.id === p.id) ?? project.tracks.find((t) => t.notes.length > 0);
    programs[p.id] = track?.program ?? 0;
  }
  return {
    musicxml: toMusicXml(score, { software, measureNumbers: options.measureNumbers, programs }),
    verovioOptions: buildVerovioOptions(options),
    pageHeaders: buildPageHeadersMei(options),
    geometry: pageGeometry(options),
    stats: score.stats,
  };
}

/** Tempo and first-downbeat estimate for freely played (unquantised) recordings. */
export function analyzePerformance(project: Project, options: SheetExportOptions): TempoEstimate | null {
  const tempoMap = new TempoMap(project.tempos, project.ppq);
  const tracks = (
    options.trackIds.length ? project.tracks.filter((t) => options.trackIds.includes(t.id)) : project.tracks
  ).filter((t) => t.notes.length);
  const onsets: number[] = [];
  const weights: number[] = [];
  for (const t of tracks)
    for (const n of t.notes) {
      onsets.push(tempoMap.tickToSeconds(n.tick));
      weights.push(0.5 + n.velocity / 127);
    }
  return estimateTempo(onsets, weights);
}
