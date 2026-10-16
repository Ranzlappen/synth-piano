// Prints engraved SVG pages to a vector PDF using Chromium's PDF backend.
import { app, BrowserWindow } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PdfRequest } from '../shared/api';
import { pagesToHtml } from '../shared/print';

export async function renderPdf(req: PdfRequest): Promise<Buffer> {
  const dir = await mkdtemp(join(app.getPath('temp'), 'synth-piano-pdf-'));
  const file = join(dir, 'score.html');
  await writeFile(file, pagesToHtml(req), 'utf8');
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      generateDocumentOutline: false,
    });
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}
