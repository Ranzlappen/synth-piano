import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createNote, newId, PPQ, projectEndTick, sortNotes, type Note } from '@core/model';
import { notesInRect, splitNotesAt } from '@core/edit';
import { engine } from '../../engine/engine';
import { selectedTrack, useProject } from '../../state/project';
import { useSettings } from '../../state/settings';
import { gridTicksFor, useUi } from '../../state/ui';
import { useTransport } from '../../state/transport';
import {
  drawGrid,
  drawKeys,
  drawNotes,
  drawRuler,
  prepareCanvas,
  readTheme,
  tickToX,
  xToTick,
  yToPitch,
  type Theme,
  type View,
} from './draw';
import { ControllerLane } from './ControllerLane';

const KEYS_WIDTH = 64;
const RULER_HEIGHT = 26;
const EDGE_PX = 6;

type Drag =
  | {
      kind: 'move';
      anchor: Note;
      startTick: number;
      startPitch: number;
      ids: Set<string>;
      copies: Note[] | null;
      lastPitch: number;
      last: string;
    }
  | { kind: 'resize-end' | 'resize-start'; anchor: Note; startTick: number; ids: Set<string>; last: string }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
  | { kind: 'draw'; note: Note; startTick: number }
  | { kind: 'erase'; deleted: Set<string> };

type RulerDrag =
  { kind: 'scrub' } | { kind: 'loop-start' | 'loop-end' } | { kind: 'loop-new'; anchor: number };

let lastDrawLength = 0;

export function PianoRoll(): React.JSX.Element {
  const mainRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({
    pxPerTick: 0.12,
    rowHeight: 14,
    scrollLeft: 0,
    scrollTop: 0,
    width: 800,
    height: 400,
  });
  const themeRef = useRef<Theme | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rulerDragRef = useRef<RulerDrag | null>(null);
  const activeKeys = useRef(new Map<number, string>());
  const keyHeld = useRef<number | null>(null);
  const frame = useRef(0);
  const [laneToken, setLaneToken] = useState(0);

  const revision = useProject((s) => s.revision);
  const selectedTrackId = useProject((s) => s.selectedTrackId);
  const project = useProject((s) => s.project);
  const pxPerTick = useUi((s) => s.pxPerTick);
  const rowHeight = useUi((s) => s.rowHeight);
  const grid = useUi((s) => s.grid);
  const showLanes = useUi((s) => s.showLanes);
  const revealRequest = useUi((s) => s.revealRequest);
  const cursorTick = useUi((s) => s.cursorTick);
  const showGhost = useSettings((s) => s.showGhostNotes);
  const showNames = useSettings((s) => s.showNoteNames);
  const scaleRoot = useSettings((s) => s.scaleRoot);
  const scaleType = useSettings((s) => s.scaleType);
  const theme = useSettings((s) => s.theme);
  const recording = useTransport((s) => s.recording);

  const track = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0];
  const endTick =
    Math.max(projectEndTick(project), project.loop.end, cursorTick, PPQ * 4 * 64) + PPQ * 4 * 32;
  const contentWidth = Math.ceil(endTick * pxPerTick);
  const contentHeight = 128 * rowHeight;

  // ---- drawing ----

  const drawStatic = useCallback(() => {
    const v = viewRef.current;
    const t = (themeRef.current ??= readTheme());
    const { project: p, selection } = useProject.getState();
    const s = useSettings.getState();
    const trk = selectedTrack();
    const meter = engine.meter;
    const g = gridTicksFor(useUi.getState().grid);
    if (gridRef.current) {
      const ctx = prepareCanvas(gridRef.current, v.width, v.height);
      drawGrid(ctx, v, t, meter, g, p.loop, { root: s.scaleRoot, type: s.scaleType });
      if (s.showGhostNotes)
        for (const other of p.tracks)
          if (other.id !== trk.id) drawNotes(ctx, v, t, other.notes, other.color, { ghost: true });
      drawNotes(ctx, v, t, trk.notes, trk.color, { selection, labels: s.showNoteNames });
    }
    if (rulerRef.current) {
      const ctx = prepareCanvas(rulerRef.current, v.width, RULER_HEIGHT);
      drawRuler(ctx, v, t, meter, p.loop, RULER_HEIGHT);
    }
    if (keysRef.current) {
      const ctx = prepareCanvas(keysRef.current, KEYS_WIDTH, v.height);
      drawKeys(ctx, v, t, KEYS_WIDTH, activeKeys.current);
    }
    setLaneToken((x) => x + 1);
  }, []);

  const requestDraw = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      drawStatic();
    });
  }, [drawStatic]);

  // Overlay: playhead, live recording, marquee — redrawn every animation frame.
  useEffect(() => {
    let raf = 0;
    let lastFollow = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = overlayRef.current;
      const scroller = scrollRef.current;
      if (!canvas || !scroller) return;
      const v = viewRef.current;
      const t = (themeRef.current ??= readTheme());
      const ctx = prepareCanvas(canvas, v.width, v.height);
      ctx.clearRect(0, 0, v.width, v.height);
      const playing = engine.isPlaying();
      const tick = engine.currentTick();
      const live = engine.liveRecording();
      if (live && live.trackId === useProject.getState().selectedTrackId)
        drawNotes(
          ctx,
          v,
          t,
          live.notes.map((n, i) => ({ ...n, id: `live${i}` })),
          t.rec,
          { recording: true },
        );
      const d = dragRef.current;
      if (d?.kind === 'marquee') {
        ctx.fillStyle = 'rgba(79,157,255,0.12)';
        ctx.strokeStyle = t.accent;
        ctx.lineWidth = 1;
        const x = Math.min(d.x0, d.x1) - v.scrollLeft;
        const y = Math.min(d.y0, d.y1) - v.scrollTop;
        ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      }
      const x = Math.round(tickToX(v, tick)) + 0.5;
      ctx.fillStyle = useTransport.getState().recording ? t.rec : t.accent;
      ctx.fillRect(x - 0.5, 0, 1.5, v.height);
      // Ruler playhead marker.
      if (rulerRef.current) {
        const rctx = prepareCanvas(rulerRef.current, v.width, RULER_HEIGHT);
        drawRuler(rctx, v, t, engine.meter, useProject.getState().project.loop, RULER_HEIGHT);
        rctx.fillStyle = ctx.fillStyle;
        rctx.beginPath();
        rctx.moveTo(x - 6, RULER_HEIGHT - 9);
        rctx.lineTo(x + 6, RULER_HEIGHT - 9);
        rctx.lineTo(x, RULER_HEIGHT);
        rctx.closePath();
        rctx.fill();
      }
      // Follow the playhead page by page.
      if (playing && useSettings.getState().followPlayhead && !dragRef.current) {
        const now = performance.now();
        if ((x > v.width * 0.9 || x < 0) && now - lastFollow > 150) {
          scroller.scrollLeft = Math.max(0, tick * v.pxPerTick - v.width * 0.1);
          lastFollow = now;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard highlights from live input and playback.
  useEffect(
    () =>
      engine.onNote((pitch, on, _v, source) => {
        if (on)
          activeKeys.current.set(pitch, source === 'live' ? '#4f9dff' : (selectedTrack().color ?? '#4f9dff'));
        else activeKeys.current.delete(pitch);
        requestDraw();
      }),
    [requestDraw],
  );

  // Resize handling.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      viewRef.current = { ...viewRef.current, width: el.clientWidth, height: el.clientHeight };
      requestDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [requestDraw]);

  // Zoom: keep the tick/pitch at the anchor point in place.
  const zoomAnchor = useRef<{ x: number; tick: number; y?: number; pitch?: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const v = viewRef.current;
    const anchor = zoomAnchor.current ?? { x: v.width / 2, tick: xToTick(v, v.width / 2) };
    const pitchAnchor =
      zoomAnchor.current?.pitch !== undefined
        ? { y: zoomAnchor.current.y!, pitch: zoomAnchor.current.pitch }
        : { y: v.height / 2, pitch: yToPitch(v, v.height / 2) };
    viewRef.current = { ...v, pxPerTick, rowHeight };
    el.scrollLeft = Math.max(0, anchor.tick * pxPerTick - anchor.x);
    el.scrollTop = Math.max(0, (127 - pitchAnchor.pitch) * rowHeight - pitchAnchor.y + rowHeight / 2);
    zoomAnchor.current = null;
    viewRef.current = { ...viewRef.current, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    requestDraw();
  }, [pxPerTick, rowHeight, requestDraw]);

  // Reveal: scroll to the playhead and the notes of the track.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const trk = selectedTrack();
    const pitches = trk.notes.map((n) => n.pitch).sort((a, b) => a - b);
    const centre = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 64;
    const v = viewRef.current;
    el.scrollTop = Math.max(0, (127 - centre) * v.rowHeight - v.height / 2);
    const tick = useUi.getState().cursorTick;
    el.scrollLeft = Math.max(0, tick * v.pxPerTick - 40);
  }, [revealRequest, selectedTrackId]);

  useEffect(() => {
    themeRef.current = null;
    requestDraw();
  }, [
    revision,
    grid,
    showGhost,
    showNames,
    scaleRoot,
    scaleType,
    theme,
    selectedTrackId,
    contentWidth,
    requestDraw,
  ]);

  // Native wheel listener (needs passive: false for zoom).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const v = viewRef.current;
        const x = e.clientX - rect.left;
        zoomAnchor.current = { x, tick: xToTick(v, x) };
        const factor = Math.exp(-e.deltaY * 0.0025);
        const ui = useUi.getState();
        ui.set({ pxPerTick: Math.min(2, Math.max(0.005, ui.pxPerTick * factor)) });
      } else if (e.altKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const v = viewRef.current;
        const y = e.clientY - rect.top;
        zoomAnchor.current = { x: v.width / 2, tick: xToTick(v, v.width / 2), y, pitch: yToPitch(v, y) };
        const ui = useUi.getState();
        ui.set({ rowHeight: Math.min(40, Math.max(5, ui.rowHeight * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current!;
    viewRef.current = { ...viewRef.current, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    requestDraw();
  };

  // ---- hit testing ----

  const hitNote = (x: number, y: number): { note: Note; zone: 'body' | 'start' | 'end' } | null => {
    const v = viewRef.current;
    const pitch = yToPitch(v, y);
    const tick = xToTick(v, x);
    const notes = selectedTrack().notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch !== pitch) continue;
      const x0 = tickToX(v, n.tick);
      const x1 = x0 + Math.max(3, n.duration * v.pxPerTick);
      if (x < x0 - 1 || x > x1 + 1) continue;
      if (tick < n.tick - 2 / v.pxPerTick && x < x0) continue;
      const w = x1 - x0;
      if (w > EDGE_PX * 2.5 && x > x1 - EDGE_PX) return { note: n, zone: 'end' };
      if (w > EDGE_PX * 3 && x < x0 + EDGE_PX - 1) return { note: n, zone: 'start' };
      return { note: n, zone: 'body' };
    }
    return null;
  };

  const snapper = (e: { shiftKey: boolean }) => {
    const g = gridTicksFor(useUi.getState().grid);
    const on = useUi.getState().snap && !e.shiftKey;
    return {
      g,
      round: (t: number) => (on ? Math.round(t / g) * g : Math.round(t)),
      floor: (t: number) => (on ? Math.floor(t / g) * g : Math.round(t)),
      min: on ? g : 15,
    };
  };

  const local = (e: React.PointerEvent | PointerEvent) => {
    const rect = scrollRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ---- grid pointer handlers ----

  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current!;
    const { x, y } = local(e);
    if (x > el.clientWidth || y > el.clientHeight) return; // scrollbar
    const v = viewRef.current;
    const proj = useProject.getState();
    const ui = useUi.getState();
    const hit = hitNote(x, y);
    el.setPointerCapture(e.pointerId);
    const tick = xToTick(v, x);
    const pitch = yToPitch(v, y);
    const sn = snapper(e);

    if (e.button === 2) {
      if (hit) {
        proj.commit('Delete note', (d) => {
          const t = d.tracks.find((tr) => tr.id === proj.selectedTrackId)!;
          t.notes = t.notes.filter((n) => n.id !== hit.note.id);
        });
      }
      return;
    }
    if (e.button !== 0) return;

    if (ui.tool === 'erase') {
      proj.beginGesture();
      dragRef.current = { kind: 'erase', deleted: new Set(hit ? [hit.note.id] : []) };
      applyErase();
      return;
    }
    if (ui.tool === 'split') {
      if (hit) {
        const at = sn.round(tick);
        proj.commit('Split note', (d) => {
          const t = d.tracks.find((tr) => tr.id === proj.selectedTrackId)!;
          t.notes = splitNotesAt(t.notes, new Set([hit.note.id]), at);
        });
      }
      return;
    }
    if (hit) {
      let sel = new Set(proj.selection);
      if (e.ctrlKey || e.metaKey) {
        if (sel.has(hit.note.id)) sel.delete(hit.note.id);
        else sel.add(hit.note.id);
        proj.setSelection(sel);
        return;
      }
      if (!sel.has(hit.note.id)) {
        sel = e.shiftKey ? new Set([...sel, hit.note.id]) : new Set([hit.note.id]);
        proj.setSelection(sel);
      }
      engine.audition(hit.note.pitch, hit.note.velocity, 200);
      proj.beginGesture();
      if (hit.zone === 'body') {
        let copies: Note[] | null = null;
        if (e.altKey) {
          copies = selectedTrack()
            .notes.filter((n) => sel.has(n.id))
            .map((n) => ({ ...n, id: newId('n') }));
        }
        dragRef.current = {
          kind: 'move',
          anchor: hit.note,
          startTick: tick,
          startPitch: pitch,
          ids: sel,
          copies,
          lastPitch: pitch,
          last: copies ? '' : '0:0',
        };
        if (copies) proj.setSelection(copies.map((c) => c.id));
      } else {
        dragRef.current = {
          kind: hit.zone === 'end' ? 'resize-end' : 'resize-start',
          anchor: hit.note,
          startTick: tick,
          ids: sel,
          last: '0',
        };
      }
      return;
    }
    if (ui.tool === 'draw') {
      if (pitch < 0 || pitch > 127) return;
      const start = Math.max(0, sn.floor(tick));
      const len = ui.drawLength || lastDrawLength || sn.g;
      const note = createNote({ pitch, tick: start, duration: len, velocity: 100 });
      proj.beginGesture();
      dragRef.current = { kind: 'draw', note, startTick: start };
      proj.updateGesture((d) => {
        const t = d.tracks.find((tr) => tr.id === proj.selectedTrackId)!;
        t.notes = sortNotes([...t.notes, note]);
      });
      proj.setSelection([note.id]);
      engine.audition(pitch, 100, 220);
      return;
    }
    // Select tool on empty space: marquee.
    const base = e.shiftKey || e.ctrlKey ? new Set(proj.selection) : new Set<string>();
    if (!e.shiftKey && !e.ctrlKey) proj.setSelection([]);
    dragRef.current = {
      kind: 'marquee',
      x0: x + v.scrollLeft,
      y0: y + v.scrollTop,
      x1: x + v.scrollLeft,
      y1: y + v.scrollTop,
      base,
    };
    // Clicking empty space also moves the playhead when stopped.
    if (!engine.isPlaying()) ui.set({ cursorTick: Math.max(0, sn.round(tick)) });
  };

  const applyErase = () => {
    const d = dragRef.current;
    if (d?.kind !== 'erase') return;
    const proj = useProject.getState();
    proj.updateGesture((draft) => {
      const t = draft.tracks.find((tr) => tr.id === proj.selectedTrackId)!;
      t.notes = t.notes.filter((n) => !d.deleted.has(n.id));
    });
  };

  const autoScroll = (x: number, y: number) => {
    const el = scrollRef.current!;
    const m = 24;
    if (x > el.clientWidth - m) el.scrollLeft += 14;
    else if (x < m) el.scrollLeft -= 14;
    if (y > el.clientHeight - m) el.scrollTop += 10;
    else if (y < m) el.scrollTop -= 10;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const v = viewRef.current;
    const d = dragRef.current;
    const el = scrollRef.current!;
    if (!d) {
      const hit = hitNote(x, y);
      const tool = useUi.getState().tool;
      el.style.cursor = hit
        ? hit.zone === 'body'
          ? tool === 'erase'
            ? 'not-allowed'
            : tool === 'split'
              ? 'col-resize'
              : 'move'
          : 'ew-resize'
        : tool === 'draw'
          ? 'crosshair'
          : 'default';
      return;
    }
    autoScroll(x, y);
    const proj = useProject.getState();
    const tick = xToTick(v, x);
    const pitch = Math.max(0, Math.min(127, yToPitch(v, y)));
    const sn = snapper(e);
    const trackId = proj.selectedTrackId;
    switch (d.kind) {
      case 'move': {
        const newStart = Math.max(0, sn.round(d.anchor.tick + (tick - d.startTick)));
        const dTick = newStart - d.anchor.tick;
        const dPitch = pitch - d.startPitch;
        if (pitch !== d.lastPitch) {
          d.lastPitch = pitch;
          engine.audition(Math.max(0, Math.min(127, d.anchor.pitch + dPitch)), d.anchor.velocity, 150);
        }
        if (`${dTick}:${dPitch}` === d.last) break;
        d.last = `${dTick}:${dPitch}`;
        proj.updateGesture((draft) => {
          const t = draft.tracks.find((tr) => tr.id === trackId)!;
          const moving = d.copies ?? t.notes.filter((n) => d.ids.has(n.id));
          let minTick = Infinity;
          let minP = 127;
          let maxP = 0;
          for (const n of moving) {
            minTick = Math.min(minTick, n.tick);
            minP = Math.min(minP, n.pitch);
            maxP = Math.max(maxP, n.pitch);
          }
          const dt = Math.max(dTick, -minTick);
          const dp = Math.max(-minP, Math.min(127 - maxP, dPitch));
          if (d.copies) {
            t.notes = sortNotes([
              ...t.notes,
              ...d.copies.map((n) => ({ ...n, tick: n.tick + dt, pitch: n.pitch + dp })),
            ]);
          } else {
            t.notes = sortNotes(
              t.notes.map((n) => (d.ids.has(n.id) ? { ...n, tick: n.tick + dt, pitch: n.pitch + dp } : n)),
            );
          }
        });
        break;
      }
      case 'resize-end': {
        const anchorEnd = d.anchor.tick + d.anchor.duration;
        const newEnd = Math.max(d.anchor.tick + sn.min, sn.round(anchorEnd + (tick - d.startTick)));
        const delta = newEnd - anchorEnd;
        if (String(delta) === d.last) break;
        d.last = String(delta);
        proj.updateGesture((draft) => {
          const t = draft.tracks.find((tr) => tr.id === trackId)!;
          t.notes = t.notes.map((n) =>
            d.ids.has(n.id) ? { ...n, duration: Math.max(sn.min, n.duration + delta) } : n,
          );
        });
        break;
      }
      case 'resize-start': {
        const anchorEnd = d.anchor.tick + d.anchor.duration;
        const newStart = Math.max(
          0,
          Math.min(anchorEnd - sn.min, sn.round(d.anchor.tick + (tick - d.startTick))),
        );
        const delta = newStart - d.anchor.tick;
        if (String(delta) === d.last) break;
        d.last = String(delta);
        proj.updateGesture((draft) => {
          const t = draft.tracks.find((tr) => tr.id === trackId)!;
          t.notes = sortNotes(
            t.notes.map((n) =>
              d.ids.has(n.id) && n.duration - delta >= sn.min
                ? { ...n, tick: Math.max(0, n.tick + delta), duration: n.duration - delta }
                : n,
            ),
          );
        });
        break;
      }
      case 'draw': {
        const end = Math.max(d.startTick + sn.min, sn.round(tick));
        const duration = end - d.startTick;
        proj.updateGesture((draft) => {
          const t = draft.tracks.find((tr) => tr.id === trackId)!;
          t.notes = sortNotes([...t.notes, { ...d.note, duration }]);
        });
        d.note = { ...d.note, duration };
        break;
      }
      case 'erase': {
        const hit = hitNote(x, y);
        if (hit && !d.deleted.has(hit.note.id)) {
          d.deleted.add(hit.note.id);
          applyErase();
        }
        break;
      }
      case 'marquee': {
        d.x1 = x + v.scrollLeft;
        d.y1 = y + v.scrollTop;
        const t0 = d.x0 / v.pxPerTick;
        const t1 = d.x1 / v.pxPerTick;
        const p0 = 127 - Math.floor(d.y0 / v.rowHeight);
        const p1 = 127 - Math.floor(d.y1 / v.rowHeight);
        const inside = notesInRect(selectedTrack().notes, t0, t1, p0, p1).map((n) => n.id);
        proj.setSelection(new Set([...d.base, ...inside]));
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    scrollRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    const proj = useProject.getState();
    switch (d.kind) {
      case 'move':
        proj.endGesture(d.copies ? 'Duplicate notes' : 'Move notes');
        break;
      case 'resize-end':
      case 'resize-start':
        proj.endGesture('Resize notes');
        break;
      case 'draw':
        lastDrawLength = d.note.duration;
        proj.endGesture('Draw note');
        break;
      case 'erase':
        proj.endGesture('Erase notes');
        break;
      case 'marquee':
        requestDraw();
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (useUi.getState().tool !== 'select') return;
    const { x, y } = local(e as unknown as React.PointerEvent);
    if (hitNote(x, y)) return;
    const v = viewRef.current;
    const sn = snapper(e);
    const pitch = yToPitch(v, y);
    if (pitch < 0 || pitch > 127) return;
    const note = createNote({
      pitch,
      tick: Math.max(0, sn.floor(xToTick(v, x))),
      duration: lastDrawLength || sn.g,
      velocity: 100,
    });
    const proj = useProject.getState();
    proj.commit('Add note', (d) => {
      const t = d.tracks.find((tr) => tr.id === proj.selectedTrackId)!;
      t.notes = sortNotes([...t.notes, note]);
    });
    proj.setSelection([note.id]);
    engine.audition(pitch, 100, 220);
  };

  // ---- ruler ----

  const onRulerDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tick = xToTick(v, x);
    const loop = useProject.getState().project.loop;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const sn = snapper({ shiftKey: false });
    const near = (t: number) => Math.abs(tickToX(v, t) - x) < 6;
    if (loop.end > loop.start && near(loop.start)) {
      useProject.getState().beginGesture();
      rulerDragRef.current = { kind: 'loop-start' };
    } else if (loop.end > loop.start && near(loop.end)) {
      useProject.getState().beginGesture();
      rulerDragRef.current = { kind: 'loop-end' };
    } else if (e.shiftKey || e.altKey) {
      useProject.getState().beginGesture();
      const anchor = Math.max(0, Math.round(tick / (PPQ * 4)) * PPQ * 4);
      rulerDragRef.current = { kind: 'loop-new', anchor };
    } else {
      rulerDragRef.current = { kind: 'scrub' };
      if (!engine.isPlaying()) useUi.getState().set({ cursorTick: Math.max(0, sn.round(tick)) });
    }
  };

  const onRulerMove = (e: React.PointerEvent) => {
    const d = rulerDragRef.current;
    const v = viewRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tick = Math.max(0, xToTick(v, x));
    const el = e.currentTarget as HTMLElement;
    if (!d) {
      const loop = useProject.getState().project.loop;
      const near = (t: number) => Math.abs(tickToX(v, t) - x) < 6;
      el.style.cursor =
        loop.end > loop.start && (near(loop.start) || near(loop.end)) ? 'ew-resize' : 'pointer';
      return;
    }
    const bar = PPQ * 4;
    const sn = snapper(e);
    const proj = useProject.getState();
    if (d.kind === 'scrub') {
      if (!engine.isPlaying()) useUi.getState().set({ cursorTick: Math.max(0, sn.round(tick)) });
    } else if (d.kind === 'loop-start') {
      proj.updateGesture((draft) => {
        draft.loop.start = Math.max(0, Math.min(draft.loop.end - sn.g, sn.round(tick)));
        draft.loop.enabled = true;
      });
    } else if (d.kind === 'loop-end') {
      proj.updateGesture((draft) => {
        draft.loop.end = Math.max(draft.loop.start + sn.g, sn.round(tick));
        draft.loop.enabled = true;
      });
    } else if (d.kind === 'loop-new') {
      const other = Math.round(tick / bar) * bar;
      const anchor = d.anchor;
      proj.updateGesture((draft) => {
        draft.loop.start = Math.min(anchor, other);
        draft.loop.end = anchor === other ? anchor + bar : Math.max(anchor, other);
        draft.loop.enabled = true;
      });
    }
  };

  const onRulerUp = (e: React.PointerEvent) => {
    const d = rulerDragRef.current;
    rulerDragRef.current = null;
    if (!d) return;
    if (d.kind === 'scrub') {
      const v = viewRef.current;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const tick = Math.max(0, xToTick(v, e.clientX - rect.left));
      engine.seek(snapper(e).round(tick));
    } else useProject.getState().endGesture('Set loop');
  };

  const onRulerDoubleClick = () => runLoopToggle();

  // ---- keys ----

  const keyVelocity = (x: number) => Math.round(30 + 97 * Math.min(1, Math.max(0, x / KEYS_WIDTH)));
  const onKeysDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pitch = yToPitch(viewRef.current, e.clientY - rect.top);
    if (pitch < 0 || pitch > 127) return;
    if (e.shiftKey) {
      useProject.getState().setSelection(
        selectedTrack()
          .notes.filter((n) => n.pitch === pitch)
          .map((n) => n.id),
      );
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    keyHeld.current = pitch;
    engine.liveInput(
      { type: 'noteOn', channel: 0, note: pitch, velocity: keyVelocity(e.clientX - rect.left) },
      'screen',
    );
  };
  const onKeysMove = (e: React.PointerEvent) => {
    if (keyHeld.current === null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pitch = yToPitch(viewRef.current, e.clientY - rect.top);
    if (pitch === keyHeld.current || pitch < 0 || pitch > 127) return;
    engine.liveInput({ type: 'noteOff', channel: 0, note: keyHeld.current, velocity: 64 }, 'screen');
    keyHeld.current = pitch;
    engine.liveInput(
      { type: 'noteOn', channel: 0, note: pitch, velocity: keyVelocity(e.clientX - rect.left) },
      'screen',
    );
  };
  const onKeysUp = () => {
    if (keyHeld.current === null) return;
    engine.liveInput({ type: 'noteOff', channel: 0, note: keyHeld.current, velocity: 64 }, 'screen');
    keyHeld.current = null;
  };

  const empty = track.notes.length === 0 && !recording;

  return (
    <>
      <div className="roll" onContextMenu={(e) => e.preventDefault()}>
        <div className="roll-corner" />
        <div
          className="roll-ruler"
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={onRulerUp}
          onDoubleClick={onRulerDoubleClick}
          title="Click to move the playhead · Shift+drag to set the loop · drag loop edges · double-click toggles the loop"
        >
          <canvas ref={rulerRef} />
        </div>
        <div
          className="roll-keys"
          onPointerDown={onKeysDown}
          onPointerMove={onKeysMove}
          onPointerUp={onKeysUp}
          onPointerCancel={onKeysUp}
        >
          <canvas ref={keysRef} />
        </div>
        <div ref={mainRef} style={{ position: 'relative', minWidth: 0, minHeight: 0 }}>
          <canvas ref={gridRef} style={{ position: 'absolute', left: 0, top: 0 }} />
          <canvas ref={overlayRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
          <div
            ref={scrollRef}
            className="roll-scroll"
            data-testid="piano-roll"
            style={{ position: 'absolute', inset: 0 }}
            onScroll={onScroll}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            <div className="spacer" style={{ width: contentWidth, height: contentHeight }} />
          </div>
          {empty && (
            <div className="empty-hint">
              <div>
                <b>{track.name}</b> is empty.
                <br />
                Play your MIDI keyboard and press <span className="kbd">R</span> to record,
                <br />
                draw notes with the pencil <span className="kbd">2</span> or double-click,
                <br />
                or import a MIDI file with <span className="kbd">Ctrl</span>+<span className="kbd">I</span>.
              </div>
            </div>
          )}
        </div>
      </div>
      {showLanes && (
        <ControllerLane viewRef={viewRef} scrollRef={scrollRef} token={laneToken} keysWidth={KEYS_WIDTH} />
      )}
    </>
  );
}

function runLoopToggle(): void {
  const proj = useProject.getState();
  proj.commit(proj.project.loop.enabled ? 'Loop off' : 'Loop on', (d) => {
    d.loop.enabled = !d.loop.enabled;
  });
}
