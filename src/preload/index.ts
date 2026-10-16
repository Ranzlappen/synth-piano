// Exposes a small, typed API to the renderer. The renderer has no Node.js access.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type MenuCommand, type OpenedFile, type SynthPianoApi, type UpdateStatus } from '../shared/api';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: SynthPianoApi = {
  isElectron: true,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openFile: (kind) => ipcRenderer.invoke(IPC.openFile, kind),
  readFile: (path) => ipcRenderer.invoke(IPC.readFile, path),
  saveFile: (request) => ipcRenderer.invoke(IPC.saveFile, request),
  exportPdf: (request) => ipcRenderer.invoke(IPC.exportPdf, request),
  showItemInFolder: (path) => ipcRenderer.invoke(IPC.showItem, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  loadSettings: () => ipcRenderer.invoke(IPC.loadSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  getRecentFiles: () => ipcRenderer.invoke(IPC.recentGet),
  addRecentFile: (path) => ipcRenderer.invoke(IPC.recentAdd, path),
  clearRecentFiles: () => ipcRenderer.invoke(IPC.recentClear),
  writeAutosave: (text) => ipcRenderer.invoke(IPC.autosaveWrite, text),
  readAutosave: () => ipcRenderer.invoke(IPC.autosaveRead),
  clearAutosave: () => ipcRenderer.invoke(IPC.autosaveClear),
  setDocumentState: (state) => ipcRenderer.send(IPC.documentState, state),
  closeWindow: () => ipcRenderer.send(IPC.closeWindow),
  checkForUpdates: (silent) => ipcRenderer.invoke(IPC.updateCheck, silent),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.send(IPC.updateInstall),
  onMenuCommand: (cb) => subscribe<MenuCommand>(IPC.menuCommand, cb),
  onOpenFile: (cb) => subscribe<OpenedFile>(IPC.openFileEvent, cb),
  onCloseRequested: (cb) => subscribe<void>(IPC.closeRequested, cb),
  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IPC.updateStatus, cb),
  refreshMenu: () => ipcRenderer.send(IPC.refreshMenu),
};

contextBridge.exposeInMainWorld('synthPiano', api);
