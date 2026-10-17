// Contract between the Electron main process (via preload) and the renderer.
// The renderer talks to `window.synthPiano`; in a plain browser a fallback
// implementation with the same interface is used (see renderer/src/platform).

export type FileKind = 'project' | 'midi' | 'musicxml' | 'pdf';

export interface OpenedFile {
  path: string;
  name: string;
  kind: 'project' | 'midi';
  /** Project files are text, MIDI files are binary. */
  text?: string;
  bytes?: Uint8Array;
}

export interface SaveRequest {
  /** Existing path to overwrite silently; omitted = show a save dialog. */
  path?: string;
  suggestedName: string;
  kind: FileKind;
  data: string | Uint8Array;
}

export interface PdfRequest {
  /** One SVG document per page. */
  pages: string[];
  widthMm: number;
  heightMm: number;
  suggestedName: string;
  title: string;
  openAfterExport: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  isPackaged: boolean;
  isPortable: boolean;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unavailable'; version: string }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'unsupported'; reason: string };

export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:saveAs'
  | 'file:importMidi'
  | 'file:exportMidi'
  | 'file:exportSheet'
  | 'file:projectInfo'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:cut'
  | 'edit:copy'
  | 'edit:paste'
  | 'edit:delete'
  | 'edit:selectAll'
  | 'edit:duplicate'
  | 'edit:quantize'
  | 'edit:transposeUp'
  | 'edit:transposeDown'
  | 'edit:legato'
  | 'edit:humanize'
  | 'transport:play'
  | 'transport:stop'
  | 'transport:record'
  | 'transport:loop'
  | 'transport:metronome'
  | 'transport:capture'
  | 'transport:toStart'
  | 'view:zoomIn'
  | 'view:zoomOut'
  | 'view:zoomFit'
  | 'view:toggleController'
  | 'view:toggleLanes'
  | 'view:follow'
  | 'track:add'
  | 'track:delete'
  | 'midi:settings'
  | 'midi:panic'
  | 'app:preferences'
  | 'help:shortcuts'
  | 'help:about'
  | 'help:checkUpdates';

export interface SynthPianoApi {
  readonly isElectron: boolean;
  getAppInfo(): Promise<AppInfo>;

  openFile(kind: 'project' | 'midi' | 'any'): Promise<OpenedFile | null>;
  readFile(path: string): Promise<OpenedFile | null>;
  /** Returns the saved path, or null when cancelled. */
  saveFile(request: SaveRequest): Promise<string | null>;
  exportPdf(request: PdfRequest): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  loadSettings(): Promise<unknown>;
  saveSettings(settings: unknown): Promise<void>;
  getRecentFiles(): Promise<string[]>;
  addRecentFile(path: string): Promise<string[]>;
  clearRecentFiles(): Promise<void>;

  writeAutosave(text: string): Promise<void>;
  readAutosave(): Promise<string | null>;
  clearAutosave(): Promise<void>;

  /** Window title and unsaved-changes flag (used for close protection). */
  setDocumentState(state: { title: string; dirty: boolean }): void;
  /** Closes the window without asking again (after the renderer confirmed). */
  closeWindow(): void;

  checkForUpdates(silent: boolean): Promise<UpdateStatus>;
  downloadUpdate(): Promise<void>;
  installUpdate(): void;

  onMenuCommand(cb: (command: MenuCommand) => void): () => void;
  onOpenFile(cb: (file: OpenedFile) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Rebuilds the "Open Recent" menu. */
  refreshMenu(): void;
}

export const IPC = {
  appInfo: 'app:info',
  openFile: 'file:open',
  readFile: 'file:read',
  saveFile: 'file:save',
  exportPdf: 'file:exportPdf',
  showItem: 'shell:showItem',
  openExternal: 'shell:openExternal',
  loadSettings: 'settings:load',
  saveSettings: 'settings:save',
  recentGet: 'recent:get',
  recentAdd: 'recent:add',
  recentClear: 'recent:clear',
  autosaveWrite: 'autosave:write',
  autosaveRead: 'autosave:read',
  autosaveClear: 'autosave:clear',
  documentState: 'window:documentState',
  closeWindow: 'window:close',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  refreshMenu: 'menu:refresh',
  // main -> renderer
  menuCommand: 'menu:command',
  openFileEvent: 'file:openEvent',
  closeRequested: 'window:closeRequested',
  updateStatus: 'update:status',
} as const;

export const PROJECT_EXT = 'synthpiano';
export const MIDI_EXTS = ['mid', 'midi', 'kar', 'rmi'];
