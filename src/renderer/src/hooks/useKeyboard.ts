import { useEffect } from 'react';
import { chordPitches } from '@core/music';
import { CC } from '@core/music';
import { engine } from '../engine/engine';
import { nudgeSelection, quantizeSelection, runCommand, gridTicks, transposeSelection } from '../commands';
import { useConfirm } from '../state/confirm';
import { useProject } from '../state/project';
import { useSettings } from '../state/settings';
import { useUi, type Tool } from '../state/ui';

/** Physical key (KeyboardEvent.code) -> semitone offset from C of the typing octave. */
export const TYPING_KEYS: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

const held = new Map<string, number[]>();

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'range', 'button'].includes(target.type);
  return false;
}

export function playChordPad(index: number, on: boolean): void {
  const pad = useSettings.getState().chordPads[index];
  if (!pad) return;
  const key = `pad${index}`;
  if (on) {
    if (held.has(key)) return;
    const pitches = chordPitches(pad.root, pad.type, pad.inversion);
    held.set(key, pitches);
    const v = useUi.getState().typingVelocity;
    for (const p of pitches) engine.liveInput({ type: 'noteOn', channel: 0, note: p, velocity: v }, 'chord');
  } else {
    const pitches = held.get(key);
    held.delete(key);
    for (const p of pitches ?? [])
      engine.liveInput({ type: 'noteOff', channel: 0, note: p, velocity: 64 }, 'chord');
  }
}

function typingDown(e: KeyboardEvent): boolean {
  const ui = useUi.getState();
  if (e.code in TYPING_KEYS) {
    if (!e.repeat && !held.has(e.code)) {
      const pitch = Math.min(127, (ui.typingOctave + 1) * 12 + TYPING_KEYS[e.code]);
      held.set(e.code, [pitch]);
      engine.liveInput({ type: 'noteOn', channel: 0, note: pitch, velocity: ui.typingVelocity }, 'typing');
    }
    return true;
  }
  if (e.repeat)
    return ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'Tab'].includes(e.code) || /^Digit[1-8]$/.test(e.code);
  switch (e.code) {
    case 'KeyZ':
      ui.set({ typingOctave: Math.max(-1, ui.typingOctave - 1) });
      return true;
    case 'KeyX':
      ui.set({ typingOctave: Math.min(8, ui.typingOctave + 1) });
      return true;
    case 'KeyC':
      ui.set({ typingVelocity: Math.max(1, ui.typingVelocity - 20) });
      return true;
    case 'KeyV':
      ui.set({ typingVelocity: Math.min(127, ui.typingVelocity + 20) });
      return true;
    case 'Tab':
      engine.liveInput({ type: 'cc', channel: 0, controller: CC.SUSTAIN, value: 127 }, 'typing');
      return true;
  }
  const digit = /^Digit([1-8])$/.exec(e.code);
  if (digit) {
    playChordPad(Number(digit[1]) - 1, true);
    return true;
  }
  return false;
}

function typingUp(e: KeyboardEvent): boolean {
  if (e.code in TYPING_KEYS) {
    const pitches = held.get(e.code);
    held.delete(e.code);
    for (const p of pitches ?? [])
      engine.liveInput({ type: 'noteOff', channel: 0, note: p, velocity: 64 }, 'typing');
    return true;
  }
  if (e.code === 'Tab') {
    engine.liveInput({ type: 'cc', channel: 0, controller: CC.SUSTAIN, value: 0 }, 'typing');
    return true;
  }
  const digit = /^Digit([1-8])$/.exec(e.code);
  if (digit) {
    playChordPad(Number(digit[1]) - 1, false);
    return true;
  }
  return false;
}

export function releaseTypingNotes(): void {
  for (const [code, pitches] of held) {
    held.delete(code);
    for (const p of pitches)
      engine.liveInput({ type: 'noteOff', channel: 0, note: p, velocity: 64 }, 'typing');
  }
}

const TOOLS: Record<string, Tool> = { Digit1: 'select', Digit2: 'draw', Digit3: 'erase', Digit4: 'split' };

export function useKeyboard(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (ui.dialog || useConfirm.getState().request) {
        if (e.key === 'Escape' && !useConfirm.getState().request) ui.openDialog(null);
        return;
      }
      if (isEditable(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ui.musicalTyping && !ctrl && !e.altKey && typingDown(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      let handled = true;
      if (ctrl) {
        if (k === 'n') runCommand('file:new');
        else if (k === 'o') runCommand('file:open');
        else if (k === 's' && e.shiftKey) runCommand('file:saveAs');
        else if (k === 's') runCommand('file:save');
        else if (k === 'i') runCommand('file:importMidi');
        else if (k === 'e') runCommand('file:exportMidi');
        else if (k === 'p') runCommand('file:exportSheet');
        else if (k === 'z' && e.shiftKey) runCommand('edit:redo');
        else if (k === 'z') runCommand('edit:undo');
        else if (k === 'y') runCommand('edit:redo');
        else if (k === 'x') runCommand('edit:cut');
        else if (k === 'c') runCommand('edit:copy');
        else if (k === 'v') runCommand('edit:paste');
        else if (k === 'd') runCommand('edit:duplicate');
        else if (k === 'a') runCommand('edit:selectAll');
        else if (k === 'l') runCommand('edit:legato');
        else if (k === 'h') runCommand('edit:humanize');
        else if (k === 't') runCommand('track:add');
        else if (k === 'r' && e.shiftKey) runCommand('transport:capture');
        else if (k === 'k') ui.set({ musicalTyping: !ui.musicalTyping });
        else if (k === 'b') runCommand('view:toggleController');
        else if (k === 'j') runCommand('view:toggleLanes');
        else if (k === ',') runCommand('app:preferences');
        else if (k === '=' || k === '+') runCommand('view:zoomIn');
        else if (k === '-') runCommand('view:zoomOut');
        else if (k === '0') runCommand('view:zoomFit');
        else handled = false;
      } else {
        switch (e.code) {
          case 'Space':
            runCommand('transport:play');
            break;
          case 'Enter':
          case 'NumpadEnter':
            runCommand('transport:stop');
            break;
          case 'Home':
            runCommand('transport:toStart');
            break;
          case 'Delete':
          case 'Backspace':
            runCommand('edit:delete');
            break;
          case 'Escape':
            if (useProject.getState().selection.size || useProject.getState().controlSelection.size) {
              useProject.getState().setSelection([]);
              useProject.getState().setControlSelection([]);
            } else runCommand('midi:panic');
            break;
          case 'ArrowUp':
            transposeSelection(e.shiftKey ? 12 : 1);
            break;
          case 'ArrowDown':
            transposeSelection(e.shiftKey ? -12 : -1);
            break;
          case 'ArrowLeft':
            nudgeSelection(-(e.altKey ? 10 : gridTicks()));
            break;
          case 'ArrowRight':
            nudgeSelection(e.altKey ? 10 : gridTicks());
            break;
          case 'F1':
            runCommand('help:shortcuts');
            break;
          default:
            // While typing notes, only letters that are not note keys keep their shortcut.
            if (ui.musicalTyping && e.code === 'KeyR') runCommand('transport:record');
            else if (ui.musicalTyping && e.code === 'KeyM') runCommand('transport:metronome');
            else if (ui.musicalTyping) handled = false;
            else if (e.code in TOOLS) ui.set({ tool: TOOLS[e.code] });
            else if (k === 'r') runCommand('transport:record');
            else if (k === 'l') runCommand('transport:loop');
            else if (k === 'm') runCommand('transport:metronome');
            else if (k === 'f') runCommand('view:follow');
            else if (k === 'q' && e.shiftKey) runCommand('edit:quantize');
            else if (k === 'q') quantizeSelection();
            else handled = false;
        }
      }
      if (handled) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (useUi.getState().musicalTyping || held.size) {
        if (typingUp(e)) e.preventDefault();
      }
    };
    const blur = () => releaseTypingNotes();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
