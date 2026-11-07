// Sound effects and music from CC0 asset packs (see assets/audio/CREDITS.md).
// Effects are decoded into AudioBuffers and played through WebAudio so they can overlap and be pitched;
// the music streams from an <audio> element.

const BASE = "assets/audio/";
const FILES = ["jump", "chute", "close", "near", "pickup", "mult", "mult-lost", "tired", "hit", "best", "coat", "wind"];
const MUSIC_VOL = 0.32;

let ctx = null, master = null, sfxBus = null, buffers = {}, windSrc = null, windGain = null, music = null;
let muted = false;
try {
  muted = localStorage.getItem("catchute.muted") === "1";
} catch {}

function load() {
  for (const name of FILES)
    fetch(BASE + name + ".mp3")
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
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.8;
    sfxBus.connect(master);
    load();
    music = new Audio(BASE + "music.mp3");
    music.loop = true;
    music.volume = muted ? 0 : MUSIC_VOL;
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
  if (music) music.volume = muted ? 0 : MUSIC_VOL;
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
  windGain.gain.setTargetAtTime(k * k * 0.9, t, 0.08);
  windSrc.playbackRate.setTargetAtTime(0.8 + k * 0.5, t, 0.1);
}

/** Quieter music while the result screen is up. */
export function duckMusic(on) {
  if (music && !muted) music.volume = on ? MUSIC_VOL * 0.45 : MUSIC_VOL;
}
