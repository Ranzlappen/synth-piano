import { create } from 'zustand';
import { PPQ } from '@core/model';

export type Tool = 'select' | 'draw' | 'erase' | 'split';

export type LaneKind =
  | { type: 'velocity' }
  | { type: 'cc'; controller: number }
  | { type: 'pitchBend' }
  | { type: 'channelPressure' };

export type DialogId =
  'export' | 'midi' | 'prefs' | 'quantize' | 'projectInfo' | 'shortcuts' | 'about' | 'trackSettings' | null;

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
  action?: { label: string; run: () => void };
  timeout?: number;
}

interface UiState {
  tool: Tool;
  snap: boolean;
  /** Grid as "1/value" of a whole note (6/12/24 = triplets). */
  grid: number;
  /** Length of newly drawn notes in ticks; 0 = one grid step. */
  drawLength: number;
  pxPerTick: number;
  rowHeight: number;
  showController: boolean;
  showLanes: boolean;
  laneHeight: number;
  lane: LaneKind;
  musicalTyping: boolean;
  typingOctave: number;
  typingVelocity: number;
  /** Playhead when stopped (ticks). */
  cursorTick: number;
  dialog: DialogId;
  toasts: Toast[];
  /** Incremented to request "scroll to make playhead / notes visible". */
  revealRequest: number;
  set(partial: Partial<UiState>): void;
  openDialog(id: DialogId): void;
  toast(t: Omit<Toast, 'id'>): number;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  tool: 'select',
  snap: true,
  grid: 16,
  drawLength: 0,
  pxPerTick: 0.07,
  rowHeight: 14,
  showController: true,
  showLanes: true,
  laneHeight: 120,
  lane: { type: 'velocity' },
  musicalTyping: false,
  typingOctave: 4,
  typingVelocity: 100,
  cursorTick: 0,
  dialog: null,
  toasts: [],
  revealRequest: 0,
  set: (partial) => set(partial),
  openDialog: (id) => set({ dialog: id }),
  toast(t) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { ...t, id }] });
    const timeout = t.timeout ?? (t.action ? 12000 : 4500);
    if (timeout > 0) setTimeout(() => get().dismissToast(id), timeout);
    return id;
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
  },
}));

export const gridTicksFor = (grid: number): number => (PPQ * 4) / grid;
