# MIDI devices, USB-C and routing

## Connecting a keyboard or controller

Synth Piano works with every MIDI device that Windows can see:

* **USB and USB-C MIDI keyboards and controllers.** Almost all modern devices are *USB
  MIDI class compliant*: plug them in and they work without a driver. USB-C is only a
  different connector; the device speaks the same USB MIDI protocol. Use a USB-C ↔
  USB-A cable or adapter if your computer has no USB-C port.
* **Devices with a vendor driver** (some older Roland, Yamaha and Korg models). Install
  the driver from the manufacturer first.
* **USB-MIDI interfaces** for 5-pin DIN instruments.
* **Bluetooth MIDI**, once the device is paired in Windows and exposed as a MIDI port.
* **Virtual ports**, such as [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
  or the loopback endpoints of Windows MIDI Services.

Devices can be plugged in and out while the app runs. New inputs are used automatically,
and the status bar shows the connected inputs with an activity light.

Open **MIDI → MIDI Devices…** to:

* switch individual inputs on or off,
* watch incoming messages in the **input monitor** (useful to check that pedals, wheels
  and aftertouch arrive),
* choose the default output for new tracks,
* enable *MIDI thru*, *keep input channel*, the input velocity curve and *MIDI clock*
  output.

### Troubleshooting

| Problem | What to try |
| --- | --- |
| The device is not listed | Use a data cable (not a charge-only USB-C cable), try another port, check that the device appears in Windows Device Manager under *Sound, video and game controllers*, then press **Rescan**. |
| The device is listed but silent | Close other music software. On older Windows versions only one application can open a MIDI device at a time; Windows MIDI Services (Windows 11) removes this limit. |
| Notes are recorded slightly late | Set *Latency compensation* in **Preferences → Recording** (positive values move notes earlier). |
| Velocity feels wrong | Choose *Soft* or *Hard* as the input velocity curve in **MIDI Devices**. |
| Stuck notes | Press <kbd>Esc</kbd> (panic) to send *All notes off* and release the pedals everywhere. |

## Synth Piano as a MIDI controller

Everything you play is routed to the **armed track** (red ● button), or to the selected
track if none is armed. That includes the external keyboard, the on-screen 88-key
keyboard, the computer keyboard ("musical typing", <kbd>Ctrl</kbd>+<kbd>K</kbd>), the
pitch and mod wheels, the pedals, the eight knobs and the chord pads.

Each track has an **output**:

* **Built-in synth.** A General MIDI sound set with piano, electric piano, organ,
  strings, pads, brass, bass, drums and more. It responds to velocity, release velocity,
  sustain (including half pedal), sostenuto, soft pedal, expression, volume, pan,
  modulation, pitch bend and aftertouch.
* **Any MIDI output port.** A hardware synth, a sound module, *Microsoft GS Wavetable
  Synth*, or a virtual port into a DAW.

To play instruments in a DAW (Ableton Live, FL Studio, Cubase, Reaper, …):

1. Install loopMIDI and create a port, or use a Windows MIDI Services loopback.
2. Choose that port as the track output in Synth Piano.
3. Enable the same port as a MIDI input in the DAW.
4. Optional: enable **Send MIDI clock** in *MIDI Devices* so the DAW follows the tempo
   and start/stop of Synth Piano.

## What is recorded

Recording keeps the whole performance, not just the notes:

| Data | MIDI | Shown in |
| --- | --- | --- |
| Note pitch, start and length | Note on / off | Piano roll |
| Attack velocity | Note on velocity | Velocity lane, note brightness |
| Release velocity | Note off velocity | Stored and exported to MIDI files |
| Sustain pedal, including half pedal | CC 64 | *Sustain pedal* lane |
| Sostenuto pedal | CC 66 | *Sostenuto* lane |
| Soft pedal (una corda) | CC 67 | *Soft pedal* lane |
| Expression, modulation, breath, volume, pan, knobs | CC 1, 2, 7, 10, 11, … | Controller lanes |
| Pitch bend | Pitch bend | *Pitch bend* lane |
| Channel and polyphonic aftertouch | Pressure | *Aftertouch* lane |
| Program changes | Program change | Kept in the track data |

**Preferences → Recording** lets you exclude groups of data (for example pitch bend)
and record from a single input channel only.

Recording options:

* **Count-in:** 0, 1 or 2 bars (arrow next to the Record button).
* **Overdub or replace:** add to existing notes, or overwrite the recorded range.
* **Loop recording:** set a loop (<kbd>Shift</kbd>+drag in the ruler) and record. In
  overdub mode each pass adds to the take.
* **Capture:** forgot to press Record? <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>
  inserts what you just played (the last phrase after a pause of 8 seconds) at the
  playhead.
