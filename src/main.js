// Boot: the canvas, input and the frame loop.
import { W, H } from "./config.js";
import { Game } from "./game.js";
import { unlock, toggleMute } from "./audio.js";

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
const input = { left: false, right: false, hold: false, pressed: false, retry: false, leftPressed: false, rightPressed: false };
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
  game.update(dt, input);
  game.draw(ctx);
  input.pressed = input.retry = input.leftPressed = input.rightPressed = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for automated checks
window.__game = game;
