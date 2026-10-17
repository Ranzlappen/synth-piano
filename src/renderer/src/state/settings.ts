import { create } from 'zustand';
import type { VelocityCurve } from '@core/midi/messages';
import { DEFAULT_RECORD_FILTER, type RecordFilter, type RecordMode } from '@core/recording';
import { api } from '../platform';

export interface KnobConfig {
  cc: number;
  label: string;
}

export interface ChordPadConfig {
  root: number;
  type: string;
  inversion: number;
}

export interface Settings {
  version: 1;
  // MIDI devices
  /** Inputs the app does not listen to (all others, including newly plugged devices, are used). */
  disabledInputs: string[];
  /** Output for new tracks: 'internal' or a MIDI output name. */
  defaultOutput: string;
  /** Echo live input to the output of the track being played/recorded. */
  midiThru: boolean;
  /** Keep the input's own MIDI channel instead of the track channel. */
  keepInputChannel: boolean;
  sendClock: boolean;
  clockOutput: string;
  /** Recording timing compensation (ms) added to the audio output latency. */
  inputLatencyMs: number;
  // Playing
  velocityCurve: VelocityCurve;
  fixedVelocity: number;
  externalVelocityCurve: VelocityCurve;
  // Recording
  recordMode: RecordMode;
  countInBars: number;
  metronome: boolean;
  metronomeVolume: number;
  recordFilter: RecordFilter;
  // Audio
  masterVolume: number;
  reverb: number;
  // Editor
  showGhostNotes: boolean;
  showNoteNames: boolean;
  scaleRoot: number;
  scaleType: string;
  followPlayhead: boolean;
  // Controller surface
  knobs: KnobConfig[];
  chordPads: ChordPadConfig[];
  // General
  theme: 'dark' | 'light';
  checkUpdates: boolean;
  autosaveMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  disabledInputs: [],
  defaultOutput: 'internal',
  midiThru: true,
  keepInputChannel: false,
  sendClock: false,
  clockOutput: '',
  inputLatencyMs: 0,
  velocityCurve: 'linear',
  fixedVelocity: 100,
  externalVelocityCurve: 'linear',
  recordMode: 'overdub',
  countInBars: 1,
  metronome: true,
  metronomeVolume: 0.5,
  recordFilter: DEFAULT_RECORD_FILTER,
  masterVolume: 0.8,
  reverb: 0.2,
  showGhostNotes: true,
  showNoteNames: true,
  scaleRoot: 0,
  scaleType: 'chromatic',
  followPlayhead: true,
  knobs: [
    { cc: 1, label: 'Mod' },
    { cc: 11, label: 'Expr' },
    { cc: 7, label: 'Vol' },
    { cc: 10, label: 'Pan' },
    { cc: 74, label: 'Bright' },
    { cc: 71, label: 'Reso' },
    { cc: 91, label: 'Reverb' },
    { cc: 93, label: 'Chorus' },
  ],
  chordPads: [
    { root: 60, type: 'maj', inversion: 0 },
    { root: 62, type: 'min', inversion: 0 },
    { root: 64, type: 'min', inversion: 0 },
    { root: 65, type: 'maj', inversion: 0 },
    { root: 67, type: 'maj', inversion: 0 },
    { root: 69, type: 'min', inversion: 0 },
    { root: 71, type: 'dim', inversion: 0 },
    { root: 67, type: '7', inversion: 1 },
  ],
  theme: 'dark',
  checkUpdates: true,
  autosaveMinutes: 2,
};

interface SettingsState extends Settings {
  loaded: boolean;
  update(partial: Partial<Settings>): void;
  load(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function pickSettings(s: SettingsState): Settings {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = (s as unknown as Record<string, unknown>)[key];
  return out as unknown as Settings;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  update(partial) {
    set(partial);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void api.saveSettings(pickSettings(get())), 400);
  },
  async load() {
    try {
      const raw = (await api.loadSettings()) as Partial<Settings> | null;
      if (raw && typeof raw === 'object') {
        const merged: Partial<Settings> = {};
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
          const v = raw[key];
          const d = DEFAULT_SETTINGS[key];
          if (v !== undefined && typeof v === typeof d && Array.isArray(v) === Array.isArray(d))
            (merged as Record<string, unknown>)[key] = v;
        }
        if (merged.recordFilter) merged.recordFilter = { ...DEFAULT_RECORD_FILTER, ...merged.recordFilter };
        if (merged.knobs?.length !== 8) delete merged.knobs;
        if (merged.chordPads?.length !== 8) delete merged.chordPads;
        set(merged);
      }
    } finally {
      set({ loaded: true });
    }
  },
}));
