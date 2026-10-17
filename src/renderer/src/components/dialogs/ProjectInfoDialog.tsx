import { useState } from 'react';
import { KEY_NAMES_MAJOR, KEY_NAMES_MINOR } from '@core/music';
import { useProject } from '../../state/project';
import { useUi } from '../../state/ui';
import { Dialog } from './Dialog';

export function ProjectInfoDialog(): React.JSX.Element {
  const project = useProject((s) => s.project);
  const [meta, setMeta] = useState(project.meta);
  const key = project.keySignatures[0];
  const [keyValue, setKeyValue] = useState(`${key?.fifths ?? 0}:${key?.mode ?? 'major'}`);
  const close = () => useUi.getState().openDialog(null);
  const apply = () => {
    const [f, mode] = keyValue.split(':');
    useProject.getState().commit('Project info', (d) => {
      d.meta = { ...meta };
      d.keySignatures = [
        { tick: 0, fifths: Number(f), mode: mode as 'major' | 'minor' },
        ...d.keySignatures.filter((k) => k.tick > 0),
      ];
    });
    close();
  };
  const field = (k: keyof typeof meta, label: string) => (
    <>
      <label>{label}</label>
      <input type="text" value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
    </>
  );
  const fifths = Array.from({ length: 15 }, (_, i) => i - 7);
  return (
    <Dialog
      title="Project information"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="form">
        {field('title', 'Title')}
        {field('subtitle', 'Subtitle')}
        {field('composer', 'Composer')}
        {field('arranger', 'Arranger')}
        {field('copyright', 'Copyright')}
        <label>Key</label>
        <select value={keyValue} onChange={(e) => setKeyValue(e.target.value)}>
          {fifths.map((f) => (
            <option key={`${f}M`} value={`${f}:major`}>
              {KEY_NAMES_MAJOR[f]}
            </option>
          ))}
          {fifths.map((f) => (
            <option key={`${f}m`} value={`${f}:minor`}>
              {KEY_NAMES_MINOR[f]}
            </option>
          ))}
        </select>
        <div className="full hint">
          These details are used as defaults for sheet music export and stored in exported MIDI files.
        </div>
      </div>
    </Dialog>
  );
}
