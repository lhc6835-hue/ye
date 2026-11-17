// Sound: recorded CC0 samples (see assets/audio/CREDITS.md) played through WebAudio.
//
// The cutting sound is granular: short grains are taken from crunch recordings at their own transients,
// high-passed and pitched up so they read as crisp glass, and fired as the blade advances, so the
// sound follows the knife's real speed and the amount of material in front of it. Glass "tings" are
// layered in, everything passes a small synthetic room and a limiter.

const V = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
const url = (n) => `assets/audio/${n}.mp3${V ? `?v=${V}` : ""}`;
const GROUPS = {
  crunch: ["crunch-1", "crunch-2", "crunch-3", "crunch-4"],
  ting: ["ting-1", "ting-2", "ting-3", "ting-4"],
  clink: ["clink-1", "clink-2", "clink-3"],
  thud: ["thud-0", "thud-1", "thud-2", "thud-3", "thud-4"],
  thudm: ["thudm-0", "thudm-1", "thudm-2"],
  wood: ["wood-0", "wood-1", "wood-2", "wood-3", "wood-4"],
  slice: ["slice-1", "slice-2"],
  shing: ["shing-1", "shing-2"],
};

let ctx = null, master = null, dry = null, wet = null, volume = 0.8;
const buf = {}; // name -> AudioBuffer
const onsets = {}; // name -> [seconds]
const recent = new Map(); // group -> last play time, to avoid machine-gun repeats
let listeners = [];

export const isUnlocked = () => !!ctx && ctx.state === "running";
export const loadedCount = () => Object.keys(buf).length;
export function onUnlock(fn) {
  listeners.push(fn);
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections, then a smooth diffuse tail
      const er = i < ctx.sampleRate * 0.03 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      d[i] = er + (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.5;
    }
  }
  return ir;
}

/** Finds transients so every crunch grain starts on an actual crack. */
function findOnsets(b) {
  const d = b.getChannelData(0), sr = b.sampleRate, hop = Math.floor(sr * 0.004);
  const env = [];
  for (let i = 0; i + hop < d.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += d[i + j] * d[i + j];
    env.push(Math.sqrt(s / hop));
  }
  const peak = Math.max(...env);
  const out = [];
  let last = -1;
  for (let i = 3; i < env.length - 8; i++) {
    const before = (env[i - 1] + env[i - 2] + env[i - 3]) / 3;
    if (env[i] > peak * 0.12 && env[i] > before * 1.9 && i - last > 6) {
      out.push(Math.max(0, (i - 1) * hop) / sr);
      last = i;
    }
  }
  return out.length ? out : [0];
}

async function load() {
  const names = Object.values(GROUPS).flat();
  await Promise.all(
    names.map(async (n) => {
      try {
        const r = await fetch(url(n));
        if (!r.ok) return;
        const b = await ctx.decodeAudioData(await r.arrayBuffer());
        buf[n] = b;
        if (n.startsWith("crunch")) onsets[n] = findOnsets(b);
      } catch {
        // a missing sound just stays quiet
      }
    }),
  );
}

/** Audio can only start inside a user gesture. */
export function unlock() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(0.9, 3.2);
    const pre = ctx.createBiquadFilter();
    pre.type = "highpass";
    pre.frequency.value = 400;
    wet = ctx.createGain();
    wet.gain.value = 0.16;
    wet.connect(pre).connect(verb).connect(master);
    load();
  }
  if (ctx.state !== "running") ctx.resume().then(() => listeners.forEach((f) => f()));
  else listeners.forEach((f) => f());
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/**
 * Plays one sample. opts: gain, rate, pan (-1..1), offset (s), dur (s, with a short fade),
 * hp/lp (Hz), wet (0..1 send), delay (s).
 */
function play(name, o = {}) {
  const b = buf[name];
  if (!b || !ctx || ctx.state !== "running") return;
  const t = ctx.currentTime + (o.delay || 0);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = o.rate || 1;
  let node = src;
  if (o.hp) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = o.hp;
    f.Q.value = 0.7;
    node = node.connect(f);
  }
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lp;
    node = node.connect(f);
  }
  if (o.peak) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = o.peak;
    f.Q.value = 1.2;
    f.gain.value = o.peakGain ?? 5;
    node = node.connect(f);
  }
  const g = ctx.createGain();
  const gain = o.gain ?? 1;
  const dur = o.dur;
  if (dur) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.setValueAtTime(gain, t + Math.max(0.003, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  } else g.gain.value = gain;
  node = node.connect(g);
  let out = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan || 0));
    out = g.connect(p);
  }
  out.connect(dry);
  if (o.wet !== 0) {
    const s = ctx.createGain();
    s.gain.value = o.wet ?? 0.5;
    out.connect(s).connect(wet);
  }
  src.start(t, o.offset || 0, dur ? dur / (o.rate || 1) + 0.01 : undefined);
}

function once(group, minGap) {
  const now = ctx ? ctx.currentTime : 0;
  const last = recent.get(group) || -1;
  if (now - last < minGap) return false;
  recent.set(group, now);
  return true;
}

// ---------- game sounds ----------
// `pitch` is a size factor: small fruit and pieces sound higher.

/** One crack of the blade going through glass. amount 0..1. */
export function grain(amount, pitch = 1, pan = 0) {
  if (!ctx) return;
  const name = pick(GROUPS.crunch);
  const on = onsets[name];
  if (!on) return;
  const offset = pick(on);
  const rate = (1.15 + Math.random() * 0.45) * pitch;
  play(name, { offset, dur: 0.045 + Math.random() * 0.07, rate, gain: 0.25 + 0.75 * amount, hp: 700, peak: 4200, peakGain: 4, pan, wet: 0.35 });
  if (Math.random() < 0.28 + 0.3 * amount)
    play(pick(GROUPS.ting), { rate: (1.7 + Math.random() * 1.1) * pitch, gain: 0.05 + 0.1 * amount, hp: 1800, dur: 0.12, pan, wet: 0.8 });
}

/** The blade bites into the surface. */
export function bite(pitch = 1, pan = 0) {
  if (!ctx) return;
  const name = pick(GROUPS.crunch);
  const on = onsets[name];
  if (on) play(name, { offset: on[0], dur: 0.11, rate: 1.0 * pitch, gain: 1.0, hp: 380, peak: 3200, peakGain: 5, pan, wet: 0.4 });
  play(pick(GROUPS.ting), { rate: 1.25 * pitch * (0.95 + Math.random() * 0.1), gain: 0.32, hp: 900, dur: 0.35, pan, wet: 0.9 });
}

/** The blade metal sliding against the glass while it moves. */
export function scrape(speed, pan = 0) {
  if (!ctx || !once("scrape", 0.11)) return;
  play(pick(GROUPS.shing), { rate: 0.9 + speed * 0.6, gain: Math.min(0.22, 0.05 + speed * 0.2), hp: 2200, dur: 0.16, pan, wet: 0.5 });
}

/** The knife has come out the other side. */
export function through(speed, pitch = 1, pan = 0) {
  if (!ctx) return;
  play(pick(GROUPS.slice), { gain: 0.35 + Math.min(0.45, speed * 0.6), rate: 1.0 + Math.random() * 0.12, hp: 250, pan, wet: 0.4 });
  play(pick(GROUPS.ting), { rate: (1.0 + Math.random() * 0.2) * pitch, gain: 0.45, hp: 500, pan, wet: 1 });
  play(pick(GROUPS.shing), { rate: 1.05, gain: 0.12, hp: 1800, pan, wet: 0.6, delay: 0.01 });
}

/** The edge meets the board. */
export function knifeBoard(speed, pan = 0) {
  if (!ctx || !once("knife", 0.06)) return;
  const g = Math.min(1, speed / 0.9);
  play(pick(GROUPS.wood), { gain: 0.25 + 0.7 * g, rate: 1.15 + Math.random() * 0.15, pan, wet: 0.3 });
  play(pick(GROUPS.shing), { gain: 0.05 + 0.08 * g, rate: 1.6, hp: 3000, dur: 0.08, pan, wet: 0.4 });
}

/** A glass body hits something. surface: "board" | "table" | "glass". strength in m/s. */
export function impact(surface, strength, pitch = 1, pan = 0) {
  if (!ctx) return;
  const g = Math.min(1, strength / 1.6);
  if (g < 0.03) return;
  const rate = pitch * (0.92 + Math.random() * 0.16);
  if (surface === "glass") {
    play(pick(GROUPS.clink), { gain: 0.15 + 0.75 * g, rate: rate * 1.1, pan, wet: 0.7 });
    return;
  }
  play(pick(g > 0.55 ? GROUPS.thudm : GROUPS.thud), { gain: 0.2 + 0.8 * g, rate, pan, wet: 0.35 });
  if (surface === "board") play(pick(GROUPS.wood), { gain: 0.1 + 0.4 * g, rate: 0.85 * rate, lp: 3500, pan, wet: 0.2 });
  if (g > 0.25) play(pick(GROUPS.ting), { gain: 0.06 + 0.15 * g, rate: rate * 1.3, hp: 1200, dur: 0.25, pan, wet: 0.9 });
}

/** A crumb melts away. */
export function sparkle(pan = 0) {
  if (!ctx || !once("sparkle", 0.05)) return;
  play(pick(GROUPS.ting), { gain: 0.08, rate: 2.2 + Math.random() * 0.6, hp: 2500, dur: 0.3, pan, wet: 1 });
}

export function uiTick() {
  if (!ctx) return;
  play(pick(GROUPS.clink), { gain: 0.12, rate: 1.8, hp: 1500, wet: 0.5 });
}
