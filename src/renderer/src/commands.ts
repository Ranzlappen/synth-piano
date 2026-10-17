// Central command dispatcher used by the native menu, the toolbar and keyboard shortcuts.
import type { MenuCommand } from '@shared/api';
import {
  copyToClipboard,
  deleteControls,
  deleteNotes,
  duplicateNotes,
  humanizeNotes,
  legatoNotes,
  pasteFromClipboard,
  quantizeNotes,
  transposeNotes,
  moveNotes,
  type ClipboardData,
} from '@core/edit';
import { projectEndTick, sortControls, sortNotes } from '@core/model';
import { engine } from './engine/engine';
import { exportMidi, importMidiTracks, newProject, openDialog, save, saveAs } from './files';
import { api } from './platform';
import { addTrack, selectedTrack, useProject } from './state/project';
import { useSettings } from './state/settings';
import { gridTicksFor, useUi } from './state/ui';

let clipboard: ClipboardData | null = null;

const project = () => useProject.getState();
const ui = () => useUi.getState();

function selectionOrNull(): Set<string> | null {
  const sel = project().selection;
  return sel.size ? new Set(sel) : null;
}

export function gridTicks(): number {
  return gridTicksFor(ui().grid);
}

export function quantizeSelection(opts?: {
  grid?: number;
  strength?: number;
  swing?: number;
  ends?: 'keepLength' | 'quantize';
}): void {
  const ids = selectionOrNull();
  project().commit('Quantize', (d) => {
    const t = d.tracks.find((x) => x.id === project().selectedTrackId)!;
    t.notes = quantizeNotes(t.notes, ids, {
      grid: opts?.grid ?? gridTicks(),
      strength: opts?.strength ?? 1,
      swing: opts?.swing ?? 0,
      ends: opts?.ends ?? 'keepLength',
    });
  });
}

function editSelectedTrack(
  label: string,
  fn: (t: ReturnType<typeof selectedTrack>) => Partial<ReturnType<typeof selectedTrack>>,
): void {
  const id = project().selectedTrackId;
  project().commit(label, (d) => {
    const t = d.tracks.find((x) => x.id === id);
    if (t) Object.assign(t, fn(t));
  });
}

export function transposeSelection(semitones: number): void {
  const ids = selectionOrNull();
  if (!ids) return;
  editSelectedTrack(semitones > 0 ? 'Transpose up' : 'Transpose down', (t) => ({
    notes: transposeNotes(t.notes, ids, semitones),
  }));
  const first = selectedTrack().notes.find((n) => ids.has(n.id));
  if (first) engine.audition(first.pitch, 90, 160);
}

export function nudgeSelection(ticks: number): void {
  const ids = selectionOrNull();
  if (!ids) return;
  editSelectedTrack('Move notes', (t) => ({ notes: moveNotes(t.notes, ids, ticks, 0) }));
}

export function deleteSelection(): void {
  const ids = selectionOrNull();
  const cids = project().controlSelection.size ? new Set(project().controlSelection) : null;
  if (!ids && !cids) return;
  editSelectedTrack('Delete', (t) => ({
    notes: ids ? deleteNotes(t.notes, ids) : t.notes,
    controls: cids ? deleteControls(t.controls, cids) : t.controls,
  }));
  project().setSelection([]);
  project().setControlSelection([]);
}

export function copySelection(cut = false): void {
  const t = selectedTrack();
  const sel = project().selection;
  const csel = project().controlSelection;
  if (!sel.size && !csel.size) return;
  clipboard = copyToClipboard(
    t.notes.filter((n) => sel.has(n.id)),
    t.controls.filter((c) => csel.has(c.id)),
  );
  if (cut) deleteSelection();
}

export function paste(): void {
  if (!clipboard || (!clipboard.notes.length && !clipboard.controls.length)) return;
  const at = Math.round(engine.currentTick());
  const pasted = pasteFromClipboard(clipboard, at);
  editSelectedTrack('Paste', (t) => ({
    notes: sortNotes([...t.notes, ...pasted.notes]),
    controls: sortControls([...t.controls, ...pasted.controls]),
  }));
  project().setSelection(pasted.notes.map((n) => n.id));
  // Move the playhead behind the pasted material so repeated pastes line up.
  ui().set({ cursorTick: at + clipboard.length });
}

export function duplicateSelection(): void {
  const ids = selectionOrNull();
  if (!ids) return;
  const sel = selectedTrack().notes.filter((n) => ids.has(n.id));
  const start = Math.min(...sel.map((n) => n.tick));
  const end = Math.max(...sel.map((n) => n.tick + n.duration));
  const g = gridTicks();
  const offset = Math.max(g, Math.ceil((end - start) / g) * g);
  let newIds: string[] = [];
  editSelectedTrack('Duplicate', (t) => {
    const r = duplicateNotes(t.notes, ids, offset);
    newIds = r.newIds;
    return { notes: r.notes };
  });
  project().setSelection(newIds);
}

export function selectAll(): void {
  project().setSelection(selectedTrack().notes.map((n) => n.id));
}

export function zoom(factor: number): void {
  const px = Math.min(2, Math.max(0.005, ui().pxPerTick * factor));
  ui().set({ pxPerTick: px });
}

export function zoomToFit(viewWidth = window.innerWidth - 340): void {
  const end = Math.max(projectEndTick(project().project), 960 * 16);
  ui().set({
    pxPerTick: Math.min(2, Math.max(0.005, viewWidth / (end * 1.05))),
    revealRequest: ui().revealRequest + 1,
  });
}

export function runCommand(cmd: MenuCommand): void {
  switch (cmd) {
    case 'file:new':
      void newProject();
      break;
    case 'file:open':
      void openDialog();
      break;
    case 'file:save':
      void save();
      break;
    case 'file:saveAs':
      void saveAs();
      break;
    case 'file:importMidi':
      void importMidiTracks();
      break;
    case 'file:exportMidi':
      void exportMidi();
      break;
    case 'file:exportSheet':
      engine.stop(false);
      ui().openDialog('export');
      break;
    case 'file:projectInfo':
      ui().openDialog('projectInfo');
      break;
    case 'edit:undo':
      project().undo();
      break;
    case 'edit:redo':
      project().redo();
      break;
    case 'edit:cut':
      copySelection(true);
      break;
    case 'edit:copy':
      copySelection(false);
      break;
    case 'edit:paste':
      paste();
      break;
    case 'edit:delete':
      deleteSelection();
      break;
    case 'edit:selectAll':
      selectAll();
      break;
    case 'edit:duplicate':
      duplicateSelection();
      break;
    case 'edit:quantize':
      ui().openDialog('quantize');
      break;
    case 'edit:transposeUp':
      transposeSelection(1);
      break;
    case 'edit:transposeDown':
      transposeSelection(-1);
      break;
    case 'edit:legato': {
      const ids = selectionOrNull();
      editSelectedTrack('Legato', (t) => ({ notes: legatoNotes(t.notes, ids) }));
      break;
    }
    case 'edit:humanize': {
      const ids = selectionOrNull();
      editSelectedTrack('Humanize', (t) => ({ notes: humanizeNotes(t.notes, ids, 18, 10) }));
      break;
    }
    case 'transport:play':
      engine.togglePlay();
      break;
    case 'transport:stop':
      engine.stop(true);
      break;
    case 'transport:record':
      engine.toggleRecord();
      break;
    case 'transport:capture':
      if (!engine.captureLastPerformance())
        ui().toast({ kind: 'info', text: 'Nothing to capture yet — play something first, then capture it.' });
      break;
    case 'transport:toStart':
      engine.seek(0);
      ui().set({ revealRequest: ui().revealRequest + 1 });
      break;
    case 'transport:loop': {
      const p = project().project;
      project().commit(p.loop.enabled ? 'Loop off' : 'Loop on', (d) => {
        d.loop.enabled = !d.loop.enabled;
      });
      break;
    }
    case 'transport:metronome':
      useSettings.getState().update({ metronome: !useSettings.getState().metronome });
      break;
    case 'view:zoomIn':
      zoom(1.4);
      break;
    case 'view:zoomOut':
      zoom(1 / 1.4);
      break;
    case 'view:zoomFit':
      zoomToFit();
      break;
    case 'view:follow':
      useSettings.getState().update({ followPlayhead: !useSettings.getState().followPlayhead });
      break;
    case 'view:toggleController':
      ui().set({ showController: !ui().showController });
      break;
    case 'view:toggleLanes':
      ui().set({ showLanes: !ui().showLanes });
      break;
    case 'track:add':
      addTrack({ output: useSettings.getState().defaultOutput });
      break;
    case 'track:delete': {
      const p = project().project;
      if (p.tracks.length <= 1) {
        ui().toast({ kind: 'info', text: 'A project needs at least one track.' });
        break;
      }
      const id = project().selectedTrackId;
      const index = p.tracks.findIndex((t) => t.id === id);
      project().commit('Delete track', (d) => {
        d.tracks = d.tracks.filter((t) => t.id !== id);
      });
      project().selectTrack(project().project.tracks[Math.max(0, index - 1)].id);
      break;
    }
    case 'midi:settings':
      ui().openDialog('midi');
      break;
    case 'midi:panic':
      engine.panic();
      break;
    case 'app:preferences':
      ui().openDialog('prefs');
      break;
    case 'help:shortcuts':
      ui().openDialog('shortcuts');
      break;
    case 'help:about':
      ui().openDialog('about');
      break;
    case 'help:checkUpdates':
      void checkUpdates(false);
      break;
  }
}

export async function checkUpdates(silent: boolean): Promise<void> {
  const status = await api.checkForUpdates(silent);
  const t = ui().toast;
  switch (status.state) {
    case 'available':
      t({
        kind: 'info',
        text: `Synth Piano ${status.version} is available.`,
        timeout: 0,
        action: {
          label: 'Download',
          run: () => {
            void api.downloadUpdate();
            t({ kind: 'info', text: 'Downloading update…' });
          },
        },
      });
      break;
    case 'unavailable':
      if (!silent) t({ kind: 'success', text: 'You are running the latest version.' });
      break;
    case 'unsupported':
      if (!silent)
        t({
          kind: 'info',
          text: status.reason,
          action: {
            label: 'Releases',
            run: () => void api.openExternal('https://github.com/Ranzlappen/synth-piano/releases'),
          },
        });
      break;
    case 'error':
      if (!silent) t({ kind: 'error', text: `Update check failed: ${status.message}` });
      break;
    default:
      break;
  }
}
