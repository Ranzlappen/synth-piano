// Browser implementation of the platform API (development and UI tests without Electron).
import type { OpenedFile, SynthPianoApi, UpdateStatus } from '@shared/api';
import { MIDI_EXTS, PROJECT_EXT } from '@shared/api';
import { pagesToHtml } from '@shared/print';

const LS = {
  settings: 'synth-piano:settings',
  recent: 'synth-piano:recent',
  autosave: 'synth-piano:autosave',
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function toOpened(file: File): Promise<OpenedFile | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === PROJECT_EXT)
    return { path: file.name, name: file.name, kind: 'project', text: await file.text() };
  if (MIDI_EXTS.includes(ext))
    return {
      path: file.name,
      name: file.name,
      kind: 'midi',
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  return null;
}

function download(name: string, data: string | Uint8Array, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const MIME = {
  project: 'application/json',
  midi: 'audio/midi',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  pdf: 'application/pdf',
};

export const browserApi: SynthPianoApi = {
  isElectron: false,
  async getAppInfo() {
    return {
      name: 'Synth Piano',
      version: import.meta.env.VITE_APP_VERSION ?? 'dev',
      platform: navigator.platform,
      electron: '-',
      chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '-',
      isPackaged: false,
      isPortable: false,
    };
  },
  async openFile(kind) {
    const accept =
      kind === 'project'
        ? `.${PROJECT_EXT}`
        : kind === 'midi'
          ? MIDI_EXTS.map((e) => `.${e}`).join(',')
          : [PROJECT_EXT, ...MIDI_EXTS].map((e) => `.${e}`).join(',');
    const file = await pickFile(accept);
    return file ? toOpened(file) : null;
  },
  async readFile() {
    return null;
  },
  async saveFile(req) {
    const name = req.path?.split(/[\\/]/).pop() ?? req.suggestedName;
    download(name, req.data, MIME[req.kind]);
    return name;
  },
  async exportPdf(req) {
    const w = window.open('', '_blank');
    if (!w) return null;
    w.document.write(pagesToHtml(req));
    w.document.close();
    w.addEventListener('load', () => w.print());
    setTimeout(() => w.print(), 500);
    return req.suggestedName;
  },
  async showItemInFolder() {},
  async openExternal(url) {
    window.open(url, '_blank', 'noopener');
  },
  async loadSettings() {
    const raw = lsGet(LS.settings);
    return raw ? JSON.parse(raw) : null;
  },
  async saveSettings(settings) {
    lsSet(LS.settings, JSON.stringify(settings));
  },
  async getRecentFiles() {
    return [];
  },
  async addRecentFile() {
    return [];
  },
  async clearRecentFiles() {},
  async writeAutosave(text) {
    lsSet(LS.autosave, text);
  },
  async readAutosave() {
    return lsGet(LS.autosave);
  },
  async clearAutosave() {
    lsSet(LS.autosave, null);
  },
  setDocumentState(state) {
    document.title = `${state.dirty ? '• ' : ''}${state.title} — Synth Piano`;
  },
  closeWindow() {},
  async checkForUpdates(): Promise<UpdateStatus> {
    return { state: 'unsupported', reason: 'Updates are only available in the desktop app.' };
  },
  async downloadUpdate() {},
  installUpdate() {},
  onMenuCommand() {
    return () => undefined;
  },
  onOpenFile() {
    return () => undefined;
  },
  onCloseRequested() {
    return () => undefined;
  },
  onUpdateStatus() {
    return () => undefined;
  },
  refreshMenu() {},
};
