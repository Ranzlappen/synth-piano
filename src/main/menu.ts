import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { basename } from 'node:path';
import { IPC, type MenuCommand } from '../shared/api';
import { clearRecentFiles, getRecentFiles, readOpenedFile } from './files';

const REPO_URL = 'https://github.com/Ranzlappen/synth-piano';

/**
 * Builds the application menu. Shortcuts are handled by the renderer (so they also
 * work in the browser build); the menu only displays them (`registerAccelerator: false`).
 */
export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (command: MenuCommand) => getWindow()?.webContents.send(IPC.menuCommand, command);
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(command),
  });
  const recent = getRecentFiles();
  const recentMenu: MenuItemConstructorOptions[] = recent.length
    ? [
        ...recent.map((path) => ({
          label: basename(path),
          sublabel: path,
          click: async () => {
            const file = await readOpenedFile(path);
            if (file) getWindow()?.webContents.send(IPC.openFileEvent, file);
          },
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent',
          click: () => {
            clearRecentFiles();
            buildMenu(getWindow);
          },
        },
      ]
    : [{ label: 'No recent files', enabled: false }];

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('New Project', 'file:new', 'CmdOrCtrl+N'),
        item('Open…', 'file:open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recentMenu },
        { type: 'separator' },
        item('Save', 'file:save', 'CmdOrCtrl+S'),
        item('Save As…', 'file:saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Import MIDI File…', 'file:importMidi', 'CmdOrCtrl+I'),
        item('Export MIDI File…', 'file:exportMidi', 'CmdOrCtrl+E'),
        item('Export Sheet Music (PDF / MusicXML)…', 'file:exportSheet', 'CmdOrCtrl+P'),
        { type: 'separator' },
        item('Project Info…', 'file:projectInfo'),
        item('Preferences…', 'app:preferences', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        item('Undo', 'edit:undo', 'CmdOrCtrl+Z'),
        item('Redo', 'edit:redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        item('Cut', 'edit:cut', 'CmdOrCtrl+X'),
        item('Copy', 'edit:copy', 'CmdOrCtrl+C'),
        item('Paste', 'edit:paste', 'CmdOrCtrl+V'),
        item('Duplicate', 'edit:duplicate', 'CmdOrCtrl+D'),
        item('Delete', 'edit:delete', 'Delete'),
        item('Select All', 'edit:selectAll', 'CmdOrCtrl+A'),
        { type: 'separator' },
        item('Quantize…', 'edit:quantize', 'Q'),
        item('Transpose Up', 'edit:transposeUp', 'Up'),
        item('Transpose Down', 'edit:transposeDown', 'Down'),
        item('Legato', 'edit:legato', 'CmdOrCtrl+L'),
        item('Humanize', 'edit:humanize', 'CmdOrCtrl+H'),
      ],
    },
    {
      label: '&Transport',
      submenu: [
        item('Play / Pause', 'transport:play', 'Space'),
        item('Stop', 'transport:stop', 'Enter'),
        item('Record', 'transport:record', 'R'),
        item('Capture Last Performance', 'transport:capture', 'CmdOrCtrl+Shift+R'),
        item('Go to Start', 'transport:toStart', 'Home'),
        { type: 'separator' },
        item('Loop', 'transport:loop', 'L'),
        item('Metronome', 'transport:metronome', 'M'),
      ],
    },
    {
      label: '&Track',
      submenu: [item('Add Track', 'track:add', 'CmdOrCtrl+T'), item('Delete Track', 'track:delete')],
    },
    {
      label: '&View',
      submenu: [
        item('Zoom In', 'view:zoomIn', 'CmdOrCtrl+='),
        item('Zoom Out', 'view:zoomOut', 'CmdOrCtrl+-'),
        item('Zoom to Fit', 'view:zoomFit', 'CmdOrCtrl+0'),
        item('Follow Playhead', 'view:follow', 'F'),
        { type: 'separator' },
        item('Controller Panel', 'view:toggleController', 'CmdOrCtrl+K'),
        item('Velocity / Controller Lanes', 'view:toggleLanes', 'CmdOrCtrl+J'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', visible: !app.isPackaged },
        { role: 'reload', visible: !app.isPackaged },
      ],
    },
    {
      label: '&MIDI',
      submenu: [
        item('MIDI Devices…', 'midi:settings'),
        item('Panic (All Notes Off)', 'midi:panic', 'Escape'),
      ],
    },
    {
      label: '&Help',
      submenu: [
        item('Keyboard Shortcuts', 'help:shortcuts', 'F1'),
        item('Check for Updates…', 'help:checkUpdates'),
        { label: 'Project Website', click: () => shell.openExternal(REPO_URL) },
        { label: 'Report an Issue', click: () => shell.openExternal(`${REPO_URL}/issues`) },
        { type: 'separator' },
        item('About Synth Piano', 'help:about'),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
