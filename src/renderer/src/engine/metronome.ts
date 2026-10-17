import type { AudioOut } from './audio';

/** Schedules metronome clicks (accented on the first beat of each bar). */
export class Metronome {
  constructor(private readonly out: AudioOut) {}

  click(time: number, accent: boolean): void {
    const { ctx } = this.out;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1880 : 1320;
    const g = ctx.createGain();
    const t = Math.max(time, ctx.currentTime);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.0015);
    g.gain.setTargetAtTime(0, t + 0.0015, 0.018);
    osc.connect(g).connect(this.out.click);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}
