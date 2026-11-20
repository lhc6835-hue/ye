// The PLAY press: a white pop, a square shock ring and a diamond ring rolling out, sparks, and READY! slamming in.
import { fit, clamp, seg, ease, rand, fly, flyV, TAU, WHITE } from "../../core/index.js";
import { glint, INK } from "./_lib.js";

export const meta = {
  name: "Press start",
  desc: "A button press bursts: a white pop, a square and a diamond shock ring roll out at different speeds, sparks spray and fall, and READY! slams in with an overshoot, blinks and clears.",
  tags: ["arcade", "ui", "start", "burst", "button"],
  size: [176, 112],
  origin: [88, 60],
  duration: 1.3,
  loop: false,
  fps: 30,
  bg: "dark",
  options: {
    palette: ["#041418", "#0c5260", "#18b4b0", "#4ce8d8", "#b4fff0", "#ffffff"],
    accent: ["#3d0a33", "#b0228f", "#f53cd1", "#ff86e6", "#ffd2f6"],
    gold: ["#86520c", "#f0b424", "#ffe066", "#fff6c4"],
    seed: 5,
  },
};

// ring of a "square" (p = Infinity norm) or "diamond" (p = 1 norm)
function normRing(p, r, w, kind, cfn, afn) {
  const R = r + w + 1;
  p.shade(-R, -R, R, R, (x, y, out) => {
    const d = kind === "square" ? Math.max(Math.abs(x), Math.abs(y)) : (Math.abs(x) + Math.abs(y)) * 0.75;
    const q = Math.abs(d - r);
    if (q > w) return;
    const u = q / w;
    out.a = afn(u);
    out.k = 0.35 * (1 - u);
    return cfn(u);
  });
}

export function draw(p, t, o) {
  const C = fit(o.palette, 6), A = fit(o.accent, 5), Gd = fit(o.gold, 4), s = o.seed;

  // ---- pop: a white disc for two frames, then a hot core that shrinks
  if (t < 0.05) { p.circle(0, 0, 10, WHITE); p.glow(0, 0, 60, C[4], 0.9); }
  else if (t < 0.2) {
    const k = 1 - seg(t, 0.05, 0.2);
    p.circle(0, 0, 7 * k, k > 0.5 ? WHITE : C[4]);
    p.glow(0, 0, 30 * k + 6, C[3], 0.6 * k);
  }

  // ---- rings: a fast square one in cyan, a slower diamond one in magenta
  {
    const a = t, L = 0.5;
    if (a < L) {
      const k = ease.outQuart(a / L), f = 1 - a / L;
      normRing(p, 6 + 42 * k, 1 + 2 * f, "square", (u) => (u < 0.4 && f > 0.5 ? WHITE : u < 0.6 ? C[4] : C[2]), (u) => f * 1.3 - u * 0.4);
    }
  }
  {
    const a = t - 0.06, L = 0.6;
    if (a > 0 && a < L) {
      const k = ease.outCubic(a / L), f = 1 - a / L;
      normRing(p, 6 + 52 * k, 1 + 1.5 * f, "diamond", (u) => (u < 0.4 && f > 0.6 ? A[4] : u < 0.6 ? A[3] : A[2]), (u) => f * 1.2 - u * 0.3);
    }
  }

  // ---- sparks: 24, stretched by speed, slowing and dropping
  for (let i = 0; i < 24; i++) {
    const life = 0.3 + rand(i, 1, s) * 0.45;
    if (t > life) continue;
    const ang = (i / 24) * TAU + rand(i, 2, s) * 0.25, sp = 120 + rand(i, 3, s) * 140;
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp * 0.75;
    const [x, y] = fly(0, 0, vx, vy, t, 260, 4.5), [ux, uy] = flyV(vx, vy, t, 260, 4.5);
    const v = Math.hypot(ux, uy) || 1, L = Math.min(7, v / 28), k = 1 - t / life;
    const pal = i % 3 === 0 ? A : i % 3 === 1 ? C : null;
    const hot = k > 0.65 ? WHITE : pal ? pal[3] : Gd[2];
    p.line(x, y, x - (ux / v) * L, y - (uy / v) * L, (u) => (u < 0.35 ? hot : pal ? pal[2] : Gd[1]));
    p.light(x, y, pal ? pal[3] : Gd[2], 0.55 * k);
  }

  // ---- READY!: slams in big, squashes, settles; blinks then clears
  {
    const a = t - 0.1;
    if (a > 0 && a < 1.12) {
      const pop = a < 0.18 ? ease.outBack(a / 0.18) : 1;
      const sc = a < 0.06 ? 3 : 2;
      const blink = a > 0.8 && Math.floor(a * 18) % 2 === 0;
      const y = -8 + (1 - pop) * -14;
      if (!blink) {
        const fill = (gx, gy) => (gy < 2 ? WHITE : gy < 4 ? Gd[3] : gy < 6 ? Gd[2] : Gd[1]);
        p.text("READY!", 0, y - (sc === 3 ? 3 : 0), a < 0.04 ? WHITE : fill, { font: "big", scale: sc, align: "center", outline: INK, shadow: A[1] });
        p.glowLine(-40, y + 7, 40, y + 7, 14, Gd[2], 0.22 * (1 - a / 1.12));
      }
      // a sweep of light across the letters once they land
      const sw = seg(a, 0.22, 0.42);
      if (sw > 0 && sw < 1) {
        const x = -44 + 88 * sw;
        p.glowLine(x - 3, y - 2, x + 3, y + 16, 5, WHITE, 0.6);
      }
    }
  }

  // ---- glints hanging in the air after the burst
  for (let i = 0; i < 7; i++) {
    const a = t - 0.18 - rand(i, 6, s) * 0.5;
    if (a < 0 || a > 0.3) continue;
    const k = Math.sin((a / 0.3) * Math.PI), ang = rand(i, 7, s) * TAU, d = 30 + rand(i, 8, s) * 40;
    glint(p, Math.cos(ang) * d, Math.sin(ang) * d * 0.6, 1 + 2 * k, WHITE, i & 1 ? A[3] : C[3], 0.3 * k);
  }
}
