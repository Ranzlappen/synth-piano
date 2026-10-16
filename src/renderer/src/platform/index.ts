import type { SynthPianoApi } from '@shared/api';
import { browserApi } from './browser';

declare global {
  interface Window {
    synthPiano?: SynthPianoApi;
  }
}

/** Native API in Electron, browser fallback otherwise. */
export const api: SynthPianoApi = window.synthPiano ?? browserApi;
