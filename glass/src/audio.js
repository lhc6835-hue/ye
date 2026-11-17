// Sound: recorded CC0 samples (see assets/CREDITS.md) played through WebAudio, 320 kbps sources,
// processed in 32-bit float, in stereo.
//
// A sharp metal blade slowly slicing through solid glass:
//  - While the blade moves, a continuous friction texture (overlapping grains from scrape recordings)
//    with a toneless top-octave grit layer: the glass shards rubbing along the blade.
//  - Crisp, tiny high tinkles sprinkled across the stereo field, more of them the faster it goes:
//    25-60 ms slices of a glass ring, so they sparkle without ever turning into a long clang.
//  - A resonant metallic click when the edge engages and now and then as it glides, sent into a
//    stereo echo and a brighter hall so it rings out in space.
//  - The catch is a soft, dense press; landings are a dull wooden "tuk".
// The overall balance started from a reference glass-cutting ASMR video (cut moments only).

const V = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
const url = (n) => `assets/audio/${n}.mp3${V ? `?v=${V}` : ""}`;
const GROUPS = {
  tex: ["tex-1", "tex-2", "tex-3"],
  grain: ["grain-1", "grain-2", "grain-3"],
  snow: ["snow-0", "snow-2", "snow-4"],
  wood: ["wood-0", "wood-1", "wood-2", "wood-3", "wood-4"],
  plank: ["plank-0", "plank-2"],
  slice: ["slice-1"],
  click: ["click-1"],
  ring: ["ring-0", "ring-2"],
  tink: ["tink-1", "tink-2", "tink-3"],
};

// [type, frequency, gain dB, Q]
const EQ = [
  ["lowshelf", 95, 7, 0],
  ["peaking", 300, -5, 0.8],
  ["peaking", 820, 8, 1.4],
  ["highshelf", 7000, 5, 0],
];

const AIR = 1.5; // level of the top-octave grit under the cut texture

let ctx = null, master = null, dry = null, wet = null, echo = null, volume = 0.8;
const buf = {}; // name -> AudioBuffer
const onsets = {}; // name -> [seconds]
const recent = new Map();
const listeners = [];

export const isUnlocked = () => !!ctx && ctx.state === "running";
export const loadedCount = () => Object.keys(buf).filter((k) => k !== "air").length;
/** Test hook: the stream the demo recorder listens to. */
export const __stream = () => ctx.destination.stream;
export function onUnlock(fn) {
  listeners.push(fn);
}
export function setVolume(v) {
  volume = v;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
}

function impulse(seconds, decay, bright = 0.25) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      // low-passed noise tail: a small, soft room rather than a bright hall
      lp += bright * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

/**
 * Fine, toneless grit for the top octave (the recordings fall off above 8 kHz): soft noise sprinkled
 * with tiny clicks, high-passed when played so it reads as air and texture, never as a ring.
 */
function airBuffer() {
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let click = 0;
  for (let i = 0; i < len; i++) {
    if (Math.random() < 0.0012) click = (Math.random() * 2 - 1) * 0.9;
    d[i] = (Math.random() * 2 - 1) * 0.18 + click;
    click *= 0.55;
  }
  return b;
}

/** Start times of the transients in a recording, so grains begin on an actual crunch. */
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
    if (env[i] > peak * 0.15 && env[i] > before * 1.8 && i - last > 8) {
      out.push(Math.max(0, (i - 1) * hop) / sr);
      last = i;
    }
  }
  return out.length ? out : [0];
}

async function load() {
  await Promise.all(
    Object.values(GROUPS).flat().map(async (n) => {
      try {
        const r = await fetch(url(n));
        if (!r.ok) return;
        const b = await ctx.decodeAudioData(await r.arrayBuffer());
        buf[n] = b;
        if (n.startsWith("grain") || n.startsWith("snow") || n.startsWith("click")) onsets[n] = findOnsets(b);
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
    // tone shaping toward the reference (see EQ), then a gentle limiter
    const eq = EQ.map(([type, f, gain, q]) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.gain.value = gain;
      if (q) b.Q.value = q;
      return b;
    });
    eq.reduce((a, b) => a.connect(b));
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 10;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.2;
    master.connect(eq[0]);
    eq[eq.length - 1].connect(limiter).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(0.45, 2.6);
    const pre = ctx.createBiquadFilter();
    pre.type = "lowpass";
    pre.frequency.value = 5000;
    wet = ctx.createGain();
    wet.gain.value = 0.1;
    wet.connect(pre).connect(verb).connect(master);
    // echo bus for the metal and the sparkle: a stereo ping-pong delay plus a brighter, longer hall
    echo = ctx.createGain();
    echo.gain.value = 1;
    const hall = ctx.createConvolver();
    hall.buffer = impulse(1.6, 3.4, 0.6);
    const hallIn = ctx.createGain();
    hallIn.gain.value = 0.22;
    echo.connect(hallIn).connect(hall).connect(master);
    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
    dl.delayTime.value = 0.115;
    dr.delayTime.value = 0.175;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 6500;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.3;
    echo.connect(split);
    split.connect(dl, 0).connect(merge, 0, 0);
    split.connect(dr, 1).connect(merge, 0, 1);
    dl.connect(dr);
    dr.connect(tone).connect(fb).connect(dl);
    merge.connect(echoOut).connect(master);
    buf.air = airBuffer();
    load();
  }
  if (ctx.state !== "running") ctx.resume().then(() => listeners.forEach((f) => f()));
  else listeners.forEach((f) => f());
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/**
 * Plays one sample. opts: gain, rate, pan, offset, dur (with soft fades), attack, release,
 * lp/hp (Hz), wet (send), at (absolute start time).
 */
function play(name, o = {}) {
  const b = buf[name];
  if (!b || !ctx || ctx.state !== "running") return;
  const t = o.at ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = o.rate || 1;
  let node = src;
  if (o.hp) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = o.hp;
    node = node.connect(f);
  }
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lp;
    f.Q.value = 0.5;
    node = node.connect(f);
  }
  const g = ctx.createGain();
  const gain = o.gain ?? 1;
  if (o.dur) {
    const a = o.attack ?? 0.004;
    const r = o.release ?? Math.min(0.08, o.dur * 0.45);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setValueAtTime(gain, t + Math.max(a, o.dur - r));
    g.gain.linearRampToValueAtTime(0, t + o.dur);
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
    s.gain.value = o.wet ?? 0.4;
    out.connect(s).connect(wet);
  }
  if (o.echo) {
    const s = ctx.createGain();
    s.gain.value = o.echo;
    out.connect(s).connect(echo);
  }
  src.start(t, o.offset || 0, o.dur ? o.dur * (o.rate || 1) + 0.01 : undefined);
}

function once(key, gap) {
  const now = ctx ? ctx.currentTime : 0;
  if (now - (recent.get(key) ?? -1) < gap) return false;
  recent.set(key, now);
  return true;
}

// ---------- the blade moving through glass: a continuous texture ----------
let texNext = 0, texLevel = 0, texBright = 0, texPan = 0, texSide = 1;
/** Call every frame while the blade moves through. level 0..1 (loudness), speed 0..1 (brightness) */
export function texture(level, speed, pan = 0) {
  if (!ctx || ctx.state !== "running") return;
  texLevel += (level - texLevel) * 0.35;
  texBright += (speed - texBright) * 0.35;
  texPan = pan;
  const now = ctx.currentTime;
  if (texNext < now) texNext = now + 0.005;
  // overlapping 160 ms grains every 70 ms, scheduled a little ahead: one seamless "sss"
  while (texNext < now + 0.06) {
    const name = pick(GROUPS.tex);
    const b = buf[name];
    if (!b) break;
    play(name, {
      at: texNext, offset: 0.05 + Math.random() * Math.max(0.01, b.duration - 0.3), dur: 0.16, attack: 0.06, release: 0.07,
      rate: 0.9 + Math.random() * 0.08, gain: 0.55 * texLevel, lp: 11000 + 9000 * texBright, hp: 120, pan: texPan + 0.28 * (texSide = -texSide), wet: 0.25,
    });
    play("air", { at: texNext, offset: Math.random() * 1.7, dur: 0.16, attack: 0.06, release: 0.07, gain: AIR * texLevel * (0.6 + 0.4 * texBright), hp: 6500, pan: texPan + (Math.random() - 0.5), wet: 0.15 });
    texNext += 0.07;
  }
}
export function textureStop() {
  texLevel = 0;
  texNext = 0;
}

/** A soft bit of grit as the edge passes a grain in the glass. amount 0..1 */
export function grain(amount, pitch = 1, pan = 0) {
  if (!ctx) return;
  const name = pick(GROUPS.grain);
  const on = onsets[name];
  if (!on) return;
  play(name, { offset: pick(on), dur: 0.07 + Math.random() * 0.05, attack: 0.006, rate: (0.85 + Math.random() * 0.12) * Math.sqrt(pitch), gain: 0.12 + 0.28 * amount, pan, wet: 0.3 });
}

/** The edge settles in and gives: a soft, dense press. */
export function bite(pitch = 1, pan = 0) {
  if (!ctx) return;
  const s = pick(GROUPS.snow);
  play(s, { offset: (onsets[s] || [0])[0], dur: 0.2, attack: 0.008, rate: 0.95 * Math.sqrt(pitch), gain: 0.75, lp: 9000, pan, wet: 0.3 });
  const g = pick(GROUPS.grain);
  play(g, { offset: (onsets[g] || [0])[0], dur: 0.09, attack: 0.005, rate: 0.9, gain: 0.3, lp: 8000, pan, wet: 0.3 });
  metalClick(0.85, pan);
  tinkle(0.7, pan);
}

/** A crisp, tiny sparkle of glass: a 25-60 ms slice of a glass ring, placed somewhere in the stereo field. */
export function tinkle(amount = 0.5, pan = 0, delay = 0) {
  if (!ctx) return;
  const name = pick(GROUPS.tink);
  const b = buf[name];
  if (!b) return;
  play(name, {
    at: ctx.currentTime + delay, offset: 0.02 + Math.random() * Math.max(0.02, Math.min(0.35, b.duration - 0.12)),
    dur: 0.025 + Math.random() * 0.035, attack: 0.002, release: 0.02, rate: 0.95 + Math.random() * 0.6,
    gain: 0.05 + 0.13 * amount, hp: 3000, pan: pan + (Math.random() - 0.5) * 1.3, wet: 0.5, echo: 0.25,
  });
}

/** The steel edge clicking against the glass, with a short metallic resonance and an echo. */
export function metalClick(amount = 0.5, pan = 0) {
  if (!ctx || !once("click", 0.09)) return;
  const c = pick(GROUPS.click);
  play(c, { offset: (onsets[c] || [0])[0], dur: 0.06, attack: 0.001, release: 0.04, rate: 0.95 + Math.random() * 0.15, gain: 0.12 + 0.3 * amount, hp: 900, pan, wet: 0.3, echo: 0.55 });
  play(pick(GROUPS.ring), { gain: 0.05 + 0.1 * amount, rate: 1.4 + Math.random() * 0.3, hp: 1200, lp: 9000, pan: -pan * 0.5, wet: 0.4, echo: 0.6 });
}

/** The blade comes out the other side: a soft breath of air. */
export function through(speed, pitch = 1, pan = 0) {
  if (!ctx) return;
  play(pick(GROUPS.slice), { gain: 0.1 + Math.min(0.18, speed * 0.3), rate: 0.9, lp: 7000, pan, wet: 0.3 });
  const s = pick(GROUPS.snow);
  play(s, { offset: (onsets[s] || [0])[0], dur: 0.12, rate: 1.05 * Math.sqrt(pitch), gain: 0.35, lp: 8000, pan, wet: 0.2 });
  // a few shards of sparkle as the halves let go
  for (let i = 0; i < 3; i++) tinkle(0.55 - i * 0.12, pan, i * 0.045 + Math.random() * 0.03);
  metalClick(0.45, pan);
}

/** The edge meets the board: a dull "tuk". */
export function knifeBoard(speed, pan = 0) {
  if (!ctx || !once("knife", 0.07)) return;
  const g = Math.min(1, speed / 0.8);
  play(pick(GROUPS.wood), { gain: 0.25 + 0.6 * g, rate: 1.05 + Math.random() * 0.1, lp: 2800, pan, wet: 0.2 });
}

/** A glass piece lands or knocks. surface: "board" | "table" | "glass". strength in m/s. */
export function impact(surface, strength, pitch = 1, pan = 0) {
  if (!ctx) return;
  const g = Math.min(1, strength / 1.4);
  if (g < 0.04) return;
  const p = Math.pow(pitch, 0.35) * (0.94 + Math.random() * 0.1);
  if (surface === "glass") {
    // two pieces knocking: a small, muffled "tok", never a clink
    play(pick(GROUPS.wood), { gain: 0.08 + 0.35 * g, rate: 1.3 * p, lp: 1800, pan, wet: 0.2 });
    return;
  }
  const lp = surface === "table" ? 1400 : 2600;
  play(pick(GROUPS.wood), { gain: 0.25 + 0.7 * g, rate: 0.9 * p, lp, pan, wet: 0.25 });
  if (g > 0.35) play(pick(GROUPS.plank), { gain: 0.5 * g, rate: 1.1 * p, lp: 1600, pan, wet: 0.2 });
}

/** A crumb melts away: barely there. */
export function sparkle(pan = 0) {
  if (!ctx || !once("melt", 0.08)) return;
  const s = pick(GROUPS.snow);
  play(s, { offset: (onsets[s] || [0])[0], dur: 0.15, rate: 1.2, gain: 0.12, lp: 2000, pan, wet: 0.4 });
}

export function uiTick() {
  if (!ctx) return;
  play(pick(GROUPS.wood), { gain: 0.18, rate: 1.6, lp: 3000, wet: 0.2 });
}
