// Shared Web Audio graph: master volume, reverb send, limiter and level meter.

export interface AudioOut {
  ctx: AudioContext;
  /** Dry input of the master bus. */
  master: GainNode;
  /** Input of the reverb (wet only). */
  reverb: GainNode;
  /** Metronome bus (dry, bypasses reverb). */
  click: GainNode;
  analyser: AnalyserNode;
  setMasterVolume(v: number): void;
  setReverb(amount: number): void;
  setClickVolume(v: number): void;
  /** Seconds between scheduling and hearing a sound. */
  outputLatency(): number;
}

let instance: AudioOut | null = null;

function impulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / length;
      const white = Math.random() * 2 - 1;
      // One-pole low-pass that darkens the tail over time.
      const k = 0.35 + 0.6 * t;
      last = last * k + white * (1 - k);
      data[i] = last * Math.pow(1 - t, decay) * (i < preDelay + rate * 0.08 ? 1.4 : 1);
    }
  }
  return buffer;
}

export function getAudio(): AudioOut {
  if (instance) return instance;
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const master = ctx.createGain();
  const out = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;

  const reverb = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = impulseResponse(ctx, 2.6, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(convolver).connect(wet).connect(out);

  const click = ctx.createGain();
  click.gain.value = 0.5;
  click.connect(out);

  master.connect(out);
  out.connect(limiter).connect(analyser).connect(ctx.destination);
  out.gain.value = 0.8;

  instance = {
    ctx,
    master,
    reverb,
    click,
    analyser,
    setMasterVolume: (v) => out.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.02),
    setReverb: (amount) => wet.gain.setTargetAtTime(Math.max(0, amount), ctx.currentTime, 0.05),
    setClickVolume: (v) => click.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.02),
    outputLatency: () => (ctx.outputLatency || 0) + (ctx.baseLatency || 0),
  };
  // Browsers start contexts suspended until a user gesture.
  const resume = () => {
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', resume, { capture: true });
  window.addEventListener('keydown', resume, { capture: true });
  return instance;
}

/** Current output level 0..1 (peak), for the level meter. */
export function readLevel(): number {
  if (!instance) return 0;
  const data = new Float32Array(instance.analyser.fftSize);
  instance.analyser.getFloatTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}
