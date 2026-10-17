# Changelog

All notable changes are documented here. Releases are created automatically from
[Conventional Commits](https://www.conventionalcommits.org/). A section below whose
heading matches a version is used as that release's notes.

## [2.0.0]

Synth Piano 2 is a complete rewrite as a Windows desktop application. The original
Python prototype is kept on the `legacy` branch.

### MIDI controller
- USB / USB-C MIDI devices with hot-plugging, per-device enable, an input monitor and SysEx support.
- On-screen 88-key multi-touch keyboard, pitch and mod wheels, sustain / sostenuto / soft pedals, 8 assignable CC knobs and 8 chord pads.
- Musical typing on the computer keyboard (layout-independent physical keys).
- Built-in General MIDI synthesizer with velocity, release velocity, half-pedal, sostenuto, soft pedal, expression, modulation, pitch bend and aftertouch response; MIDI output routing per track; MIDI thru; MIDI clock output.

### Recording
- Records notes with attack and release velocity, all pedals (including half pedalling), controllers, pitch bend, aftertouch and program changes.
- Count-in, metronome, overdub or replace, loop recording, latency compensation and "capture last performance".

### Editor
- Side-scrolling piano roll with select, draw, erase and split tools, snapping (including triplets), marquee selection, Alt-drag duplication and auditioning.
- Velocity and controller lanes with painting, ramps and erasing.
- Quantize with strength and swing, transpose, legato, humanize, clipboard and unlimited undo/redo.
- Multiple tracks with mute, solo, arm, channel, instrument, volume, pan and colour.

### Sheet music export
- PDF and MusicXML export with live, paginated preview.
- Automatic transcription: triplet detection, swing straightening, smart hand split, two voices per staff, ties, beams, tuplets, pickup bars, key detection and spelling.
- Dynamics and hairpins from velocity, pedal marks from CC 64, *una corda* from CC 67, staccato and accents, tempo marks.
- Tempo detection for freely played recordings; note-value scaling; transposition; paper size, staff size, margins, bars per line, bar numbers and five music fonts.

### App
- `.synthpiano` project files, Standard MIDI File import/export, recent files, autosave and crash recovery.
- Dark and light theme, keyboard shortcuts, automatic updates via GitHub Releases.
- Windows installer and portable build; automatic versioning and releases.
