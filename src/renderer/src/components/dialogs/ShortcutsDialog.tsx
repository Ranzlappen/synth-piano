import { useUi } from '../../state/ui';
import { Dialog } from './Dialog';

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Enter', 'Stop and return to start position'],
  ['R', 'Record (with count-in)'],
  ['Ctrl + Shift + R', 'Capture the last performance (retroactive record)'],
  ['L / M / F', 'Loop / metronome / follow playhead'],
  ['Home', 'Go to start'],
  ['1 2 3 4', 'Select, draw, erase, split tool'],
  ['Q / Shift + Q', 'Quantize to grid / quantize dialog'],
  ['↑ ↓ (Shift)', 'Transpose selection by a semitone (octave)'],
  ['← → (Alt)', 'Move selection by one grid step (10 ticks)'],
  ['Ctrl + C / X / V / D', 'Copy / cut / paste at playhead / duplicate'],
  ['Ctrl + A, Delete', 'Select all, delete selection'],
  ['Ctrl + Z / Y', 'Undo / redo'],
  ['Ctrl + L / H', 'Legato / humanize selection'],
  ['Ctrl + wheel, Alt + wheel', 'Zoom horizontally / vertically'],
  ['Shift while dragging', 'Move without snapping to the grid'],
  ['Alt + drag note', 'Duplicate notes'],
  ['Ctrl + click', 'Add / remove a note from the selection'],
  ['Shift + drag in ruler', 'Set the loop range'],
  ['Shift + click on a key', 'Select all notes of that pitch'],
  ['Ctrl + K', 'Musical typing (computer keyboard plays notes)'],
  ['A W S E D F T G Y H U J K', 'Musical typing: notes C … C (physical key positions)'],
  ['Z / X, C / V', 'Musical typing: octave down/up, velocity down/up'],
  ['Tab, 1–8', 'Musical typing: sustain pedal, chord pads'],
  ['Ctrl + B / J', 'Show controller panel / controller lanes'],
  ['Ctrl + P', 'Export sheet music'],
  ['Esc', 'Clear selection, or panic (all notes off)'],
];

export function ShortcutsDialog(): React.JSX.Element {
  const close = () => useUi.getState().openDialog(null);
  return (
    <Dialog title="Keyboard shortcuts" medium onClose={close}>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td>
                <span className="kbd">{k}</span>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
