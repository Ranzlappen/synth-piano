// Playback, recording and live MIDI routing.
//
// Timing: a lookahead scheduler (Worker-driven timer, ~20 ms) schedules everything that
// falls into the next 120 ms. Internal synth events are scheduled sample-accurately on
// the AudioContext clock; MIDI output is sent with Web MIDI timestamps on the
// performance clock, compensated for the audio output latency so both stay in sync.

import { applyVelocityCurve, encodeMidi, withChannel, type MidiMessage } from '@core/midi/messages';
import { audibleTracks, PPQ, type Project, type Track } from '@core/model';
import { CaptureBuffer, mergeTake, RecordingBuffer } from '@core/recording';
import { MeterMap, TempoMap } from '@core/timing';
import { CC } from '@core/music';
import { controlToSmf } from '@core/midi/convert';
import { getAudio, type AudioOut } from './audio';
import { Metronome } from './metronome';
import { midiIO } from './midi-io';
import { Synth } from './synth';
import { useProject } from '../state/project';
import { useSettings } from '../state/settings';
import { useTransport, useMidi } from '../state/transport';
import { useUi } from '../state/ui';

const LOOKAHEAD = 0.12;
const START_DELAY = 0.06;

export type InputSource = 'midi' | 'screen' | 'typing' | 'chord';

interface Segment {
  audio: number;
  tick: number;
  sec: number;
}

interface PendingOff {
  tick: number;
  track: Track;
  note: number;
  velocity: number;
}

type NoteListener = (pitch: number, on: boolean, velocity: number, source: 'live' | 'playback') => void;

function lowerBound<T extends { tick: number }>(list: readonly T[], tick: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Engine {
  private out: AudioOut | null = null;
  private synth: Synth | null = null;
  private metronome: Metronome | null = null;
  private timer: Worker | null = null;

  private playing = false;
  private segments: Segment[] = [];
  private scheduledUntil = 0;
  private playStartTick = 0;
  private pendingOffs: PendingOff[] = [];
  private pendingWraps: { audio: number; end: number; start: number }[] = [];
  private tempoMap = new TempoMap([{ tick: 0, bpm: 120 }], PPQ);
  private meterMap = new MeterMap([{ tick: 0, numerator: 4, denominator: 4 }], PPQ);
  private mapsFor: Project | null = null;
  private lastClockTick = -1;

  private record: {
    buffer: RecordingBuffer;
    startTick: number;
    trackId: string;
  } | null = null;
  private countInEnd = -Infinity;
  private readonly capture = new CaptureBuffer();
  /** Live notes currently sounding, for panic: key -> [output, channel, note]. */
  private readonly liveNotes = new Map<string, [string, number, number]>();
  private readonly noteListeners = new Set<NoteListener>();
  private readonly highlightTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Pitches currently lit by playback (so stopping can switch them off). */
  private readonly playbackLit = new Set<number>();

  init(): void {
    if (this.out) return;
    this.out = getAudio();
    this.synth = new Synth(this.out);
    this.metronome = new Metronome(this.out);
    this.applyAudioSettings();
    useSettings.subscribe((s, prev) => {
      if (
        s.masterVolume !== prev.masterVolume ||
        s.reverb !== prev.reverb ||
        s.metronomeVolume !== prev.metronomeVolume
      )
        this.applyAudioSettings();
      if (s.disabledInputs !== prev.disabledInputs)
        midiIO.setInputFilter((n) => !s.disabledInputs.includes(n));
    });
    midiIO.setInputFilter((n) => !useSettings.getState().disabledInputs.includes(n));
    midiIO.onChange(() =>
      useMidi.getState().set({
        status: midiIO.status,
        error: midiIO.error,
        sysex: midiIO.sysex,
        inputs: [...midiIO.inputs],
        outputs: [...midiIO.outputs],
      }),
    );
    midiIO.onInput((e) => {
      const st = useMidi.getState();
      st.set({
        lastActivity: performance.now(),
        log: [{ time: e.time, port: e.port, text: describe(e.msg) }, ...st.log].slice(0, 60),
      });
      this.liveInput(e.msg, 'midi', e.time);
    });
    void midiIO.init();
    this.startTimer();
    // Apply instruments when tracks change.
    let lastTracks = useProject.getState().project.tracks;
    useProject.subscribe((s) => {
      if (s.project.tracks !== lastTracks) {
        const prev = new Map(lastTracks.map((t) => [t.id, t]));
        lastTracks = s.project.tracks;
        for (const t of s.project.tracks) {
          const old = prev.get(t.id);
          if (
            !old ||
            old.program !== t.program ||
            old.volume !== t.volume ||
            old.pan !== t.pan ||
            old.channel !== t.channel ||
            old.output !== t.output
          )
            this.applyTrackSetup(t);
        }
      }
    });
    for (const t of useProject.getState().project.tracks) this.applyTrackSetup(t);
  }

  private applyAudioSettings(): void {
    const s = useSettings.getState();
    this.out?.setMasterVolume(s.masterVolume);
    this.out?.setReverb(s.reverb);
    this.out?.setClickVolume(s.metronomeVolume);
  }

  private startTimer(): void {
    try {
      const src =
        'let id=null;onmessage=e=>{if(e.data==="start"){if(id===null)id=setInterval(()=>postMessage(0),20)}else{clearInterval(id);id=null}}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.timer = new Worker(url);
      this.timer.onmessage = () => this.tick();
      this.timer.postMessage('start');
    } catch {
      setInterval(() => this.tick(), 20);
    }
  }

  // ---- clocks ----

  get ctx(): AudioContext {
    this.init();
    return this.out!.ctx;
  }

  private refreshMaps(project: Project): void {
    if (this.mapsFor === project) return;
    if (!this.mapsFor || this.mapsFor.tempos !== project.tempos)
      this.tempoMap = new TempoMap(project.tempos, project.ppq);
    if (!this.mapsFor || this.mapsFor.timeSignatures !== project.timeSignatures)
      this.meterMap = new MeterMap(project.timeSignatures, project.ppq);
    this.mapsFor = project;
  }

  private segmentAt(audio: number): Segment {
    for (let i = this.segments.length - 1; i >= 0; i--)
      if (this.segments[i].audio <= audio) return this.segments[i];
    return this.segments[0];
  }

  private tickAtAudio(audio: number): number {
    const seg = this.segmentAt(audio);
    return this.tempoMap.secondsToTick(seg.sec + (audio - seg.audio));
  }

  private audioAtTick(tick: number, seg: Segment): number {
    return seg.audio + (this.tempoMap.tickToSeconds(tick) - seg.sec);
  }

  /** Converts an AudioContext time to a performance.now() timestamp for Web MIDI. */
  private perfAt(audio: number): number {
    const out = this.out!;
    return performance.now() + (audio - out.ctx.currentTime + out.outputLatency()) * 1000;
  }

  private audioAtPerf(perf: number): number {
    return this.out!.ctx.currentTime + (perf - performance.now()) / 1000;
  }

  /** Current playhead position in ticks. */
  currentTick(): number {
    if (!this.playing || !this.out) return useUi.getState().cursorTick;
    const heard = this.out.ctx.currentTime - this.out.outputLatency();
    return this.tickAtAudio(Math.max(this.segments[0].audio, heard));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  // ---- transport ----

  play(fromTick = useUi.getState().cursorTick): void {
    this.init();
    if (this.playing) this.halt(false);
    const out = this.out!;
    if (out.ctx.state === 'suspended') void out.ctx.resume();
    const project = useProject.getState().project;
    this.refreshMaps(project);
    const audio = out.ctx.currentTime + START_DELAY;
    this.segments = [{ audio, tick: fromTick, sec: this.tempoMap.tickToSeconds(fromTick) }];
    this.scheduledUntil = audio;
    this.pendingOffs = [];
    this.pendingWraps = [];
    this.playStartTick = fromTick;
    this.lastClockTick = -1;
    this.playing = true;
    this.chaseControllers(project, Math.max(0, fromTick), audio);
    const s = useSettings.getState();
    if (s.sendClock && s.clockOutput) {
      const spp = Math.max(0, Math.round(fromTick / (PPQ / 4)));
      midiIO.send(s.clockOutput, [0xf2, spp & 0x7f, (spp >> 7) & 0x7f], this.perfAt(audio) - 2);
      midiIO.send(s.clockOutput, [spp === 0 ? 0xfa : 0xfb], this.perfAt(audio) - 1);
    }
    useTransport.getState().set({ playing: true });
    this.tick();
  }

  /** Stops playback/recording. Keeps the position (pause) unless `rewind`. */
  stop(rewind = false): void {
    const wasPlaying = this.playing;
    const pos = this.currentTick();
    this.halt(true);
    const ui = useUi.getState();
    if (!wasPlaying) ui.set({ cursorTick: 0 });
    else ui.set({ cursorTick: rewind ? this.playStartTick : Math.max(0, Math.round(pos)) });
  }

  togglePlay(): void {
    if (this.playing) this.stop(false);
    else this.play();
  }

  seek(tick: number): void {
    tick = Math.max(0, Math.round(tick));
    useUi.getState().set({ cursorTick: tick });
    if (this.playing && !this.record) this.play(tick);
  }

  private halt(finishRecording: boolean): void {
    if (!this.out) return;
    const s = useSettings.getState();
    const endTick = this.currentTick();
    this.playing = false;
    if (finishRecording && this.record) this.finishRecording(endTick);
    // Everything scheduled up to `scheduledUntil` may still be queued: send the
    // cleanup to MIDI outputs after it so no note can hang.
    const cleanupPerf = this.perfAt(Math.max(this.scheduledUntil, this.out.ctx.currentTime)) + 2;
    const outputs = new Set<string>();
    for (const t of useProject.getState().project.tracks) if (t.output !== 'internal') outputs.add(t.output);
    for (const off of this.pendingOffs) {
      if (off.track.output !== 'internal')
        midiIO.send(off.track.output, [0x80 | off.track.channel, off.note, 64], cleanupPerf);
    }
    for (const name of outputs) {
      for (let ch = 0; ch < 16; ch++) {
        midiIO.send(name, [0xb0 | ch, CC.SUSTAIN, 0], cleanupPerf);
        midiIO.send(name, [0xb0 | ch, CC.ALL_NOTES_OFF, 0], cleanupPerf);
      }
    }
    if (s.sendClock && s.clockOutput) midiIO.send(s.clockOutput, [0xfc], cleanupPerf);
    this.synth?.allNotesOff(null);
    for (let ch = 0; ch < 16; ch++) this.synth?.controlChange(ch, CC.SUSTAIN, 0, this.out.ctx.currentTime);
    this.pendingOffs = [];
    this.pendingWraps = [];
    for (const t of this.highlightTimers) clearTimeout(t);
    this.highlightTimers.clear();
    for (const pitch of this.playbackLit) this.emitNote(pitch, false, 0, 'playback');
    this.playbackLit.clear();
    useTransport.getState().set({ playing: false, recording: false, countingIn: false });
  }

  // ---- recording ----

  isRecording(): boolean {
    return this.record !== null;
  }

  recordTarget(): Track {
    const { project, selectedTrackId } = useProject.getState();
    return (
      project.tracks.find((t) => t.armed) ??
      project.tracks.find((t) => t.id === selectedTrackId) ??
      project.tracks[0]
    );
  }

  startRecording(): void {
    this.init();
    if (this.record) return;
    const ui = useUi.getState();
    const s = useSettings.getState();
    const project = useProject.getState().project;
    this.refreshMaps(project);
    const startTick = this.playing ? Math.round(this.currentTick()) : ui.cursorTick;
    const target = this.recordTarget();
    this.record = { buffer: new RecordingBuffer(s.recordFilter), startTick, trackId: target.id };
    if (!this.playing) {
      const bar = this.meterMap.bar(this.meterMap.barIndexAt(startTick));
      const countIn = s.countInBars > 0 ? (bar.end - bar.start) * s.countInBars : 0;
      this.countInEnd = startTick;
      this.play(startTick - countIn);
      this.playStartTick = startTick;
      useTransport.getState().set({ recording: true, countingIn: countIn > 0 });
    } else {
      this.countInEnd = -Infinity;
      useTransport.getState().set({ recording: true });
    }
  }

  toggleRecord(): void {
    if (this.record) this.stop(false);
    else this.startRecording();
  }

  private finishRecording(endTick: number): void {
    const rec = this.record;
    this.record = null;
    if (!rec || rec.buffer.isEmpty) return;
    const take = rec.buffer.finish(Math.max(endTick, rec.startTick));
    if (take.notes.length === 0 && take.controls.length === 0) return;
    const mode = useSettings.getState().recordMode;
    useProject.getState().commit('Record', (d) => {
      const track = d.tracks.find((t) => t.id === rec.trackId) ?? d.tracks[0];
      const merged = mergeTake(track, take, mode, { start: rec.startTick, end: Math.max(endTick, take.end) });
      track.notes = merged.notes;
      track.controls = merged.controls;
    });
    useUi.getState().toast({
      kind: 'success',
      text: `Recorded ${take.notes.length} notes${take.controls.length ? ` and ${take.controls.length} controller events` : ''}.`,
    });
  }

  /** Notes being recorded right now (completed + held), for live drawing. */
  liveRecording(): {
    trackId: string;
    notes: { pitch: number; tick: number; duration: number; velocity: number }[];
  } | null {
    if (!this.record) return null;
    const now = this.currentTick();
    return {
      trackId: this.record.trackId,
      notes: [...this.record.buffer.completed(), ...this.record.buffer.pending(now)],
    };
  }

  /** Inserts what was played recently (without recording) at the playhead. */
  captureLastPerformance(): boolean {
    this.init();
    const project = useProject.getState().project;
    this.refreshMaps(project);
    const at = this.meterMap.barStart(this.meterMap.barIndexAt(useUi.getState().cursorTick));
    const ticksPerSecond = (this.tempoMap.bpmAt(at) * PPQ) / 60;
    const take = this.capture.capture(at, ticksPerSecond, 8, useSettings.getState().recordFilter);
    if (!take) return false;
    const target = this.recordTarget();
    useProject.getState().commit('Capture performance', (d) => {
      const track = d.tracks.find((t) => t.id === target.id) ?? d.tracks[0];
      const merged = mergeTake(track, take, 'overdub', { start: take.start, end: take.end });
      track.notes = merged.notes;
      track.controls = merged.controls;
    });
    this.capture.clear();
    return true;
  }

  // ---- live input ----

  onNote(cb: NoteListener): () => void {
    this.noteListeners.add(cb);
    return () => this.noteListeners.delete(cb);
  }

  private emitNote(pitch: number, on: boolean, velocity: number, source: 'live' | 'playback'): void {
    for (const cb of this.noteListeners) cb(pitch, on, velocity, source);
  }

  /** Handles a message played live (MIDI input, on-screen keyboard, computer keyboard). */
  liveInput(msg: MidiMessage, source: InputSource, perfTime = performance.now()): void {
    this.init();
    const out = this.out!;
    if (out.ctx.state === 'suspended') void out.ctx.resume();
    this.processWraps();
    const s = useSettings.getState();
    if (msg.type === 'noteOn') {
      const curve = source === 'midi' ? s.externalVelocityCurve : s.velocityCurve;
      msg = { ...msg, velocity: applyVelocityCurve(msg.velocity, curve, s.fixedVelocity) };
    }
    const track = this.recordTarget();
    const channel = source === 'midi' && s.keepInputChannel && 'channel' in msg ? msg.channel : track.channel;
    const routed = withChannel(msg, channel);
    if (source !== 'midi' || s.midiThru) this.sendLive(track, routed);
    if (msg.type === 'noteOn' || msg.type === 'noteOff')
      this.emitNote(msg.note, msg.type === 'noteOn', msg.type === 'noteOn' ? msg.velocity : 0, 'live');
    this.capture.push(routed, perfTime / 1000);
    if (this.record && this.playing) {
      const latency = s.inputLatencyMs / 1000 + out.outputLatency();
      const tick = this.tickAtAudio(this.audioAtPerf(perfTime) - latency);
      // Notes played in a count-in before the project start cannot be placed.
      if (!(tick < 0 && routed.type === 'noteOn')) this.record.buffer.add(routed, tick);
    }
  }

  private sendLive(track: Track, msg: MidiMessage): void {
    const key = 'note' in msg ? `${track.output}:${'channel' in msg ? msg.channel : 0}:${msg.note}` : '';
    if (msg.type === 'noteOn') this.liveNotes.set(key, [track.output, msg.channel, msg.note]);
    if (msg.type === 'noteOff') this.liveNotes.delete(key);
    if (track.output === 'internal') this.synth!.handle(msg);
    else midiIO.send(track.output, encodeMidi(msg));
  }

  /** Short preview of a note on the selected track (piano roll clicks). */
  audition(pitch: number, velocity = 96, ms = 280): void {
    this.init();
    const track = useProject
      .getState()
      .project.tracks.find((t) => t.id === useProject.getState().selectedTrackId);
    if (!track) return;
    this.sendLive(track, { type: 'noteOn', channel: track.channel, note: pitch, velocity });
    setTimeout(
      () => this.sendLive(track, { type: 'noteOff', channel: track.channel, note: pitch, velocity: 64 }),
      ms,
    );
  }

  /** Sends program, volume and pan of a track to its output. */
  applyTrackSetup(track: Track): void {
    if (!this.synth) return;
    const msgs: MidiMessage[] = [
      { type: 'programChange', channel: track.channel, program: track.program },
      { type: 'cc', channel: track.channel, controller: CC.VOLUME, value: track.volume },
      { type: 'cc', channel: track.channel, controller: CC.PAN, value: track.pan },
    ];
    for (const m of msgs) {
      if (track.output === 'internal') this.synth.handle(m);
      else midiIO.send(track.output, encodeMidi(m));
    }
  }

  panic(): void {
    this.init();
    if (this.playing) this.stop(false);
    this.synth?.panic();
    for (const [output, channel, note] of this.liveNotes.values())
      if (output !== 'internal') midiIO.send(output, [0x80 | channel, note, 0]);
    this.liveNotes.clear();
    for (const name of midiIO.outputNames()) midiIO.panic(name);
    for (let p = 0; p < 128; p++) this.emitNote(p, false, 0, 'live');
  }

  // ---- scheduler ----

  private processWraps(): void {
    if (!this.out || !this.pendingWraps.length) return;
    const now = this.out.ctx.currentTime - this.out.outputLatency();
    while (this.pendingWraps.length && this.pendingWraps[0].audio <= now) {
      const w = this.pendingWraps.shift()!;
      this.record?.buffer.wrap(w.end, w.start);
    }
  }

  private tick(): void {
    if (!this.playing || !this.out) return;
    this.processWraps();
    const out = this.out;
    const project = useProject.getState().project;
    this.refreshMaps(project);
    const horizon = out.ctx.currentTime + LOOKAHEAD;
    // Count-in state for the UI.
    if (this.record && useTransport.getState().countingIn && this.currentTick() >= this.countInEnd)
      useTransport.getState().set({ countingIn: false });
    let guard = 0;
    while (this.scheduledUntil < horizon && guard++ < 8) {
      const seg = this.segments[this.segments.length - 1];
      const fromTick = this.tickAtAudio(this.scheduledUntil);
      let toTick = this.tempoMap.secondsToTick(seg.sec + (horizon - seg.audio));
      const loop = project.loop;
      const looping = loop.enabled && loop.end > loop.start && fromTick < loop.end;
      let wrapped = false;
      if (looping && toTick >= loop.end) {
        toTick = loop.end;
        wrapped = true;
      }
      this.scheduleRange(project, fromTick, toTick, seg);
      if (wrapped) {
        const wrapAudio = this.audioAtTick(loop.end, seg);
        // Notes held over the loop end stop at the loop end.
        for (const off of this.pendingOffs.splice(0)) this.sendNoteOff(off, wrapAudio);
        this.segments.push({
          audio: wrapAudio,
          tick: loop.start,
          sec: this.tempoMap.tickToSeconds(loop.start),
        });
        if (this.segments.length > 4) this.segments.shift();
        this.pendingWraps.push({ audio: wrapAudio, end: loop.end, start: loop.start });
        this.chaseControllers(project, loop.start, wrapAudio);
        this.scheduledUntil = wrapAudio;
        this.lastClockTick = -1;
      } else {
        this.scheduledUntil = horizon;
      }
    }
  }

  private scheduleRange(project: Project, from: number, to: number, seg: Segment): void {
    if (to <= from) return;
    const s = useSettings.getState();
    const tracks = audibleTracks(project);
    for (const track of tracks) {
      for (let i = lowerBound(track.notes, from); i < track.notes.length; i++) {
        const n = track.notes[i];
        if (n.tick >= to) break;
        const at = this.audioAtTick(n.tick, seg);
        this.sendTo(
          track,
          { type: 'noteOn', channel: track.channel, note: n.pitch, velocity: n.velocity },
          at,
        );
        this.highlight(n.pitch, true, n.velocity, at);
        this.pendingOffs.push({
          tick: n.tick + n.duration,
          track,
          note: n.pitch,
          velocity: n.releaseVelocity,
        });
      }
      for (let i = lowerBound(track.controls, from); i < track.controls.length; i++) {
        const c = track.controls[i];
        if (c.tick >= to) break;
        const smf = controlToSmf(c, track.channel);
        const msg = smfToMessage(smf);
        if (msg) this.sendTo(track, msg, this.audioAtTick(c.tick, seg));
      }
    }
    // Note-offs due in this range.
    const due = this.pendingOffs.filter((o) => o.tick < to);
    if (due.length) {
      this.pendingOffs = this.pendingOffs.filter((o) => o.tick >= to);
      for (const off of due) this.sendNoteOff(off, this.audioAtTick(Math.max(off.tick, from), seg));
    }
    // Metronome.
    const countingIn = this.record !== null && from < this.countInEnd;
    if (s.metronome || countingIn) {
      for (let bi = this.meterMap.barIndexAt(from); ; bi++) {
        const bar = this.meterMap.bar(bi);
        if (bar.start >= to) break;
        for (let b = 0; b < bar.numerator; b++) {
          const t = bar.start + b * bar.ticksPerBeat;
          if (t >= from && t < to) this.metronome!.click(this.audioAtTick(t, seg), b === 0);
        }
      }
    }
    // MIDI clock (24 pulses per quarter note).
    if (s.sendClock && s.clockOutput) {
      const step = PPQ / 24;
      let t = Math.ceil(from / step) * step;
      if (t === this.lastClockTick) t += step;
      for (; t < to; t += step) {
        midiIO.send(s.clockOutput, [0xf8], this.perfAt(this.audioAtTick(t, seg)));
        this.lastClockTick = t;
      }
    }
  }

  private sendNoteOff(off: PendingOff, at: number): void {
    this.sendTo(
      off.track,
      { type: 'noteOff', channel: off.track.channel, note: off.note, velocity: off.velocity },
      at,
    );
    this.highlight(off.note, false, 0, at);
  }

  private sendTo(track: Track, msg: MidiMessage, audioTime: number): void {
    if (track.output === 'internal') this.synth!.handle(msg, audioTime);
    else midiIO.send(track.output, encodeMidi(msg), this.perfAt(audioTime));
  }

  private highlight(pitch: number, on: boolean, velocity: number, audioTime: number): void {
    if (!this.noteListeners.size || !this.out) return;
    const delay = Math.max(0, (audioTime - this.out.ctx.currentTime + this.out.outputLatency()) * 1000);
    const timer = setTimeout(() => {
      this.highlightTimers.delete(timer);
      if (on) this.playbackLit.add(pitch);
      else this.playbackLit.delete(pitch);
      this.emitNote(pitch, on, velocity, 'playback');
    }, delay);
    this.highlightTimers.add(timer);
  }

  /** Sends the latest controller values before `tick` so playback starts in the right state. */
  private chaseControllers(project: Project, tick: number, audio: number): void {
    for (const track of audibleTracks(project)) {
      this.applyTrackSetupAt(track, audio);
      const last = new Map<string, MidiMessage>();
      for (const c of track.controls) {
        if (c.tick >= tick) break;
        const msg = smfToMessage(controlToSmf(c, track.channel));
        if (msg) last.set(`${c.kind}:${c.controller}`, msg);
      }
      // Reset pedals/bend that are not set by the chased data.
      const defaults: MidiMessage[] = [
        { type: 'cc', channel: track.channel, controller: CC.SUSTAIN, value: 0 },
        { type: 'cc', channel: track.channel, controller: CC.SOSTENUTO, value: 0 },
        { type: 'cc', channel: track.channel, controller: CC.SOFT, value: 0 },
        { type: 'cc', channel: track.channel, controller: CC.EXPRESSION, value: 127 },
        { type: 'cc', channel: track.channel, controller: CC.MODULATION, value: 0 },
        { type: 'pitchBend', channel: track.channel, value: 0 },
      ];
      for (const d of defaults) {
        const key = d.type === 'cc' ? `cc:${d.controller}` : 'pitchBend:0';
        if (!last.has(key)) this.sendTo(track, d, audio);
      }
      for (const msg of last.values()) this.sendTo(track, msg, audio);
    }
  }

  private applyTrackSetupAt(track: Track, audio: number): void {
    this.sendTo(track, { type: 'programChange', channel: track.channel, program: track.program }, audio);
    this.sendTo(
      track,
      { type: 'cc', channel: track.channel, controller: CC.VOLUME, value: track.volume },
      audio,
    );
    this.sendTo(track, { type: 'cc', channel: track.channel, controller: CC.PAN, value: track.pan }, audio);
  }

  // ---- helpers for the UI ----

  get tempo(): TempoMap {
    this.refreshMaps(useProject.getState().project);
    return this.tempoMap;
  }

  get meter(): MeterMap {
    this.refreshMaps(useProject.getState().project);
    return this.meterMap;
  }

  activeVoices(): number {
    return this.synth?.activeVoices ?? 0;
  }
}

function smfToMessage(e: ReturnType<typeof controlToSmf>): MidiMessage | null {
  switch (e.type) {
    case 'cc':
      return { type: 'cc', channel: e.channel, controller: e.controller, value: e.value };
    case 'pitchBend':
      return { type: 'pitchBend', channel: e.channel, value: e.value };
    case 'channelPressure':
      return { type: 'channelPressure', channel: e.channel, value: e.value };
    case 'polyPressure':
      return { type: 'polyPressure', channel: e.channel, note: e.note, value: e.value };
    case 'programChange':
      return { type: 'programChange', channel: e.channel, program: e.program };
    default:
      return null;
  }
}

function describe(msg: MidiMessage): string {
  switch (msg.type) {
    case 'noteOn':
      return `Note On  ${msg.note}  vel ${msg.velocity}  ch ${msg.channel + 1}`;
    case 'noteOff':
      return `Note Off ${msg.note}  vel ${msg.velocity}  ch ${msg.channel + 1}`;
    case 'cc':
      return `CC ${msg.controller} = ${msg.value}  ch ${msg.channel + 1}`;
    case 'pitchBend':
      return `Pitch Bend ${msg.value}  ch ${msg.channel + 1}`;
    case 'channelPressure':
      return `Aftertouch ${msg.value}  ch ${msg.channel + 1}`;
    case 'polyPressure':
      return `Poly Aftertouch ${msg.note} = ${msg.value}  ch ${msg.channel + 1}`;
    case 'programChange':
      return `Program ${msg.program + 1}  ch ${msg.channel + 1}`;
    case 'sysex':
      return `SysEx ${msg.data.length} bytes`;
    default:
      return msg.type;
  }
}

export const engine = new Engine();

if (import.meta.env.DEV) (window as unknown as { __engine: Engine }).__engine = engine;
