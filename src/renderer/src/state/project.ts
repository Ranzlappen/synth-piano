// Project document state with undo/redo. All edits go through `commit` (one undo step)
// or a gesture (begin/update/end) for continuous drags that should be a single step.

import { create } from 'zustand';
import { enablePatches, produce, setAutoFreeze, type Draft } from 'immer';
import { createProject, createTrack, type Project, type Track } from '@core/model';

enablePatches();
setAutoFreeze(false);

const HISTORY_LIMIT = 200;
const COALESCE_EXCLUDED = new Set([
  'Record',
  'Paste',
  'Duplicate',
  'Add note',
  'Delete note',
  'Split note',
  'Add track',
]);
let lastCommit = { label: '', time: 0 };

export interface HistoryEntry {
  label: string;
  project: Project;
}

export interface ProjectState {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedTrackId: string;
  /** Selected note ids (in the selected track). */
  selection: ReadonlySet<string>;
  /** Selected controller event ids (in the selected track). */
  controlSelection: ReadonlySet<string>;
  gestureBase: Project | null;
  /** Bumped on every change so canvases can redraw cheaply. */
  revision: number;

  load(project: Project, filePath: string | null): void;
  commit(label: string, recipe: (draft: Draft<Project>) => void): void;
  beginGesture(): void;
  updateGesture(recipe: (draft: Draft<Project>) => void): void;
  endGesture(label: string): void;
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  selectTrack(id: string): void;
  setSelection(ids: Iterable<string>): void;
  setControlSelection(ids: Iterable<string>): void;
  markSaved(filePath: string | null): void;
  markDirty(): void;
}

export const useProject = create<ProjectState>((set, get) => {
  const initial = createProject();
  return {
    project: initial,
    filePath: null,
    dirty: false,
    past: [],
    future: [],
    selectedTrackId: initial.tracks[0].id,
    selection: new Set(),
    controlSelection: new Set(),
    gestureBase: null,
    revision: 0,

    load(project, filePath) {
      set({
        project,
        filePath,
        dirty: false,
        past: [],
        future: [],
        selectedTrackId: project.tracks[0]?.id ?? '',
        selection: new Set(),
        controlSelection: new Set(),
        gestureBase: null,
        revision: get().revision + 1,
      });
    },

    commit(label, recipe) {
      const { project, past } = get();
      const next = produce(project, recipe);
      if (next === project) return;
      // Rapid repeats of the same edit (slider drags, typing) form a single undo step.
      const now = performance.now();
      if (
        lastCommit.label === label &&
        now - lastCommit.time < 900 &&
        past.length &&
        !COALESCE_EXCLUDED.has(label)
      ) {
        lastCommit.time = now;
        set({ project: next, future: [], dirty: true, revision: get().revision + 1 });
        return;
      }
      lastCommit = { label, time: now };
      set({
        project: next,
        past: [...past.slice(-HISTORY_LIMIT + 1), { label, project }],
        future: [],
        dirty: true,
        revision: get().revision + 1,
      });
      get().selectTrack(get().selectedTrackId);
    },

    beginGesture() {
      set({ gestureBase: get().project });
    },

    updateGesture(recipe) {
      const base = get().gestureBase;
      if (!base) return;
      set({ project: produce(base, recipe), revision: get().revision + 1 });
    },

    endGesture(label) {
      lastCommit = { label: '', time: 0 };
      const { gestureBase, project, past } = get();
      if (!gestureBase) return;
      if (project === gestureBase) {
        set({ gestureBase: null });
        return;
      }
      set({
        gestureBase: null,
        past: [...past.slice(-HISTORY_LIMIT + 1), { label, project: gestureBase }],
        future: [],
        dirty: true,
        revision: get().revision + 1,
      });
    },

    cancelGesture() {
      const base = get().gestureBase;
      if (base) set({ project: base, gestureBase: null, revision: get().revision + 1 });
    },

    undo() {
      lastCommit = { label: '', time: 0 };
      const { past, future, project } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        project: prev.project,
        past: past.slice(0, -1),
        future: [{ label: prev.label, project }, ...future],
        dirty: true,
        revision: get().revision + 1,
      });
      get().selectTrack(get().selectedTrackId);
    },

    redo() {
      const { past, future, project } = get();
      const next = future[0];
      if (!next) return;
      set({
        project: next.project,
        past: [...past, { label: next.label, project }],
        future: future.slice(1),
        dirty: true,
        revision: get().revision + 1,
      });
      get().selectTrack(get().selectedTrackId);
    },

    selectTrack(id) {
      const { project, selectedTrackId, selection, controlSelection } = get();
      const track = project.tracks.find((t) => t.id === id) ?? project.tracks[0];
      if (!track) return;
      if (track.id !== selectedTrackId) {
        set({ selectedTrackId: track.id, selection: new Set(), controlSelection: new Set() });
        return;
      }
      // Drop selected ids that no longer exist (after undo/delete).
      const noteIds = new Set(track.notes.map((n) => n.id));
      const ctlIds = new Set(track.controls.map((c) => c.id));
      const sel = [...selection].filter((i) => noteIds.has(i));
      const csel = [...controlSelection].filter((i) => ctlIds.has(i));
      if (sel.length !== selection.size) set({ selection: new Set(sel) });
      if (csel.length !== controlSelection.size) set({ controlSelection: new Set(csel) });
    },

    setSelection(ids) {
      set({ selection: new Set(ids), revision: get().revision + 1 });
    },

    setControlSelection(ids) {
      set({ controlSelection: new Set(ids), revision: get().revision + 1 });
    },

    markSaved(filePath) {
      set({ filePath, dirty: false });
    },

    markDirty() {
      set({ dirty: true });
    },
  };
});

export function selectedTrack(state: ProjectState = useProject.getState()): Track {
  return state.project.tracks.find((t) => t.id === state.selectedTrackId) ?? state.project.tracks[0];
}

/** Draft accessor for the selected track inside a commit recipe. */
export function draftTrack(
  draft: Draft<Project>,
  id: string = useProject.getState().selectedTrackId,
): Draft<Track> {
  return draft.tracks.find((t) => t.id === id) ?? draft.tracks[0];
}

export function addTrack(partial: Partial<Track> = {}): string {
  const { project } = useProject.getState();
  const used = new Set(project.tracks.map((t) => t.channel));
  // Next free channel, keeping channel 10 (index 9) for drums.
  const channel = [...Array(16).keys()].find((c) => c !== 9 && !used.has(c)) ?? 0;
  const track = createTrack({ armed: false, channel, ...partial }, project.tracks.length);
  useProject.getState().commit('Add track', (d) => {
    d.tracks.push(track);
  });
  useProject.getState().selectTrack(track.id);
  return track.id;
}
