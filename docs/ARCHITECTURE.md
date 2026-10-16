# Architecture

Synth Piano is an Electron application written in TypeScript.

```
src/
├── core/            Pure TypeScript, no DOM or Node APIs (unit tested)
│   ├── model.ts         Project, tracks, notes, controller events
│   ├── timing.ts        Tempo map (ticks ↔ seconds), meter map (bars/beats)
│   ├── midi/            Standard MIDI File reader/writer, live message codec, project ↔ SMF
│   ├── edit.ts          Quantize, transpose, legato, humanize, split/join, clipboard
│   ├── recording.ts     Live MIDI → notes + controllers, take merging, capture buffer
│   ├── project-io.ts    .synthpiano file format with validation
│   └── notation/        Performance → score → MusicXML; page layout for Verovio
├── main/            Electron main process: window, app:// protocol, menus, files, PDF, updates
├── preload/         contextBridge API (typed in src/shared/api.ts)
├── shared/          Types and helpers used by main and renderer
└── renderer/
    ├── public/workers/engraver.js   Verovio worker (MusicXML → SVG pages)
    └── src/
        ├── engine/      Web Audio synth, Web MIDI device manager, scheduler/recorder
        ├── state/       Zustand stores (project with undo/redo, UI, settings, transport)
        ├── components/  React UI (piano roll on canvas, lanes, controller, dialogs)
        └── platform/    Electron API or browser fallback
```

## Key decisions

* **Timeline resolution:** 960 ticks per quarter note.
* **Timing:** a Worker-driven lookahead scheduler queues events 120 ms ahead. The
  built-in synth is scheduled sample-accurately on the AudioContext clock; MIDI output
  uses Web MIDI timestamps, compensated for audio output latency so both stay in sync.
  Recording maps input timestamps back through the same clock (and the loop segments)
  to ticks.
* **Undo/redo:** every edit is an immutable update (Immer). Drags are "gestures": the
  project is previewed live and committed as a single undo step.
* **Sheet music:** `core/notation` does the transcription (quantisation, voices, hands,
  dynamics, pedalling) and writes MusicXML. Verovio, loaded unmodified as a separate
  LGPL-3.0 file in a worker, engraves the pages. A custom MEI page header and footer add
  the title block and page numbers. The PDF is printed by Chromium from the same SVG
  pages that the preview shows.
* **Security:** the renderer is sandboxed with context isolation and no Node
  integration. It is served from a custom `app://` protocol with a strict Content
  Security Policy (`wasm-unsafe-eval` only for the engraver). Only the Web MIDI
  permission is granted.
* **Browser mode:** `npm run dev:web` runs the renderer in a normal browser using
  `platform/browser.ts`. This is useful for UI work and automated UI tests.
