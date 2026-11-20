// SOON badge: an hourglass running out, then flipping over.
import { fit, clamp, seg, ease, TAU, WHITE, hex } from "../../core/index.js";
import { shape, INK } from "./_lib.js";

export const meta = {
  name: "Badge soon",
  desc: "A violet-framed hourglass: gold sand drains through the waist in a thin glinting stream and piles up below, then the glass flips over with a little overshoot and starts again.",
  tags: ["arcade", "badge", "hourglass", "soon", "time", "icon", "loop"],
  size: [32, 32], origin: [16, 16], duration: 3, loop: true, fps: 30, bg: "dark",
  options: { palette: ["#0e0a24", "#221a4a", "#3a2e78", "#5a4aa8", "#8a78e0", "#c4b8ff", "#ffffff"], sand: ["#86520c", "#c48412", "#f0b424", "#ffe066", "#fff6c4"], seed: 1 },
};

const RUN = 0.8, H = 8.5;

export function draw(p, t, o) {
  const C = fit(o.palette, 7), S = fit(o.sand, 5), ph = t / meta.duration;
  const u = clamp(ph / RUN), flip = seg(ph, RUN + 0.02, 1);
  const rot = Math.PI * (flip < 1 ? ease.outBack(flip, 1.2) : 1);
  const top = 1 - u, bot = u;
  const Lt = -1 - H * top, Lb = 9.5 - H * bot;
  const pile = (x) => 2 * Math.sin(bot * Math.PI) * Math.max(0, 1 - Math.abs(x) / 5);
  const dip = (x) => (u > 0 && u < 1 ? 1.4 * Math.max(0, 1 - Math.abs(x) / 4) : 0);
  const bulbW = (y) => 0.9 + 6 * Math.pow(Math.min(1, Math.abs(y) / 9.5), 0.75);
  p.glow(0, 0, 16, C[4], 0.22);
  shape(p, -11, -13, 11, 13, (x, y) => {
    // frame: top and bottom plates, two posts
    if (Math.abs(y) >= 10.5 && Math.abs(y) < 13 && Math.abs(x) <= 9.5) return Math.abs(y) < 11.5 ? C[5] : y < 0 ? C[4] : C[2];
    if (Math.abs(x) >= 8 && Math.abs(x) < 9.5 && Math.abs(y) < 10.5) return x < 0 ? C[4] : C[2];
    if (Math.abs(y) >= 10.5) return 0;
    const w = bulbW(y);
    if (Math.abs(x) > w) return 0;
    // sand in the top bulb, sitting on the waist, dipping where it drains
    if (y < 0 && y > Lt + dip(x) && top > 0.01) return x < -1 ? S[3] : S[2];
    // sand piled in the bottom bulb
    if (y > 0 && y > Lb - pile(x) && bot > 0.01) return y > 8 ? S[1] : x < -1 ? S[3] : S[2];
    // glass, with a highlight down the left
    if (Math.abs(x + w - 1.4) < 0.6 && Math.abs(y) > 2) return C[5];
    return C[1];
  }, INK, rot, 0, 0);
  // the stream through the waist, glinting
  if (u > 0.01 && u < 0.99 && flip === 0) {
    for (let y = 0; y < Lb - pile(0); y++) p.px(0, y, (Math.floor(y + t * 30) % 3) === 0 ? S[4] : S[3]);
    p.light(0, 2, S[3], 0.35);
  }
}
