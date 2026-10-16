// Web MIDI device manager. Class-compliant USB MIDI devices (USB-A or USB-C, no driver
// needed) appear here automatically, as do devices with vendor drivers, Bluetooth MIDI
// paired in Windows, and virtual ports such as loopMIDI / Windows MIDI Services loopbacks.
// Devices can be plugged in and out while the app runs.

import { decodeMidi, type MidiMessage } from '@core/midi/messages';

export interface MidiPortInfo {
  id: string;
  /** Unique display name (duplicate device names get a " #2" suffix). */
  name: string;
  manufacturer: string;
  connected: boolean;
  open: boolean;
}

export type MidiStatus = 'idle' | 'requesting' | 'ready' | 'unsupported' | 'denied' | 'error';

export interface MidiInputEvent {
  msg: MidiMessage;
  data: Uint8Array;
  /** performance.now() time of arrival. */
  time: number;
  port: string;
}

type InputListener = (e: MidiInputEvent) => void;
type ChangeListener = () => void;

export class MidiIO {
  status: MidiStatus = 'idle';
  error = '';
  sysex = false;
  inputs: MidiPortInfo[] = [];
  outputs: MidiPortInfo[] = [];
  private access: MIDIAccess | null = null;
  private inputListeners = new Set<InputListener>();
  private changeListeners = new Set<ChangeListener>();
  private enabled: (name: string) => boolean = () => true;
  private portNames = new Map<string, string>();

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async init(): Promise<void> {
    if (this.status === 'ready' || this.status === 'requesting' || this.pending) return;
    this.pending = true;
    try {
      await this.request();
    } finally {
      this.pending = false;
    }
  }

  private pending = false;

  private async request(): Promise<void> {
    if (!this.supported) {
      this.status = 'unsupported';
      this.emitChange();
      return;
    }
    this.status = 'requesting';
    this.emitChange();
    // Some systems never answer (e.g. no MIDI service running). Report it, but keep
    // waiting: a late answer still brings the devices online.
    const slow = setTimeout(() => {
      if (this.status !== 'requesting') return;
      this.status = 'error';
      this.error =
        'The MIDI system is not responding. Check that no other application is blocking it, then press Rescan.';
      this.emitChange();
    }, 8000);
    try {
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: true });
        this.sysex = true;
      } catch {
        this.access = await navigator.requestMIDIAccess({ sysex: false });
        this.sysex = false;
      }
      clearTimeout(slow);
      this.status = 'ready';
      this.access.onstatechange = () => this.refresh();
      this.refresh();
    } catch (err) {
      clearTimeout(slow);
      const name = (err as DOMException)?.name;
      this.status = name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.emitChange();
    }
  }

  /** Decides which inputs are listened to (by display name). */
  setInputFilter(fn: (name: string) => boolean): void {
    this.enabled = fn;
    this.refresh();
  }

  onInput(cb: InputListener): () => void {
    this.inputListeners.add(cb);
    return () => this.inputListeners.delete(cb);
  }

  onChange(cb: ChangeListener): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  private emitChange(): void {
    for (const cb of this.changeListeners) cb();
  }

  private uniqueNames<T extends MIDIPort>(ports: T[]): Map<string, string> {
    const counts = new Map<string, number>();
    const out = new Map<string, string>();
    for (const p of ports) {
      const base = (p.name || 'MIDI Device').trim();
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      out.set(p.id, n === 1 ? base : `${base} #${n}`);
    }
    return out;
  }

  refresh(): void {
    if (!this.access) return;
    const ins = [...this.access.inputs.values()];
    const outs = [...this.access.outputs.values()];
    const inNames = this.uniqueNames(ins);
    const outNames = this.uniqueNames(outs);
    this.portNames = new Map([...inNames, ...outNames]);
    this.inputs = ins.map((p) => this.info(p, inNames.get(p.id)!));
    this.outputs = outs.map((p) => this.info(p, outNames.get(p.id)!));
    for (const input of ins) {
      const name = inNames.get(input.id)!;
      const listen = input.state === 'connected' && this.enabled(name);
      if (listen) {
        input.onmidimessage = (e) => this.handleMessage(name, e);
      } else if (input.onmidimessage) {
        input.onmidimessage = null;
        // Release the device so other applications can use it.
        void input.close().catch(() => undefined);
      }
    }
    this.emitChange();
  }

  private info(p: MIDIPort, name: string): MidiPortInfo {
    return {
      id: p.id,
      name,
      manufacturer: p.manufacturer ?? '',
      connected: p.state === 'connected',
      open: p.connection === 'open',
    };
  }

  private handleMessage(port: string, e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length === 0) return;
    const status = data[0];
    // Active sensing and clock bytes are transport noise for this app.
    if (status === 0xfe || status === 0xf8) return;
    const msg = decodeMidi(data);
    const event: MidiInputEvent = { msg, data, time: e.timeStamp || performance.now(), port };
    for (const cb of this.inputListeners) cb(event);
  }

  private findOutput(name: string): MIDIOutput | null {
    if (!this.access) return null;
    for (const out of this.access.outputs.values()) {
      if (this.portNames.get(out.id) === name && out.state === 'connected') return out;
    }
    return null;
  }

  /** Sends raw bytes to an output, optionally at a performance.now() timestamp. */
  send(outputName: string, data: number[], timestamp?: number): boolean {
    const out = this.findOutput(outputName);
    if (!out) return false;
    if (data[0] === 0xf0 && !this.sysex) return false;
    try {
      out.send(data, timestamp);
      return true;
    } catch {
      // Device unplugged or in use by another application.
      return false;
    }
  }

  /** All notes / sound off and pedal release on every channel of an output. */
  panic(outputName: string): void {
    for (let ch = 0; ch < 16; ch++) {
      this.send(outputName, [0xb0 | ch, 64, 0]);
      this.send(outputName, [0xb0 | ch, 123, 0]);
      this.send(outputName, [0xb0 | ch, 120, 0]);
    }
  }

  outputNames(): string[] {
    return this.outputs.filter((o) => o.connected).map((o) => o.name);
  }
}

export const midiIO = new MidiIO();
