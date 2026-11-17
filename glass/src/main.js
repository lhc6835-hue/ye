// Boots the stage, physics and game, wires mouse/touch input, and runs the frame loop.
import { Stage } from "./stage.js";
import { Physics } from "./physics.js";
import { Game } from "./game.js";
import { buildUI, loadSettings, saveSettings } from "./ui.js";
import * as sfx from "./audio.js";

const canvas = document.getElementById("view");
const loading = document.getElementById("loading");
const settings = loadSettings();
const coarse = matchMedia("(pointer: coarse)").matches;
const canVibrate = typeof navigator.vibrate === "function";

const stage = new Stage(canvas);
const physics = new Physics();
let game = null, ui = null, sheetOpen = false;
let autoQuality = coarse ? "medium" : "high";

function applyQuality() {
  stage.setQuality(settings.quality === "auto" ? autoQuality : settings.quality);
}

async function start() {
  await Promise.all([stage.load(), physics.init()]);
  applyQuality();
  sfx.setVolume(settings.volume);
  game = new Game(stage, physics, settings, {
    onCount() {
      settings.count++;
      saveSettings(settings);
      ui.setCount(settings.count);
    },
    haptic(ms) {
      if (settings.haptics && canVibrate) navigator.vibrate(ms);
    },
  });
  await game.warmUp(stage.renderer, stage.camera);
  // test hook: screen position of the first whole fruit
  window.__sfxLoaded = () => sfx.loadedCount();
  window.__chunks = () => game.chunks.map((c) => (c.whole ? "whole" : c.dissolving ? "vanishing" : "piece")).join(",");
  window.__fruitScreen = () => {
    const c = game.chunks.find((x) => x.whole);
    if (!c) return null;
    const v = c.group.position.clone().project(stage.camera);
    return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
  };
  const gallery = new URLSearchParams(location.search).get("gallery");
  if (gallery) game.gallery(gallery);
  ui = buildUI(settings, {
    canVibrate,
    onChange(what) {
      saveSettings(settings);
      if (what === "volume") sfx.setVolume(settings.volume);
      if (what === "quality") applyQuality();
      sfx.uiTick();
    },
    onReset() {
      saveSettings(settings);
    },
    onOpen(v) {
      sheetOpen = v;
      if (v && game) game.setPointer(0, 0, false, true);
    },
  });
  ui.setMuted(!sfx.isUnlocked());
  sfx.onUnlock(() => ui.setMuted(false));
  loading.classList.add("done");
  canvas.classList.add("ready");
  requestAnimationFrame(frame);
}

// ---------- input ----------
const ndc = (e) => [(e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1];
const touches = new Set();
canvas.addEventListener("pointermove", (e) => {
  if (!game || sheetOpen) return;
  const isTouch = e.pointerType !== "mouse";
  if (isTouch && !touches.has(e.pointerId)) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const last = evs[evs.length - 1] || e;
  game.setPointer(...ndc(last), true, isTouch);
});
canvas.addEventListener("pointerdown", (e) => {
  sfx.unlock();
  if (!game || sheetOpen) return;
  if (e.pointerType !== "mouse") {
    // one blade: the most recent finger drives it
    touches.clear();
    touches.add(e.pointerId);
    canvas.setPointerCapture?.(e.pointerId);
    game.setPointer(...ndc(e), true, true);
  } else game.setPointer(...ndc(e), true, false);
});
const lift = (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.delete(e.pointerId);
  if (game) game.setPointer(...ndc(e), false, true);
};
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);
window.addEventListener("keydown", () => sfx.unlock());
document.getElementById("ui").addEventListener("pointerdown", () => sfx.unlock());
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", () => stage.resize());

// ---------- loop ----------
let last = performance.now(), slow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  game.update(dt);
  stage.render();
  // automatic quality steps down if frames keep running long
  if (settings.quality === "auto" && autoQuality !== "low") {
    slow = dt > 1 / 42 ? slow + dt : Math.max(0, slow - dt * 0.5);
    if (slow > 2.5) {
      autoQuality = autoQuality === "high" ? "medium" : "low";
      slow = 0;
      applyQuality();
    }
  }
}
document.addEventListener("visibilitychange", () => {
  last = performance.now();
});

start().catch((err) => {
  console.error(err);
  loading.textContent = "불러오지 못했어요. 새로고침해 주세요.";
  loading.classList.add("error");
});
