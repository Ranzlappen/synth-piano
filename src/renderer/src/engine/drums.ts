// Synthesised General MIDI drum kit for channel 10.

type Hit = (t: number, v: number) => void;

export class DrumKit {
  private readonly hits = new Map<number, Hit>();
  private openHat: GainNode | null = null;
  private readonly active = new Set<AudioScheduledSourceNode>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    const kick: Hit = (t, v) => this.tone(t, v, 150, 42, 0.07, 0.38, 'sine', 1.1);
    const snare: Hit = (t, v) => {
      this.noiseHit(t, v * 0.8, 'highpass', 1200, 0.7, 0.16);
      this.tone(t, v * 0.6, 220, 180, 0.03, 0.09, 'triangle', 0.8);
    };
    const tom =
      (f: number): Hit =>
      (t, v) =>
        this.tone(t, v, f * 1.6, f, 0.05, 0.32, 'sine', 0.9);
    const closedHat: Hit = (t, v) => {
      this.chokeOpenHat(t);
      this.noiseHit(t, v * 0.5, 'highpass', 7500, 1, 0.045);
    };
    const openHat: Hit = (t, v) => {
      this.chokeOpenHat(t);
      this.openHat = this.noiseHit(t, v * 0.45, 'highpass', 7000, 1, 0.38);
    };
    const crash: Hit = (t, v) => this.noiseHit(t, v * 0.55, 'highpass', 4500, 0.6, 1.3);
    const ride: Hit = (t, v) => {
      this.noiseHit(t, v * 0.3, 'bandpass', 8500, 1.2, 0.8);
      this.tone(t, v * 0.15, 3200, 3200, 0.01, 0.6, 'sine', 0.5);
    };
    const set = (notes: number[], hit: Hit) => notes.forEach((n) => this.hits.set(n, hit));
    set([35, 36], kick);
    set([38, 40], snare);
    set([37], (t, v) => this.noiseHit(t, v * 0.7, 'bandpass', 2200, 3, 0.03));
    set([39], (t, v) =>
      [0, 0.011, 0.022].forEach((d) => this.noiseHit(t + d, v * 0.6, 'bandpass', 1400, 1.5, 0.09)),
    );
    set([41], tom(82));
    set([43], tom(98));
    set([45], tom(115));
    set([47], tom(135));
    set([48], tom(160));
    set([50], tom(190));
    set([42, 44], closedHat);
    set([46], openHat);
    set([49, 52, 55, 57], crash);
    set([51, 53, 59], ride);
    set([54], (t, v) => this.noiseHit(t, v * 0.4, 'highpass', 9000, 2, 0.12));
    set([56], (t, v) => {
      this.tone(t, v * 0.3, 540, 540, 0.01, 0.15, 'square', 0.4);
      this.tone(t, v * 0.3, 800, 800, 0.01, 0.15, 'square', 0.4);
    });
  }

  play(note: number, velocity: number, time: number): void {
    const hit =
      this.hits.get(note) ?? ((t: number, v: number) => this.noiseHit(t, v * 0.4, 'bandpass', 3000, 2, 0.06));
    hit(time, Math.pow(velocity / 127, 1.4));
  }

  stopAll(): void {
    const t = this.ctx.currentTime;
    for (const s of this.active) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
  }

  private track(src: AudioScheduledSourceNode): void {
    this.active.add(src);
    src.addEventListener('ended', () => this.active.delete(src), { once: true });
  }

  private chokeOpenHat(t: number): void {
    if (this.openHat) {
      this.openHat.gain.cancelScheduledValues(t);
      this.openHat.gain.setTargetAtTime(0, t, 0.01);
      this.openHat = null;
    }
  }

  private tone(
    t: number,
    v: number,
    f0: number,
    f1: number,
    sweep: number,
    decay: number,
    type: OscillatorType,
    level: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * level * 0.5), t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, decay / 4);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + decay * 2);
    this.track(osc);
  }

  private noiseHit(
    t: number,
    v: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    decay: number,
  ): GainNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, v * 0.45), t);
    g.gain.setTargetAtTime(0, t, decay / 4);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.4);
    src.stop(t + decay * 2 + 0.05);
    this.track(src);
    return g;
  }
}
