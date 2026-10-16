/* Engraving worker: MusicXML -> MEI (+ page headers) -> SVG pages, using Verovio.
 * Verovio (LGPL-3.0) is loaded as an unmodified, separate file so it can be replaced. */
'use strict';

importScripts('../vendor/verovio/verovio-toolkit-wasm.js');

let toolkit = null;
const ready = new Promise((resolve, reject) => {
  const mod = self.verovio.module;
  const done = () => {
    try {
      toolkit = new self.verovio.toolkit();
      resolve();
    } catch (err) {
      reject(err);
    }
  };
  if (mod.calledRun) done();
  else mod.onRuntimeInitialized = done;
});

function injectPageHeaders(mei, headers) {
  const cleaned = mei
    .replace(/<pgHead[\s\S]*?<\/pgHead>/g, '')
    .replace(/<pgFoot[\s\S]*?<\/pgFoot>/g, '')
    .replace(/<pg(Head|Foot)[^>]*\/>/g, '');
  return cleaned.replace(/(<scoreDef\b[^>]*>)/, '$1' + headers);
}

self.onmessage = async (event) => {
  const { id, musicxml, options, headers } = event.data;
  try {
    await ready;
    toolkit.setOptions(options);
    if (!toolkit.loadData(musicxml)) throw new Error('The engraver could not read the generated score.');
    const mei = injectPageHeaders(toolkit.getMEI(), headers);
    if (!toolkit.loadData(mei)) throw new Error('The engraver could not lay out the score.');
    const count = toolkit.getPageCount();
    const pages = [];
    for (let i = 1; i <= count; i++) pages.push(toolkit.renderToSVG(i));
    self.postMessage({ id, ok: true, pages, version: toolkit.getVersion() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
