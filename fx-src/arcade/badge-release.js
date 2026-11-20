// RELEASE badge: a gold trophy with a sweep of light across it and glints popping round it.
import { fit, rand, clamp, TAU, WHITE, hex } from "../../core/index.js";
import { shape, glint, INK } from "./_lib.js";

export const meta = {
  name: "Badge release",
  desc: "A stout gold trophy cup with ring handles on a stepped plinth; a bright band sweeps across it once a loop and little glints pop around it.",
  tags: ["arcade", "badge", "trophy", "release", "icon", "loop"],
  size: [32, 32], origin: [16, 17], duration: 2.4, loop: true, fps: 30, bg: "dark",
  options: { palette: ["#2a1604", "#5e3208", "#a05c0c", "#e09414", "#ffc626", "#ffe866", "#fff8c4", "#ffffff"], seed: 2 },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), ph = t / meta.duration, s = o.seed;
  const sweep = -26 + (ph / 0.45) * 52; // the shine band's position along x + y
  p.glow(0, -4, 18, C[4], 0.28 + 0.08 * Math.sin(ph * TAU));
  shape(p, -14, -13, 14, 12, (x, y) => {
    let c = 0, lit = 0;
    // bowl
    if (y >= -11 && y < 0) {
      const v = (y + 11) / 11, hw = 8.5 - v * v * 4.5;
      if (Math.abs(x) <= hw) { const u = x / hw; lit = -u * 0.8 - v * 0.3 + 0.35; c = 1; if (y < -9.5) lit += 0.5; if (y >= -9.5 && y < -8.5) lit -= 0.6; }
    }
    // handles: rings on both sides
    for (const sd of [-1, 1]) {
      const d = Math.hypot(x - sd * 9, y + 7);
      if (d < 3.6 && d > 1.6 && sd * x > 8) { c = 1; lit = sd < 0 ? 0.5 : -0.3; }
    }
    // stem, collar, base, plinth
    if (y >= 0 && y < 4 && Math.abs(x) <= 1.5 + (y < 1 ? 1.5 : 0)) { c = 1; lit = x < 0 ? 0.3 : -0.2; }
    if (y >= 4 && y < 7 && Math.abs(x) <= 4.5) { c = 1; lit = y < 5 ? 0.6 : x < 0 ? 0.1 : -0.4; }
    if (y >= 7 && y < 10 && Math.abs(x) <= 6.5) { c = 2; lit = y < 8 ? 0.2 : -0.5; }
    if (!c) return 0;
    const sw = Math.abs(x + y - sweep);
    if (sw < 1.2 && c === 1) return WHITE;
    if (sw < 2.4 && c === 1) lit += 0.5;
    const i = clamp(Math.round(4 + lit * 2.4), 1, 6);
    return c === 2 ? [C[1], C[2], C[3]][clamp(Math.round(1 + lit * 2), 0, 2)] : C[i];
  }, INK);
  // a star stamped on the bowl
  p.px(0, -6, C[6]); p.px(-1, -5, C[6]); p.px(1, -5, C[3]); p.px(0, -4, C[3]); p.px(0, -5, C[7]);
  // glints popping round it, three per loop
  for (let i = 0; i < 3; i++) {
    const age = (((ph - (i / 3 + 0.12)) % 1) + 1) % 1, life = 0.18;
    if (age > life) continue;
    const k = Math.sin((age / life) * Math.PI);
    const x = [-11, 11, 7][i] + Math.round(rand(i, 1, s) * 2), y = [-12, -2, -13][i];
    glint(p, x, y, 1 + 1.6 * k, WHITE, C[5], 0.3 * k);
  }
}
