// Update checks against GitHub Releases (installer builds only).
import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import { IPC, type UpdateStatus } from '../shared/api';

const { autoUpdater } = electronUpdater;

export function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

let initialised = false;
let lastStatus: UpdateStatus = { state: 'idle' };

export function setupUpdater(getWindow: () => BrowserWindow | null): void {
  if (initialised) return;
  initialised = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = (status: UpdateStatus) => {
    lastStatus = status;
    getWindow()?.webContents.send(IPC.updateStatus, status);
  };
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    send({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    }),
  );
  autoUpdater.on('update-not-available', (info) => send({ state: 'unavailable', version: info.version }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => send({ state: 'error', message: err?.message ?? String(err) }));
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged)
    return { state: 'unsupported', reason: 'Updates are only available in installed builds.' };
  if (isPortable())
    return {
      state: 'unsupported',
      reason: 'The portable version cannot update itself. Download the latest release instead.',
    };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return lastStatus;
    const available = result.updateInfo.version !== app.getVersion() && result.isUpdateAvailable !== false;
    return available
      ? { state: 'available', version: result.updateInfo.version }
      : { state: 'unavailable', version: app.getVersion() };
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate();
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
