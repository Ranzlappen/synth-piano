import { app, BrowserWindow, dialog, type FileFilter } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { MIDI_EXTS, PROJECT_EXT, type FileKind, type OpenedFile, type SaveRequest } from '../shared/api';
import { readJson, writeJson } from './store';

const FILTERS: Record<FileKind | 'any', FileFilter[]> = {
  project: [{ name: 'Synth Piano Project', extensions: [PROJECT_EXT] }],
  midi: [{ name: 'MIDI File', extensions: MIDI_EXTS }],
  musicxml: [{ name: 'MusicXML', extensions: ['musicxml', 'xml'] }],
  pdf: [{ name: 'PDF Document', extensions: ['pdf'] }],
  any: [
    { name: 'Projects and MIDI files', extensions: [PROJECT_EXT, ...MIDI_EXTS] },
    { name: 'Synth Piano Project', extensions: [PROJECT_EXT] },
    { name: 'MIDI File', extensions: MIDI_EXTS },
  ],
};

export function isSupportedFile(path: string): boolean {
  const ext = extname(path).slice(1).toLowerCase();
  return ext === PROJECT_EXT || MIDI_EXTS.includes(ext);
}

export async function readOpenedFile(path: string): Promise<OpenedFile | null> {
  const ext = extname(path).slice(1).toLowerCase();
  try {
    if (ext === PROJECT_EXT)
      return { path, name: basename(path), kind: 'project', text: await readFile(path, 'utf8') };
    if (MIDI_EXTS.includes(ext))
      return { path, name: basename(path), kind: 'midi', bytes: new Uint8Array(await readFile(path)) };
  } catch {
    return null;
  }
  return null;
}

export async function showOpenDialog(
  win: BrowserWindow | null,
  kind: 'project' | 'midi' | 'any',
): Promise<OpenedFile | null> {
  const opts = { properties: ['openFile' as const], filters: FILTERS[kind] };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return null;
  return readOpenedFile(result.filePaths[0]);
}

/** Automated tests set this to save without native dialogs. */
const TEST_SAVE_DIR = process.env.SYNTH_PIANO_TEST_SAVE_DIR;

export async function saveWithDialog(win: BrowserWindow | null, req: SaveRequest): Promise<string | null> {
  let target = req.path ?? (TEST_SAVE_DIR ? join(TEST_SAVE_DIR, req.suggestedName) : undefined);
  if (!target) {
    const opts = {
      defaultPath: req.suggestedName,
      filters: FILTERS[req.kind],
      properties: ['showOverwriteConfirmation' as const],
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  await writeFile(target, typeof req.data === 'string' ? req.data : Buffer.from(req.data));
  return target;
}

export async function choosePdfPath(
  win: BrowserWindow | null,
  suggestedName: string,
): Promise<string | null> {
  if (TEST_SAVE_DIR) return join(TEST_SAVE_DIR, suggestedName);
  const opts = {
    defaultPath: suggestedName,
    filters: FILTERS.pdf,
    properties: ['showOverwriteConfirmation' as const],
  };
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  return result.canceled || !result.filePath ? null : result.filePath;
}

const RECENT = 'recent-files.json';
const MAX_RECENT = 10;

export function getRecentFiles(): string[] {
  const list = readJson<unknown>(RECENT, []);
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export function addRecentFile(path: string): string[] {
  const list = [path, ...getRecentFiles().filter((p) => p !== path)].slice(0, MAX_RECENT);
  writeJson(RECENT, list);
  if (process.platform === 'win32') app.addRecentDocument(path);
  return list;
}

export function clearRecentFiles(): void {
  writeJson(RECENT, []);
  app.clearRecentDocuments();
}
