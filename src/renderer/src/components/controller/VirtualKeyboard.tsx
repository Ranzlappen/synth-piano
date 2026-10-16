import { useEffect, useLayoutEffect, useRef } from 'react';
import { isBlackKey, noteName } from '@core/music';
import { engine } from '../../engine/engine';
import { TYPING_KEYS } from '../../hooks/useKeyboard';
import { useUi } from '../../state/ui';
import { prepareCanvas, readTheme } from '../pianoroll/draw';

const FIRST = 21; // A0
const LAST = 108; // C8
const WHITE_W = 26;

interface KeyRect {
  pitch: number;
  x: number;
  w: number;
  h: number;
  black: boolean;
}

function layout(height: number): { keys: KeyRect[]; width: number } {
  const keys: KeyRect[] = [];
  let x = 0;
  for (let p = FIRST; p <= LAST; p++) {
    if (!isBlackKey(p)) {
      keys.push({ pitch: p, x, w: WHITE_W, h: height, black: false });
      x += WHITE_W;
    }
  }
  const whites = new Map(keys.map((k) => [k.pitch, k]));
  for (let p = FIRST; p <= LAST; p++) {
    if (!isBlackKey(p)) continue;
    const left = whites.get(p - 1)!;
    const bw = WHITE_W * 0.62;
    keys.push({ pitch: p, x: left.x + WHITE_W - bw / 2, w: bw, h: height * 0.62, black: true });
  }
  return { keys, width: x };
}

const TYPING_LABEL = Object.fromEntries(
  Object.entries(TYPING_KEYS).map(([code, off]) => [
    off,
    code.replace('Key', '').replace('Semicolon', ';').replace('Quote', "'"),
  ]),
);

/** 88-key on-screen keyboard. Multi-touch capable; velocity rises toward the front of the key. */
export function VirtualKeyboard(): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef(new Map<number, string>());
  const pointers = useRef(new Map<number, number>());
  const layoutRef = useRef<{ keys: KeyRect[]; width: number }>({ keys: [], width: 0 });
  const typing = useUi((s) => s.musicalTyping);
  const typingOctave = useUi((s) => s.typingOctave);
  const theme = useRef(readTheme());

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const h = wrap.clientHeight - 2;
    const lay = (layoutRef.current = layout(h));
    const ctx = prepareCanvas(canvas, lay.width, h);
    const t = theme.current;
    ctx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    const ui = useUi.getState();
    const typingBase = (ui.typingOctave + 1) * 12;
    for (const k of lay.keys) {
      const on = active.current.get(k.pitch);
      if (!k.black) {
        ctx.fillStyle = on ?? t.keyWhite;
        ctx.fillRect(k.x, 0, k.w - 1, k.h);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(k.x + k.w - 1, 0, 1, k.h);
        if (k.pitch % 12 === 0) {
          ctx.fillStyle = on ? '#fff' : '#7a8193';
          ctx.fillText(noteName(k.pitch), k.x + k.w / 2, k.h - 6);
        }
      } else {
        ctx.fillStyle = on ?? t.keyBlack;
        ctx.fillRect(k.x, 0, k.w, k.h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(k.x + 2, k.h - 6, k.w - 4, 3);
      }
      if (ui.musicalTyping) {
        const label = TYPING_LABEL[k.pitch - typingBase];
        if (label) {
          ctx.fillStyle = k.black ? '#cfd6e6' : '#4f9dff';
          ctx.fillText(label, k.x + k.w / 2, k.black ? k.h - 10 : k.h - 20);
        }
      }
    }
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    draw();
    // Start scrolled to middle C.
    const c4 = layoutRef.current.keys.find((k) => k.pitch === 48);
    if (c4) wrap.scrollLeft = c4.x;
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    theme.current = readTheme();
    draw();
    if (typing) {
      const k = layoutRef.current.keys.find((x) => x.pitch === (typingOctave + 1) * 12);
      const wrap = wrapRef.current;
      if (k && wrap && (k.x < wrap.scrollLeft || k.x + 18 * WHITE_W > wrap.scrollLeft + wrap.clientWidth))
        wrap.scrollLeft = Math.max(0, k.x - WHITE_W * 2);
    }
  }, [typing, typingOctave]);

  useEffect(
    () =>
      engine.onNote((pitch, on, _v, source) => {
        if (on) active.current.set(pitch, source === 'live' ? '#4f9dff' : '#3ddc97');
        else active.current.delete(pitch);
        requestAnimationFrame(draw);
      }),
    [],
  );

  const hit = (e: React.PointerEvent): { pitch: number; velocity: number } | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const keys = layoutRef.current.keys;
    for (const k of keys)
      if (k.black && x >= k.x && x < k.x + k.w && y < k.h) return { pitch: k.pitch, velocity: vel(y, k.h) };
    for (const k of keys)
      if (!k.black && x >= k.x && x < k.x + k.w) return { pitch: k.pitch, velocity: vel(y, k.h) };
    return null;
  };
  const vel = (y: number, h: number) => Math.round(25 + 102 * Math.min(1, Math.max(0, y / h)));

  const down = (e: React.PointerEvent) => {
    const k = hit(e);
    if (!k) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, k.pitch);
    engine.liveInput({ type: 'noteOn', channel: 0, note: k.pitch, velocity: k.velocity }, 'screen');
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (prev === undefined) return;
    const k = hit(e);
    if (!k || k.pitch === prev) return;
    engine.liveInput({ type: 'noteOff', channel: 0, note: prev, velocity: 64 }, 'screen');
    pointers.current.set(e.pointerId, k.pitch);
    engine.liveInput({ type: 'noteOn', channel: 0, note: k.pitch, velocity: k.velocity }, 'screen');
  };
  const up = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (prev !== undefined)
      engine.liveInput({ type: 'noteOff', channel: 0, note: prev, velocity: 64 }, 'screen');
  };

  return (
    <div className="keyboard" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        data-testid="virtual-keyboard"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
