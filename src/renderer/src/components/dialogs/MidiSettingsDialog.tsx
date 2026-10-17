import { RefreshCw } from 'lucide-react';
import { midiIO } from '../../engine/midi-io';
import { engine } from '../../engine/engine';
import { useSettings } from '../../state/settings';
import { useMidi } from '../../state/transport';
import { useUi } from '../../state/ui';
import { Dialog } from './Dialog';

export function MidiSettingsDialog(): React.JSX.Element {
  const { status, error, sysex, inputs, outputs, log } = useMidi();
  const s = useSettings();
  const close = () => useUi.getState().openDialog(null);
  const toggleInput = (name: string, enabled: boolean) =>
    s.update({
      disabledInputs: enabled ? s.disabledInputs.filter((n) => n !== name) : [...s.disabledInputs, name],
    });

  return (
    <Dialog
      title="MIDI devices"
      medium
      onClose={close}
      footer={
        <>
          <div className="left">
            <button
              className="btn"
              onClick={() => (midiIO.status === 'ready' ? midiIO.refresh() : void midiIO.init())}
            >
              <RefreshCw /> Rescan
            </button>
            <button
              className="btn danger"
              onClick={() => engine.panic()}
              title="All notes off on every output (Esc)"
            >
              Panic
            </button>
          </div>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      {status === 'unsupported' && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          Web MIDI is not available in this environment.
        </p>
      )}
      {status === 'denied' && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          Access to MIDI devices was denied.
        </p>
      )}
      {status === 'error' && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          MIDI error: {error}
        </p>
      )}
      {status === 'requesting' && <p className="hint">Connecting to MIDI devices…</p>}

      <div className="section-title">Inputs (keyboards, controllers)</div>
      <div className="device-list" style={{ marginTop: 6 }}>
        {inputs.length === 0 && (
          <div className="hint">
            No MIDI inputs found. Connect a USB / USB-C MIDI keyboard — class-compliant devices work without
            drivers and appear here automatically. If a device does not show up, close other music apps that
            may be using it, or try another cable / port.
          </div>
        )}
        {inputs.map((i) => (
          <label key={i.id} className="device">
            <input
              type="checkbox"
              checked={!s.disabledInputs.includes(i.name)}
              onChange={(e) => toggleInput(i.name, e.target.checked)}
            />
            <div>
              <div>{i.name}</div>
              <div className="meta">
                {i.manufacturer || 'Unknown manufacturer'} ·{' '}
                {i.connected ? (i.open ? 'listening' : 'connected') : 'disconnected'}
              </div>
            </div>
            <span className={`led ${i.connected ? 'on' : ''}`} />
          </label>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        Outputs (synths, DAWs, sound modules)
      </div>
      <div className="device-list" style={{ marginTop: 6 }}>
        <div className="device">
          <span />
          <div>
            <div>Built-in synth</div>
            <div className="meta">Internal General MIDI sound set with pedal and velocity response</div>
          </div>
          <span className="led on" />
        </div>
        {outputs.map((o) => (
          <div key={o.id} className="device">
            <span />
            <div>
              <div>{o.name}</div>
              <div className="meta">
                {o.manufacturer || 'Unknown manufacturer'} · {o.connected ? 'connected' : 'disconnected'}
              </div>
            </div>
            <span className={`led ${o.connected ? 'on' : ''}`} />
          </div>
        ))}
      </div>
      <p className="hint">
        Choose the output per track in the track inspector. To control another application (a DAW or VST host)
        install a virtual MIDI port such as loopMIDI, or use the loopback ports of Windows MIDI Services, and
        select it as the track output.
      </p>

      <div className="section-title" style={{ marginTop: 14 }}>
        Routing
      </div>
      <div className="form" style={{ marginTop: 6 }}>
        <label>Default output</label>
        <select value={s.defaultOutput} onChange={(e) => s.update({ defaultOutput: e.target.value })}>
          <option value="internal">Built-in synth</option>
          {outputs.map((o) => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
        </select>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.midiThru}
            onChange={(e) => s.update({ midiThru: e.target.checked })}
          />
          MIDI thru — play incoming notes through the armed / selected track
        </label>
        <label />
        <label className="check">
          <input
            type="checkbox"
            checked={s.keepInputChannel}
            onChange={(e) => s.update({ keepInputChannel: e.target.checked })}
          />
          Keep the input's MIDI channel (for split / multi-channel controllers)
        </label>
        <label>Input velocity</label>
        <select
          value={s.externalVelocityCurve}
          onChange={(e) =>
            s.update({ externalVelocityCurve: e.target.value as typeof s.externalVelocityCurve })
          }
        >
          <option value="linear">Linear (as sent by the device)</option>
          <option value="soft">Soft — easier to play loud</option>
          <option value="hard">Hard — more control at low volume</option>
          <option value="fixed">Fixed velocity</option>
        </select>
        <label>Send MIDI clock</label>
        <div className="inline">
          <input
            type="checkbox"
            checked={s.sendClock}
            onChange={(e) => s.update({ sendClock: e.target.checked })}
          />
          <select
            value={s.clockOutput}
            disabled={!s.sendClock}
            onChange={(e) => s.update({ clockOutput: e.target.value })}
          >
            <option value="">Choose output…</option>
            {outputs.map((o) => (
              <option key={o.id} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <label>System exclusive</label>
        <span className="muted">{sysex ? 'enabled' : 'not available'}</span>
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        Input monitor
      </div>
      <div className="monitor scroll" style={{ marginTop: 6 }} data-testid="midi-monitor">
        {log.length === 0 && <div style={{ opacity: 0.6 }}>Play something on your device…</div>}
        {log.map((l, i) => (
          <div key={`${l.time}-${i}`}>
            [{l.port}] {l.text}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
