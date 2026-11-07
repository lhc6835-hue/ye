// Sound effects and music from CC0 asset packs (see assets/audio/CREDITS.md).
// Effects are decoded into AudioBuffers and played through WebAudio so they can overlap and be pitched;
// the music streams from an <audio> element.

const BASE = "assets/audio/";
// the build stamps a version on every asset URL so a new deploy never plays a stale cached file
const V = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
const url = (name) => BASE + name + ".mp3?v=" + V;
const FILES = ["jump", "chute", "close", "near", "pickup", "mult", "mult-lost", "tired", "hit", "best", "coat", "wind"];
const MUSIC_VOL = 1, MUSIC_DUCK = 0.7, SFX_VOL = 0.5;

let ctx = null, master = null, sfxBus = null, buffers = {}, windSrc = null, windGain = null, music = null, musicGain = null;
let muted = false;
try {
  muted = localStorage.getItem("catchute.muted") === "1";
} catch {}

function load() {
  for (const name of FILES)
    fetch(url(name))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        buffers[name] = buf;
        if (name === "wind") startWind();
      })
      .catch(() => {}); // a missing sound just stays quiet
}

function startWind() {
  const b = buffers.wind;
  windSrc = ctx.createBufferSource();
  windSrc.buffer = b;
  windSrc.loop = true;
  // skip the mp3 encoder's lead-in so the loop has no gap
  windSrc.loopStart = Math.min(0.06, b.duration / 4);
  windSrc.loopEnd = b.duration - 0.02;
  windGain = ctx.createGain();
  windGain.gain.value = 0;
  windSrc.connect(windGain).connect(sfxBus);
  windSrc.start(0, windSrc.loopStart);
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
    master.gain.value = muted ? 0 : 1;
    // a limiter on the way out keeps loud music plus a crash from clipping
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -6;
    limit.knee.value = 4;
    limit.ratio.value = 12;
    limit.attack.value = 0.003;
    limit.release.value = 0.2;
    master.connect(limit).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_VOL;
    sfxBus.connect(master);
    load();
    // the music streams from an <audio> element but plays through the same mixer as the effects, so
    // mute and volume work everywhere (iOS ignores an element's own volume)
    music = new Audio(url("music"));
    music.loop = true;
    music.preload = "auto";
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOL;
    try {
      ctx.createMediaElementSource(music).connect(musicGain).connect(master);
    } catch {
      musicGain = null; // no WebAudio routing: fall back to the element's own volume
      music.volume = muted ? 0 : MUSIC_VOL;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  if (music && music.paused) music.play().catch(() => {});
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem("catchute.muted", muted ? "1" : "0");
  } catch {}
  if (master) master.gain.value = muted ? 0 : 1;
  if (music && !musicGain) music.volume = muted ? 0 : MUSIC_VOL;
  return muted;
}
export const isMuted = () => muted;

/** Play a sound: vol 0..1, rate > 1 is higher and shorter, plus a little random detune so repeats don't drone. */
function play(name, vol = 1, rate = 1, jitter = 0.04) {
  const b = buffers[name];
  if (!ctx || !b) return;
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = b;
  s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
  g.gain.value = vol;
  s.connect(g).connect(sfxBus);
  s.start();
}

export const sfx = {
  jump: () => play("jump", 0.6, 0.9),
  chute: () => play("chute", 0.9, 1.1),
  close: () => play("close", 0.7, 1.25),
  near: () => play("near", 0.8, 1.15),
  pickup: (combo = 0) => play("pickup", 0.55, 1 + Math.min(combo, 6) * 0.06),
  mult: (n) => play("mult", 0.45, 0.85 + n * 0.06, 0),
  multLost: () => play("mult-lost", 0.4, 0.9),
  tired: () => play("tired", 0.5, 0.8),
  hit: () => play("hit", 1, 0.95),
  best: () => play("best", 0.7, 1, 0),
  coat: () => play("coat", 0.5),
};

/** Wind loudness and pitch, 0..1. */
export function setWind(k) {
  if (!windGain) return;
  const t = ctx.currentTime;
  windGain.gain.setTargetAtTime(k * k * 0.6, t, 0.08);
  windSrc.playbackRate.setTargetAtTime(0.8 + k * 0.5, t, 0.1);
}

/** For automated checks: whether the music is running, and how loud the mix is right now (RMS 0..1). */
let probe = null;
export function audioStatus() {
  if (!ctx) return { started: false };
  if (!probe) {
    probe = ctx.createAnalyser();
    master.connect(probe);
  }
  const d = new Float32Array(probe.fftSize);
  probe.getFloatTimeDomainData(d);
  const rms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
  return { started: true, state: ctx.state, musicTime: music ? music.currentTime : 0, paused: music ? music.paused : true, rms };
}

/** Quieter music while the result screen is up. */
export function duckMusic(on) {
  if (musicGain) musicGain.gain.setTargetAtTime(on ? MUSIC_VOL * MUSIC_DUCK : MUSIC_VOL, ctx.currentTime, 0.3);
}
