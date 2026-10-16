// Developer aid: writes the engraved test performance to disk for visual inspection.
// Runs only when SAMPLE_OUT is set, e.g.
//   SAMPLE_OUT=/tmp/sample SAMPLE_OPTS='{"pedal":"lines"}' npx vitest run tests/notation/sample-output.test.ts
import { it } from 'vitest';
import fs from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { buildSheetMusic, injectPageHeaders, resolveSheetOptions } from '@core/notation';
import { pianoPerformance } from '../fixtures/performance';
import { projectToSmf } from '@core/midi/convert';
import { writeSmf } from '@core/midi/smf';

const out = process.env.SAMPLE_OUT;

it.skipIf(!out)('writes sample engraving', async () => {
  const tk = new VerovioToolkit(await createVerovioModule());
  const project = pianoPerformance({ jitterTicks: Number(process.env.SAMPLE_JITTER ?? 40) });
  const options = resolveSheetOptions(project, JSON.parse(process.env.SAMPLE_OPTS ?? '{}'));
  const job = buildSheetMusic(project, options);
  tk.setOptions(job.verovioOptions);
  tk.loadData(job.musicxml);
  tk.loadData(injectPageHeaders(tk.getMEI(), job.pageHeaders));
  fs.writeFileSync(`${out}.musicxml`, job.musicxml);
  fs.writeFileSync(`${out}.mid`, writeSmf(projectToSmf(project)));
  for (let i = 1; i <= tk.getPageCount(); i++) fs.writeFileSync(`${out}-${i}.svg`, tk.renderToSVG(i));
});
