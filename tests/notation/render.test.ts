// End-to-end: performance -> MusicXML -> Verovio -> SVG pages (the same path as the app).
import { describe, expect, it, beforeAll } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { buildSheetMusic, injectPageHeaders, resolveSheetOptions } from '@core/notation';
import { pianoPerformance } from '../fixtures/performance';

let tk: VerovioToolkit;
beforeAll(async () => {
  tk = new VerovioToolkit(await createVerovioModule());
});

function engrave(job: ReturnType<typeof buildSheetMusic>) {
  tk.setOptions(job.verovioOptions);
  expect(tk.loadData(job.musicxml)).toBeTruthy();
  const mei = injectPageHeaders(tk.getMEI(), job.pageHeaders);
  expect(tk.loadData(mei)).toBeTruthy();
  const pages = tk.getPageCount();
  return { mei, pages, svgs: Array.from({ length: pages }, (_, i) => tk.renderToSVG(i + 1)) };
}

describe('engraving with Verovio', () => {
  it('renders the performance with all expression marks', () => {
    const project = pianoPerformance();
    const options = resolveSheetOptions(project, { tempoText: 'Andante' });
    const job = buildSheetMusic(project, options, 'Synth Piano test');
    const { mei, pages, svgs } = engrave(job);
    expect(pages).toBe(1);
    for (const tag of ['<pedal', '<dynam', '<hairpin', '<tuplet', '<beam', '<tempo', 'una corda', 'Test Piece', 'Test Composer'])
      expect(mei, tag).toContain(tag);
    expect(svgs[0]).toContain('viewBox');
    expect(tk.getLog()).not.toMatch(/error/i);
  });

  it('paginates long scores and follows layout options', () => {
    const project = pianoPerformance();
    // Repeat the material to make a long piece.
    const t = project.tracks[0];
    const len = 6 * 4 * 960;
    const notes = [...t.notes];
    for (let r = 1; r < 8; r++) for (const n of t.notes) notes.push({ ...n, id: `${n.id}-${r}`, tick: n.tick + r * len });
    t.notes = notes;
    const options = resolveSheetOptions(project, { measuresPerSystem: 4, staffSizeMm: 8, paper: 'Letter', measureNumbers: 'every' });
    const { pages, mei } = engrave(buildSheetMusic(project, options));
    expect(pages).toBeGreaterThan(1);
    expect((mei.match(/<sb /g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});
