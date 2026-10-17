import {
  createControl,
  createNote,
  createProject,
  createTrack,
  PPQ,
  sortControls,
  sortNotes,
  type ControlEvent,
  type KeySignatureEvent,
  type Marker,
  type Note,
  type Project,
  type TempoEvent,
  type TimeSignatureEvent,
  type Track,
  newId,
} from '../model';
import { CC, GM_PROGRAMS } from '../music';
import {
  keySignatureBytes,
  META,
  readKeySignature,
  readTempo,
  readText,
  readTimeSignature,
  tempoBytes,
  textBytes,
  timeSignatureBytes,
  type SmfEvent,
  type SmfFile,
} from './smf';

/** Converts a project into a format-1 Standard MIDI File structure. */
export function projectToSmf(project: Project, options: { tracks?: Track[] } = {}): SmfFile {
  const conductor: SmfEvent[] = [];
  conductor.push({
    tick: 0,
    type: 'meta',
    metaType: META.TRACK_NAME,
    data: textBytes(project.meta.title || 'Untitled'),
  });
  if (project.meta.copyright)
    conductor.push({
      tick: 0,
      type: 'meta',
      metaType: META.COPYRIGHT,
      data: textBytes(project.meta.copyright),
    });
  for (const t of project.tempos)
    conductor.push({ tick: t.tick, type: 'meta', metaType: META.TEMPO, data: tempoBytes(t.bpm) });
  for (const ts of project.timeSignatures)
    conductor.push({
      tick: ts.tick,
      type: 'meta',
      metaType: META.TIME_SIGNATURE,
      data: timeSignatureBytes(ts.numerator, ts.denominator),
    });
  for (const ks of project.keySignatures)
    conductor.push({
      tick: ks.tick,
      type: 'meta',
      metaType: META.KEY_SIGNATURE,
      data: keySignatureBytes(ks.fifths, ks.mode === 'minor'),
    });
  for (const m of project.markers)
    conductor.push({ tick: m.tick, type: 'meta', metaType: META.MARKER, data: textBytes(m.name) });

  const tracks: SmfEvent[][] = [conductor];
  for (const track of options.tracks ?? project.tracks) {
    const ch = track.channel & 0x0f;
    const ev: SmfEvent[] = [
      { tick: 0, type: 'meta', metaType: META.TRACK_NAME, data: textBytes(track.name) },
      { tick: 0, type: 'programChange', channel: ch, program: track.program },
      { tick: 0, type: 'cc', channel: ch, controller: CC.VOLUME, value: track.volume },
      { tick: 0, type: 'cc', channel: ch, controller: CC.PAN, value: track.pan },
    ];
    for (const n of track.notes) {
      ev.push({ tick: n.tick, type: 'noteOn', channel: ch, note: n.pitch, velocity: n.velocity });
      ev.push({
        tick: n.tick + n.duration,
        type: 'noteOff',
        channel: ch,
        note: n.pitch,
        velocity: n.releaseVelocity,
      });
    }
    for (const c of track.controls) ev.push(controlToSmf(c, ch));
    tracks.push(ev);
  }
  return { format: 1, ppq: project.ppq, tracks };
}

export function controlToSmf(c: ControlEvent, channel: number): SmfEvent {
  switch (c.kind) {
    case 'cc':
      return { tick: c.tick, type: 'cc', channel, controller: c.controller, value: c.value };
    case 'pitchBend':
      return { tick: c.tick, type: 'pitchBend', channel, value: c.value };
    case 'channelPressure':
      return { tick: c.tick, type: 'channelPressure', channel, value: c.value };
    case 'polyPressure':
      return { tick: c.tick, type: 'polyPressure', channel, note: c.controller, value: c.value };
    case 'programChange':
      return { tick: c.tick, type: 'programChange', channel, program: c.value };
  }
}

interface PendingNote {
  tick: number;
  velocity: number;
}

/** Builds a project from a parsed MIDI file. Tracks are split per channel. */
export function smfToProject(smf: SmfFile, fileName = 'Imported'): Project {
  const scale = PPQ / smf.ppq;
  const tc = (t: number): number => Math.round(t * scale);

  const tempos: TempoEvent[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const keySignatures: KeySignatureEvent[] = [];
  const markers: Marker[] = [];
  let title = '';
  let copyright = '';
  const tracks: Track[] = [];

  smf.tracks.forEach((events, trackIndex) => {
    let trackName = '';
    let instrumentName = '';
    // channel -> partial track data
    const perChannel = new Map<
      number,
      {
        notes: Note[];
        controls: ControlEvent[];
        program: number | null;
        volume: number | null;
        pan: number | null;
      }
    >();
    const channelData = (ch: number) => {
      let d = perChannel.get(ch);
      if (!d) {
        d = { notes: [], controls: [], program: null, volume: null, pan: null };
        perChannel.set(ch, d);
      }
      return d;
    };
    const open = new Map<number, PendingNote[]>(); // key = ch*128+note

    for (const e of events) {
      const tick = tc(e.tick);
      switch (e.type) {
        case 'meta':
          switch (e.metaType) {
            case META.TEMPO:
              tempos.push({ tick, bpm: Math.round(readTempo(e.data) * 1000) / 1000 });
              break;
            case META.TIME_SIGNATURE:
              timeSignatures.push({ tick, ...readTimeSignature(e.data) });
              break;
            case META.KEY_SIGNATURE:
              keySignatures.push({ tick, ...readKeySignature(e.data) });
              break;
            case META.MARKER:
              markers.push({ id: newId('m'), tick, name: readText(e.data) });
              break;
            case META.TRACK_NAME:
              if (!trackName) trackName = readText(e.data).trim();
              if (trackIndex === 0 && !title) title = trackName;
              break;
            case META.INSTRUMENT:
              if (!instrumentName) instrumentName = readText(e.data).trim();
              break;
            case META.COPYRIGHT:
              if (!copyright) copyright = readText(e.data).trim();
              break;
          }
          break;
        case 'noteOn': {
          const key = e.channel * 128 + e.note;
          const list = open.get(key) ?? [];
          list.push({ tick, velocity: e.velocity });
          open.set(key, list);
          break;
        }
        case 'noteOff': {
          const key = e.channel * 128 + e.note;
          const list = open.get(key);
          const start = list?.shift();
          if (start) {
            channelData(e.channel).notes.push(
              createNote({
                pitch: e.note,
                tick: start.tick,
                duration: Math.max(1, tick - start.tick),
                velocity: start.velocity,
                releaseVelocity: e.velocity,
              }),
            );
          }
          break;
        }
        case 'cc': {
          const d = channelData(e.channel);
          if (tick === 0 && e.controller === CC.VOLUME && d.volume === null) d.volume = e.value;
          else if (tick === 0 && e.controller === CC.PAN && d.pan === null) d.pan = e.value;
          else d.controls.push(createControl({ tick, kind: 'cc', controller: e.controller, value: e.value }));
          break;
        }
        case 'programChange': {
          const d = channelData(e.channel);
          if (d.program === null && d.notes.length === 0) d.program = e.program;
          else d.controls.push(createControl({ tick, kind: 'programChange', value: e.program }));
          break;
        }
        case 'pitchBend':
          channelData(e.channel).controls.push(createControl({ tick, kind: 'pitchBend', value: e.value }));
          break;
        case 'channelPressure':
          channelData(e.channel).controls.push(
            createControl({ tick, kind: 'channelPressure', value: e.value }),
          );
          break;
        case 'polyPressure':
          channelData(e.channel).controls.push(
            createControl({ tick, kind: 'polyPressure', controller: e.note, value: e.value }),
          );
          break;
      }
    }
    // Close notes that never received a note-off at the end of the track.
    const endTick = tc(events.length ? events[events.length - 1].tick : 0);
    for (const [key, list] of open) {
      for (const start of list) {
        channelData(Math.floor(key / 128)).notes.push(
          createNote({
            pitch: key % 128,
            tick: start.tick,
            duration: Math.max(1, endTick - start.tick),
            velocity: start.velocity,
          }),
        );
      }
    }

    const channels = [...perChannel.keys()].sort((a, b) => a - b);
    for (const ch of channels) {
      const d = perChannel.get(ch)!;
      if (d.notes.length === 0 && d.controls.length === 0) continue;
      const program = d.program ?? 0;
      const baseName = trackName || instrumentName || (ch === 9 ? 'Drums' : GM_PROGRAMS[program]);
      tracks.push(
        createTrack(
          {
            name: channels.length > 1 ? `${baseName} (Ch ${ch + 1})` : baseName,
            channel: ch,
            program,
            volume: d.volume ?? 100,
            pan: d.pan ?? 64,
            armed: false,
            notes: sortNotes(d.notes),
            controls: sortControls(d.controls),
          },
          tracks.length,
        ),
      );
    }
  });

  if (tracks.length === 0) tracks.push(createTrack({ name: 'Piano' }, 0));
  tracks[0].armed = true;

  const dedupe = <T extends { tick: number }>(list: T[]): T[] => {
    const sorted = [...list].sort((a, b) => a.tick - b.tick);
    return sorted.filter((e, i) => i === sorted.length - 1 || sorted[i + 1].tick !== e.tick);
  };

  const project = createProject({
    tempos: tempos.length ? dedupe(tempos) : [{ tick: 0, bpm: 120 }],
    timeSignatures: timeSignatures.length
      ? dedupe(timeSignatures)
      : [{ tick: 0, numerator: 4, denominator: 4 }],
    keySignatures: keySignatures.length ? dedupe(keySignatures) : [{ tick: 0, fifths: 0, mode: 'major' }],
    markers,
    tracks,
  });
  if (project.tempos[0].tick !== 0) project.tempos.unshift({ tick: 0, bpm: project.tempos[0].bpm });
  if (project.timeSignatures[0].tick !== 0)
    project.timeSignatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
  project.meta.title = title || fileName.replace(/\.(midi?|kar|rmi)$/i, '');
  project.meta.copyright = copyright;
  return project;
}
