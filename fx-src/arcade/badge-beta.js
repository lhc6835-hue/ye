// BETA badge: a round flask of glowing cyan brew that sloshes and bubbles.
import { fit, rand, clamp, TAU, WHITE, hex, mix, cycle } from "../../core/index.js";
import { shape, INK } from "./_lib.js";

export const meta = {
  name: "Badge beta",
  desc: "A round-bottomed glass flask, corked, half full of glowing cyan brew that sloshes side to side; bubbles rise and pop at the surface, one escapes from the neck now and then.",
  tags: ["arcade", "badge", "flask", "beta", "potion", "icon", "loop"],
  size: [32, 32], origin: [16, 17], duration: 2, loop: true, fps: 30, bg: "dark",
  options: { palette: ["#041418", "#08303a", "#0c5260", "#108088", "#18b4b0", "#4ce8d8", "#b4fff0", "#ffffff"], glass: "#2a2a44", cork: ["#3a2010", "#7a4a20", "#b07838"], seed: 6 },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), ph = t / meta.duration, GL = hex(o.glass), K = o.cork.map(hex), s = o.seed;
  const tilt = Math.sin(ph * TAU) * 0.18;
  const surf = (x) => 2 + x * tilt + Math.sin(x * 0.7 + ph * TAU * 2) * 0.6;
  p.glow(0, 5, 16, C[4], 0.35 + 0.08 * Math.sin(ph * TAU * 2));
  shape(p, -10, -14, 10, 13, (x, y) => {
    const d = Math.hypot(x, y - 4);
    const inBulb = d <= 8.5, inNeck = Math.abs(x) <= 2.6 && y >= -10 && y < -2, lip = Math.abs(x) <= 3.6 && y >= -11 && y < -9.5;
    const cork = Math.abs(x) <= 2.2 && y >= -14 && y < -11;
    if (cork) return y < -13 ? K[2] : x < 0 ? K[1] : K[0];
    if (lip) return y < -10.5 ? C[6] : C[3];
    if (!inBulb && !inNeck) return 0;
    // glass highlight arc, upper left
    if (inBulb && d > 6 && d < 7.6 && x < -1 && y < 4 && y > -1) return C[6];
    if (inNeck && x < -1.2 && x > -2.2 && y < -5) return C[5];
    if (inBulb && y > surf(x)) {
      // the brew: brighter toward the surface, darker at the bottom right
      const depth = y - surf(x), shadeV = depth < 1 ? 7 : depth < 2.5 ? 5 : x + (y - 4) > 6 ? 3 : 4;
      return C[shadeV === 7 ? 6 : shadeV];
    }
    return mix(GL, C[1], 0.4);
  }, INK);
  // bubbles rising through the brew and popping at the surface
  cycle(t, meta.duration, 7, s, (g) => 0.5 + g.next() * 0.5, (age, life, r) => {
    const x0 = (r.next() - 0.5) * 9, k = age / life, y = 11 - k * 9 + 0;
    const x = x0 + Math.sin(k * 6 + x0) * 0.8;
    if (y < surf(x)) return;
    const big = r.next() < 0.35;
    p.px(x, y, big ? C[7] : C[6]);
    if (big) { p.px(x + 1, y, C[5]); p.px(x, y - 1, C[5]); }
  });
  // one bubble escapes the neck each loop
  {
    const a = (ph + 0.6) % 1, life = 0.35;
    if (a < life) {
      const k = a / life, y = -11 - k * 9, x = Math.sin(k * 7) * 1.5;
      if (k < 0.85) { p.px(x, y, C[6]); p.px(x - 1, y, C[5]); p.px(x + 1, y, C[5]); p.px(x, y - 1, C[5]); p.px(x, y + 1, C[5]); p.px(x, y, INK); p.light(x, y, C[5], 0.4); }
      else { p.px(x - 2, y, C[6]); p.px(x + 2, y, C[6]); p.px(x, y - 2, C[6]); }
    }
  }
}
