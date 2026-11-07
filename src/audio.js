// Tiny synthesized sound effects with WebAudio: no files to load.

let ctx = null, master = null, windGain = null, windFilter = null, muted = false;

function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Audio may only start after a user gesture: call this from one. */
export function unlock() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    // a looping hiss for the wind, loud when diving fast
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(2);
    src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter).connect(windGain).connect(master);
    src.start();
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export const isMuted = () => muted;

function tone(f0, f1, dur, type = "square", vol = 0.2, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur, f0, f1, vol = 0.3, q = 1) {
  if (!ctx) return;
  const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuffer(dur);
  f.type = "bandpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

export const sfx = {
  jump: () => tone(300, 620, 0.12, "square", 0.12),
  chute: () => burst(0.22, 300, 1400, 0.45, 0.8),
  close: () => burst(0.08, 1800, 900, 0.2, 1.5),
  pickup: () => {
    tone(880, 880, 0.06, "square", 0.12);
    tone(1320, 1320, 0.1, "square", 0.12, 0.06);
  },
  near: () => tone(1500, 2400, 0.07, "triangle", 0.18),
  mult: (n) => tone(300 + n * 70, 600 + n * 120, 0.16, "sawtooth", 0.1),
  multLost: () => tone(500, 180, 0.18, "triangle", 0.12),
  hit: () => {
    burst(0.35, 900, 120, 0.7, 0.6);
    tone(200, 50, 0.3, "square", 0.25);
  },
  best: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.12, "square", 0.1, i * 0.09)),
};

/** Wind loudness and pitch, 0..1. */
export function setWind(k) {
  if (!ctx || !windGain) return;
  const t = ctx.currentTime;
  windGain.gain.setTargetAtTime(k * k * 0.35, t, 0.08);
  windFilter.frequency.setTargetAtTime(350 + k * 900, t, 0.1);
}
