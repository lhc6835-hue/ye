// A placeholder screen for a cabinet with no cover art yet: washed-out colour bars under rolling static,
// a slow sync roll, and a NO SIGNAL plate blinking in the middle.
import { fit, rand, clamp, TAU, WHITE, hex, mix } from "../../core/index.js";
import { bayer, INK } from "./_lib.js";

export const meta = {
  name: "No signal",
  desc: "Faded colour bars under drifting static, a dark sync band rolling up the screen, a bright interference line now and then, and a NO SIGNAL plate that blinks.",
  tags: ["arcade", "tv", "static", "placeholder", "screen", "loop"],
  size: [160, 120],
  origin: [0, 0],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "black",
  options: {
    bars: ["#c8c8d0", "#d8c84a", "#4ac8c8", "#4ac84a", "#c84ac8", "#c84a4a", "#4a4ac8"],
    palette: ["#05040a", "#151324", "#2a2740", "#55507a", "#9a95c0", "#e8e6ff"],
    seed: 4,
  },
};

const W = 160, H = 120;

export function draw(p, t, o) {
  const B = o.bars.map(hex), C = fit(o.palette, 6), ph = t / meta.duration, s = o.seed;
  const f = Math.floor(ph * 72); // static changes every frame; 72 frames a loop
  const roll = ((ph * 1) % 1) * (H + 30) - 15; // sync band, once a loop
  const glitchY = (f % 24 < 2) ? Math.floor(rand(Math.floor(f / 24), 3, s) * H) : -99;

  p.shade(0, 0, W - 1, H - 1, (x, y, out) => {
    const yi = Math.floor(y), xi = Math.floor(x);
    // horizontal jitter on a few lines
    const jit = Math.abs(yi - glitchY) < 3 ? Math.floor((rand(yi, f, s) - 0.5) * 8) : 0;
    const bx = clamp(Math.floor(((xi + jit) / W) * 7), 0, 6);
    let c = yi < H * 0.72 ? B[bx] : yi < H * 0.8 ? B[6 - bx] : C[bx % 2 ? 1 : 2];
    // fade the bars toward the dark: an old, weak signal
    c = mix(C[1], c, 0.42);
    // static: two grains per frame
    const n = rand(xi >> 0, yi, f + s * 131);
    if (n > 0.93) c = n > 0.985 ? C[5] : n > 0.96 ? C[4] : C[3];
    else if (n < 0.06) c = C[0];
    // the sync band
    const dr = yi - roll;
    if (dr > 0 && dr < 14) { if (bayer(xi, yi) < 0.6 * Math.sin((dr / 14) * Math.PI)) c = C[0]; }
    // scanlines
    if (yi & 1) c = mix(C[0], c, 0.7);
    // interference line
    if (Math.abs(yi - glitchY) < 1) { c = C[5]; out.l = C[4]; out.k = 0.4; }
    return c;
  });

  // vignette: dark dithered corners
  p.shade(0, 0, W - 1, H - 1, (x, y) => {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), d = dx * dx * 0.7 + dy * dy * 0.7;
    if (d > 0.62 && bayer(x, y) < (d - 0.62) * 2.2) return C[0];
  });

  // the NO SIGNAL plate: blinks on a 2-beat rhythm per loop
  const on = Math.sin(ph * TAU * 2) > -0.35;
  const bx = W / 2, by = H / 2 - 2;
  p.rect(bx - 40, by - 9, 80, 18, INK);
  p.rect(bx - 39, by - 8, 78, 16, C[1]);
  p.line(bx - 39, by - 8, bx + 38, by - 8, C[3]);
  if (on) {
    p.text("NO SIGNAL", bx, by - 3, (gx, gy) => (gy < 3 ? WHITE : C[4]), { font: "big", align: "center" });
    p.glow(bx, by, 36, C[4], 0.2);
  }
}
