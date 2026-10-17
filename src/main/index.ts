import { app, BrowserWindow, ipcMain, net, protocol, screen, session, shell } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { IPC, type OpenedFile, type PdfRequest, type SaveRequest } from '../shared/api';
import {
  addRecentFile,
  choosePdfPath,
  clearRecentFiles,
  getRecentFiles,
  isSupportedFile,
  readOpenedFile,
  saveWithDialog,
  showOpenDialog,
} from './files';
import { buildMenu } from './menu';
import { renderPdf } from './pdf';
import { readJson, readText, remove, writeJson, writeText } from './store';
import { checkForUpdates, downloadUpdate, installUpdate, isPortable, setupUpdater } from './updater';
import { writeFile } from 'node:fs/promises';

const here = fileURLToPath(new URL('.', import.meta.url));
const RENDERER_DIR = join(here, '..', 'renderer');
const PRELOAD = join(here, '..', 'preload', 'index.cjs');
const DEV_URL = process.env['ELECTRON_RENDERER_URL'];

app.setAppUserModelId('com.ranzlappen.synthpiano');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

let mainWindow: BrowserWindow | null = null;
let documentDirty = false;
let forceClose = false;
let pendingFile: OpenedFile | null = null;

// ---- single instance & file associations ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', async (_e, argv) => {
    const file = argv.slice(1).find((a) => isSupportedFile(a));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (file) {
      const opened = await readOpenedFile(file);
      if (opened) mainWindow?.webContents.send(IPC.openFileEvent, opened);
    }
  });
}

async function fileFromArgv(): Promise<OpenedFile | null> {
  const file = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => isSupportedFile(a));
  return file ? readOpenedFile(file) : null;
}

// ---- window ----

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

function loadWindowState(): WindowState {
  const s = readJson<WindowState>('window-state.json', { width: 1440, height: 900, maximized: false });
  // Ignore positions on displays that are no longer connected.
  if (s.x !== undefined && s.y !== undefined) {
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return (
        s.x! >= b.x - 50 && s.y! >= b.y - 50 && s.x! < b.x + b.width - 100 && s.y! < b.y + b.height - 100
      );
    });
    if (!visible) {
      delete s.x;
      delete s.y;
    }
  }
  return s;
}

function createWindow(): void {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#14161c',
    title: 'Synth Piano',
    autoHideMenuBar: false,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  const saveState = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    writeJson('window-state.json', { ...b, maximized: win.isMaximized() });
  };
  win.on('close', (e) => {
    saveState();
    if (documentDirty && !forceClose) {
      e.preventDefault();
      win.webContents.send(IPC.closeRequested);
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  // Links open in the system browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingFile) {
      win.webContents.send(IPC.openFileEvent, pendingFile);
      pendingFile = null;
    }
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/index.html');
}

// ---- protocol serving the renderer bundle ----

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = normalize(join(RENDERER_DIR, rel));
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (file.endsWith('.js') || file.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript');
    if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    return new Response(res.body, { status: res.status, headers });
  });
}

// ---- permissions: Web MIDI (incl. SysEx) and nothing else ----

function setupPermissions(): void {
  const allowed = new Set(['midi', 'midiSysex', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowed.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

// ---- IPC ----

function registerIpc(): void {
  const win = () => mainWindow;
  ipcMain.handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: `${process.platform} ${process.getSystemVersion()}`,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    isPackaged: app.isPackaged,
    isPortable: isPortable(),
  }));
  ipcMain.handle(IPC.openFile, (_e, kind: 'project' | 'midi' | 'any') => showOpenDialog(win(), kind));
  ipcMain.handle(IPC.readFile, (_e, path: string) => readOpenedFile(path));
  ipcMain.handle(IPC.saveFile, (_e, req: SaveRequest) => saveWithDialog(win(), req));
  ipcMain.handle(IPC.exportPdf, async (_e, req: PdfRequest) => {
    const target = await choosePdfPath(win(), req.suggestedName);
    if (!target) return null;
    const pdf = await renderPdf(req);
    await writeFile(target, pdf);
    if (req.openAfterExport) void shell.openPath(target);
    return target;
  });
  ipcMain.handle(IPC.showItem, (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle(IPC.loadSettings, () => readJson<unknown>('settings.json', null));
  ipcMain.handle(IPC.saveSettings, (_e, settings: unknown) => writeJson('settings.json', settings));
  ipcMain.handle(IPC.recentGet, () => getRecentFiles());
  ipcMain.handle(IPC.recentAdd, (_e, path: string) => {
    const list = addRecentFile(path);
    buildMenu(win);
    return list;
  });
  ipcMain.handle(IPC.recentClear, () => {
    clearRecentFiles();
    buildMenu(win);
  });
  ipcMain.handle(IPC.autosaveWrite, (_e, text: string) => writeText('autosave.synthpiano', text));
  ipcMain.handle(IPC.autosaveRead, () => readText('autosave.synthpiano'));
  ipcMain.handle(IPC.autosaveClear, () => remove('autosave.synthpiano'));
  ipcMain.on(IPC.documentState, (_e, state: { title: string; dirty: boolean }) => {
    documentDirty = state.dirty;
    mainWindow?.setTitle(`${state.dirty ? '• ' : ''}${state.title} — Synth Piano`);
    mainWindow?.setDocumentEdited(state.dirty);
  });
  ipcMain.on(IPC.closeWindow, () => {
    forceClose = true;
    mainWindow?.close();
  });
  ipcMain.handle(IPC.updateCheck, () => checkForUpdates());
  ipcMain.handle(IPC.updateDownload, () => downloadUpdate());
  ipcMain.on(IPC.updateInstall, () => {
    forceClose = true;
    installUpdate();
  });
  ipcMain.on(IPC.refreshMenu, () => buildMenu(win));
}

// ---- lifecycle ----

app.whenReady().then(async () => {
  registerAppProtocol();
  setupPermissions();
  registerIpc();
  buildMenu(() => mainWindow);
  setupUpdater(() => mainWindow);
  pendingFile = await fileFromArgv();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('open-file', async (e, path) => {
  e.preventDefault();
  const opened = await readOpenedFile(path);
  if (!opened) return;
  if (mainWindow) mainWindow.webContents.send(IPC.openFileEvent, opened);
  else pendingFile = opened;
});
