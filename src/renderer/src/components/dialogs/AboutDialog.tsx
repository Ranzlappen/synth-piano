import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/api';
import { api } from '../../platform';
import { checkUpdates } from '../../commands';
import { useUi } from '../../state/ui';
import { Dialog } from './Dialog';

export function AboutDialog(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void api.getAppInfo().then(setInfo);
  }, []);
  const close = () => useUi.getState().openDialog(null);
  const link = (url: string, label: string) => (
    <a
      href={url}
      onClick={(e) => (e.preventDefault(), void api.openExternal(url))}
      style={{ color: 'var(--accent)' }}
    >
      {label}
    </a>
  );
  return (
    <Dialog
      title="About Synth Piano"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={() => void checkUpdates(false)}>
            Check for updates
          </button>
          <button className="btn primary" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <img src="./icon.png" width={72} height={72} alt="" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Synth Piano {info?.version}</div>
          <div className="muted">MIDI controller, recorder, piano-roll editor and sheet music exporter.</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {info &&
              `Electron ${info.electron} · Chromium ${info.chrome} · ${info.platform}${info.isPortable ? ' · portable' : ''}`}
          </div>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        © Ranzlappen and contributors — MIT License.{' '}
        {link('https://github.com/Ranzlappen/synth-piano', 'Source code & releases')}.
      </p>
      <p className="hint">
        Sheet music is engraved with {link('https://www.verovio.org', 'Verovio')} (LGPL-3.0-or-later), loaded
        as a separate, replaceable module. Music fonts: Leipzig, Bravura, Leland, Petaluma and Gootville (SIL
        Open Font License). Built with Electron, React, Zustand and Immer (MIT) and Lucide icons (ISC). See
        THIRD_PARTY_NOTICES.md for details.
      </p>
    </Dialog>
  );
}
