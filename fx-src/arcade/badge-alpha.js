// ALPHA badge: a hot pink gear turning, throwing sparks off one tooth.
import { fit, rand, clamp, TAU, WHITE, fly, cycle } from "../../core/index.js";
import { shape, INK } from "./_lib.js";

export const meta = {
  name: "Badge alpha",
  desc: "A chunky eight-tooth gear turns one tooth a loop, lit from the top left with a bright rim; sparks scrape off the top right as it grinds.",
  tags: ["arcade", "badge", "gear", "alpha", "work", "icon", "loop"],
  size: [32, 32], origin: [16, 16], duration: 1.6, loop: true, fps: 30, bg: "dark",
  options: { palette: ["#1a0516", "#3d0a33", "#701560", "#b0228f", "#f53cd1", "#ff86e6", "#ffd2f6", "#ffffff"], spark: ["#ff9a2a", "#ffe03c", "#ffffff"], seed: 8 },
};

const N = 8, LA = Math.atan2(-1, -1);

export function draw(p, t, o) {
  const C = fit(o.palette, 8), S = fit(o.spark, 3), ph = t / meta.duration, s = o.seed;
  const rot = ph * (TAU / N);
  p.glow(0, 0, 17, C[4], 0.3);
  shape(p, -13, -13, 13, 13, (x, y) => {
    const r = Math.hypot(x, y);
    if (r < 3.2) return 0;
    let a = Math.atan2(y, x) - rot;
    const toothPh = (((a / (TAU / N)) % 1) + 1) % 1, tooth = Math.abs(toothPh - 0.5) < 0.27;
    const outer = tooth ? 11.6 : 8.6;
    if (r > outer) return 0;
    const l = Math.cos(Math.atan2(y, x) - LA);
    if (r < 4.6) return l > 0.2 ? C[3] : C[1];               // the hub's inner bevel (shadowed)
    if (r > outer - 1.2) return l > 0.3 ? C[6] : l > -0.3 ? C[5] : C[3];  // rim
    if (r > 6 && r < 7) return l > 0 ? C[3] : C[2];           // groove ring
    return l > 0.4 ? C[5] : l > -0.2 ? C[4] : C[3];
  }, INK, 0, 0, 0);
  // bolt holes in the face, turning with it
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * TAU) / 4 + TAU / 8, x = Math.cos(a) * 5.4, y = Math.sin(a) * 5.4;
    p.px(x, y, C[1]);
  }
  // sparks scraped off the top right
  cycle(t, meta.duration, 9, s, (g) => 0.25 + g.next() * 0.3, (age, life, r) => {
    const ang = -Math.PI * 0.35 + (r.next() - 0.5) * 1.1, sp = 40 + r.next() * 50;
    const [x, y] = fly(7, -8, Math.cos(ang) * sp, Math.sin(ang) * sp, age, 180, 1.5);
    const k = 1 - age / life;
    if (x > 15 || y < -15) return;
    p.px(x, y, k > 0.6 ? S[2] : k > 0.3 ? S[1] : S[0]);
    p.light(x, y, S[1], 0.5 * k);
  });
}
