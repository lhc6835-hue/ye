// Boot: the canvas, input and the frame loop.
import { W, H } from "./config.js";
import { Game } from "./game.js";
import { unlock, toggleMute, audioStatus } from "./audio.js";

const canvas = document.getElementById("game");
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext("2d");

const stage = canvas.parentElement;
function fit() {
  // fill the stage's content box; whole-number scaling keeps every pixel square, small screens get a fraction
  const cs = getComputedStyle(stage);
  const bw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const bh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.min(bw / W, bh / H), s = k >= 1 ? Math.floor(k) : k;
  canvas.style.width = W * s + "px";
  canvas.style.height = H * s + "px";
}
addEventListener("resize", fit);
fit();

const keys = new Set();
const input = { left: false, right: false, tilt: 0, hold: false, pressed: false, retry: false, leftPressed: false, rightPressed: false, touch: false };

// ---- tilt steering on phones: lean the phone left or right and the cat drifts that way
const TILT_DEAD = 3, TILT_FULL = 22; // degrees: ignored below, full speed at
let tiltDeg = null, tiltAsked = false;
function onOrient(e) {
  if (e.gamma === null && e.beta === null) return;
  // gamma is the left/right lean in portrait; in landscape the beta axis takes over
  const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  tiltDeg = a === 90 ? e.beta : a === -90 || a === 270 ? -e.beta : a === 180 ? -e.gamma : e.gamma;
}
// listen from the start: where the sensor needs no permission (most Android browsers) readings just arrive
if (typeof DeviceOrientationEvent !== "undefined") addEventListener("deviceorientation", onOrient);
function askTilt() {
  // iOS, and newer Chrome, gate the sensor behind a permission that may only be asked from a tap; keep
  // asking on later taps until it is granted
  if (tiltAsked || tiltDeg !== null || typeof DeviceOrientationEvent === "undefined") return;
  if (typeof DeviceOrientationEvent.requestPermission !== "function") {
    tiltAsked = true;
    return;
  }
  DeviceOrientationEvent.requestPermission()
    .then((r) => {
      if (r === "granted" || r === "denied") tiltAsked = true;
    })
    .catch(() => {});
}
function tiltAmount() {
  if (tiltDeg === null) return 0;
  const m = Math.abs(tiltDeg);
  if (m < TILT_DEAD) return 0;
  return Math.sign(tiltDeg) * Math.min(1, (m - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
}
let mouse = false;

const LEFT = ["ArrowLeft", "KeyA"], RIGHT = ["ArrowRight", "KeyD"], HOLD = ["Space"];
addEventListener("keydown", (e) => {
  if ([...LEFT, ...RIGHT, ...HOLD, "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  unlock();
  keys.add(e.code);
  if (LEFT.includes(e.code)) input.leftPressed = true;
  if (RIGHT.includes(e.code)) input.rightPressed = true;
  if (HOLD.includes(e.code) || e.code === "Enter") input.pressed = true;
  if (e.code === "KeyR") input.retry = true;
  if (e.code === "KeyM") toggleMute();
});
addEventListener("keyup", (e) => keys.delete(e.code));
const down = (e) => {
  e.preventDefault();
  unlock();
  if (e.type === "touchstart") {
    input.touch = true;
    askTilt();
  }
  mouse = true;
  input.pressed = true;
};
const up = () => (mouse = false);
addEventListener("mousedown", (e) => e.button === 0 && down(e));
addEventListener("mouseup", (e) => e.button === 0 && up());
addEventListener("touchstart", down, { passive: false });
addEventListener("touchend", up);
addEventListener("touchcancel", up);
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("blur", () => {
  keys.clear();
  mouse = false;
});

const game = new Game();
let last = performance.now();
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  input.left = LEFT.some((k) => keys.has(k));
  input.right = RIGHT.some((k) => keys.has(k));
  input.hold = mouse || HOLD.some((k) => keys.has(k));
  input.tilt = tiltAmount();
  input.tiltReady = tiltDeg !== null;
  game.update(dt, input);
  game.draw(ctx);
  input.pressed = input.retry = input.leftPressed = input.rightPressed = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for automated checks
window.__game = game;
window.__audio = audioStatus;
window.__tilt = () => ({ tiltDeg, tiltAsked, amount: tiltAmount(), hasDOE: typeof DeviceOrientationEvent !== "undefined" });
