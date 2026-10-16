import { create } from 'zustand';
import type { MidiPortInfo, MidiStatus } from '../engine/midi-io';

interface TransportState {
  playing: boolean;
  recording: boolean;
  countingIn: boolean;
  set(partial: Partial<TransportState>): void;
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  recording: false,
  countingIn: false,
  set: (partial) => set(partial),
}));

interface MidiState {
  status: MidiStatus;
  error: string;
  sysex: boolean;
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  /** Recent incoming messages for the monitor (newest first). */
  log: { time: number; port: string; text: string }[];
  lastActivity: number;
  set(partial: Partial<MidiState>): void;
}

export const useMidi = create<MidiState>((set) => ({
  status: 'idle',
  error: '',
  sysex: false,
  inputs: [],
  outputs: [],
  log: [],
  lastActivity: 0,
  set: (partial) => set(partial),
}));
