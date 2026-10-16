// Document workflows: new / open / save / import / export, with unsaved-changes checks.
import { createProject, type Project } from '@core/model';
import { parseSmf, writeSmf } from '@core/midi/smf';
import { projectToSmf, smfToProject } from '@core/midi/convert';
import { parseProject, PROJECT_EXTENSION, serializeProject } from '@core/project-io';
import type { OpenedFile } from '@shared/api';
import { api } from './platform';
import { useConfirm } from './state/confirm';
import { useProject } from './state/project';
import { useUi } from './state/ui';
import { engine } from './engine/engine';

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';

export function projectTitle(): string {
  const { project, filePath } = useProject.getState();
  if (filePath) return baseName(filePath.split(/[\\/]/).pop() ?? 'Untitled');
  return project.meta.title || 'Untitled';
}

/** Asks to save unsaved changes. Resolves false if the user cancelled. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useProject.getState().dirty) return true;
  const answer = await useConfirm
    .getState()
    .ask('Unsaved changes', `Save changes to “${projectTitle()}” before continuing?`, [
      { id: 'save', label: 'Save', kind: 'primary' },
      { id: 'discard', label: "Don't save", kind: 'danger' },
      { id: 'cancel', label: 'Cancel' },
    ]);
  if (answer === 'cancel') return false;
  if (answer === 'save') return save();
  return true;
}

function loadProject(project: Project, path: string | null): void {
  engine.stop(false);
  useProject.getState().load(project, path);
  useUi.getState().set({ cursorTick: 0, revealRequest: useUi.getState().revealRequest + 1 });
  for (const t of project.tracks) engine.applyTrackSetup(t);
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  loadProject(createProject(), null);
  void api.clearAutosave();
}

export async function openOpenedFile(file: OpenedFile): Promise<void> {
  try {
    if (file.kind === 'project') {
      const project = parseProject(file.text ?? '');
      loadProject(project, api.isElectron ? file.path : null);
      if (api.isElectron) await api.addRecentFile(file.path);
    } else {
      const project = smfToProject(parseSmf(file.bytes ?? new Uint8Array()), file.name);
      loadProject(project, null);
      useProject.getState().markDirty();
      if (api.isElectron) await api.addRecentFile(file.path);
      const notes = project.tracks.reduce((s, t) => s + t.notes.length, 0);
      useUi.getState().toast({
        kind: 'success',
        text: `Imported ${file.name}: ${project.tracks.length} track(s), ${notes} notes.`,
      });
    }
  } catch (err) {
    useUi.getState().toast({
      kind: 'error',
      text: `Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function openDialog(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = await api.openFile('any');
  if (file) await openOpenedFile(file);
}

/** Adds the tracks of a MIDI file to the current project. */
export async function importMidiTracks(): Promise<void> {
  const file = await api.openFile('midi');
  if (!file?.bytes) return;
  try {
    const imported = smfToProject(parseSmf(file.bytes), file.name);
    const { project } = useProject.getState();
    const empty = project.tracks.every((t) => t.notes.length === 0);
    useProject.getState().commit('Import MIDI', (d) => {
      if (empty) {
        d.tracks = [];
        d.tempos = imported.tempos;
        d.timeSignatures = imported.timeSignatures;
        d.keySignatures = imported.keySignatures;
        if (d.meta.title === 'Untitled') d.meta.title = imported.meta.title;
      }
      for (const t of imported.tracks) d.tracks.push({ ...t, armed: false });
      if (d.tracks.length && !d.tracks.some((t) => t.armed)) d.tracks[0].armed = true;
    });
    useProject
      .getState()
      .selectTrack(useProject.getState().project.tracks[empty ? 0 : project.tracks.length]?.id ?? '');
    useUi
      .getState()
      .toast({ kind: 'success', text: `Added ${imported.tracks.length} track(s) from ${file.name}.` });
  } catch (err) {
    useUi.getState().toast({
      kind: 'error',
      text: `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function save(): Promise<boolean> {
  const { filePath } = useProject.getState();
  if (!filePath) return saveAs();
  return writeProject(filePath);
}

export async function saveAs(): Promise<boolean> {
  return writeProject(undefined);
}

async function writeProject(path: string | undefined): Promise<boolean> {
  const project = useProject.getState().project;
  try {
    const saved = await api.saveFile({
      path,
      suggestedName: `${safeName(project.meta.title || 'Untitled')}.${PROJECT_EXTENSION}`,
      kind: 'project',
      data: serializeProject(project),
    });
    if (!saved) return false;
    useProject.getState().markSaved(api.isElectron ? saved : null);
    if (api.isElectron) await api.addRecentFile(saved);
    await api.clearAutosave();
    useUi.getState().toast({ kind: 'success', text: `Saved ${saved.split(/[\\/]/).pop()}` });
    return true;
  } catch (err) {
    useUi
      .getState()
      .toast({ kind: 'error', text: `Saving failed: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}

export async function exportMidi(): Promise<void> {
  const project = useProject.getState().project;
  const bytes = writeSmf(projectToSmf(project));
  const saved = await api.saveFile({
    suggestedName: `${safeName(project.meta.title || projectTitle())}.mid`,
    kind: 'midi',
    data: bytes,
  });
  if (saved)
    useUi.getState().toast({ kind: 'success', text: `Exported MIDI file ${saved.split(/[\\/]/).pop()}` });
}

export { safeName };

// ---- autosave / crash recovery ----

let autosaveTimer: ReturnType<typeof setInterval> | null = null;

export function startAutosave(minutes: number): void {
  if (autosaveTimer) clearInterval(autosaveTimer);
  if (minutes <= 0) return;
  autosaveTimer = setInterval(() => {
    const { dirty, project } = useProject.getState();
    if (dirty) void api.writeAutosave(serializeProject(project));
  }, minutes * 60_000);
}

export async function offerAutosaveRestore(): Promise<void> {
  const text = await api.readAutosave();
  if (!text) return;
  let project: Project;
  try {
    project = parseProject(text);
  } catch {
    await api.clearAutosave();
    return;
  }
  useUi.getState().toast({
    kind: 'warning',
    text: `Unsaved work from a previous session was found (“${project.meta.title}”).`,
    timeout: 0,
    action: {
      label: 'Restore',
      run: () => {
        loadProject(project, null);
        useProject.getState().markDirty();
        void api.clearAutosave();
      },
    },
  });
}
