// Attract-mode backdrop for the arcade hub. Everything is a function of the loop phase.
import { fit, rand, clamp, smooth, TAU, WHITE, hex, mix, tileNoise } from "../../core/index.js";
import { bayer, dstep } from "./_lib.js";

export const meta = {
  name: "Synth horizon",
  desc: "A neon grid floor races toward you under a striped setting sun; pixel mountains catch its rim light, stars twinkle, a meteor streaks by and motes drift up off the horizon.",
  tags: ["arcade", "background", "retro", "neon", "grid", "sun", "loop"],
  size: [320, 180],
  origin: [0, 0],
  duration: 6,
  loop: true,
  fps: 30,
  bg: "black",
  options: {
    palette: ["#06030f", "#0d0624", "#1c0a3d", "#3a0f5c", "#6d1673", "#b0228f", "#f0407a", "#ff7a5c", "#ffb14a", "#ffe066", "#fff6c4"],
    grid: ["#14062a", "#3d0a56", "#8a1a9a", "#e23cd0", "#ff9cf0", "#ffffff"],
    seed: 7,
  },
};

const W = 320, H = 180, HZ = 112, CX = 160;
const SUN_Y = 98, SUN_R = 40;

export function draw(p, t, o) {
  const C = fit(o.palette, 11), G = fit(o.grid, 6), ph = t / meta.duration, s = o.seed;
  const SKY = [C[0], C[1], C[2], C[3], C[4], C[5]];
  const SUN = [C[5], C[6], C[7], C[8], C[9], C[10]];
  const FLOOR = hex("#0a0418"), FLOOR2 = hex("#140828");
  const MTN_FAR = hex("#2a0d4a"), MTN_NEAR = hex("#160628"), RIM = C[6], RIM2 = C[8];

  // ---- sky: hard dithered bands from deep night at the top to magenta haze at the horizon
  p.shade(0, 0, W - 1, HZ, (x, y) => {
    const v = Math.pow(y / HZ, 1.6);
    return dstep(SKY, v, x, y);
  });

  // ---- stars: a fixed seeded field, each twinkling at its own whole number of beats per loop
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand(i, 1, s) * W), y = Math.floor(Math.pow(rand(i, 2, s), 1.5) * (HZ - 30));
    const beats = 1 + Math.floor(rand(i, 3, s) * 3), off = rand(i, 4, s);
    const tw = 0.5 + 0.5 * Math.sin((ph * beats + off) * TAU);
    const big = rand(i, 5, s) < 0.1;
    const dim = 1 - y / HZ;
    if (big) {
      const c = tw > 0.6 ? WHITE : C[9];
      p.px(x, y, c);
      if (tw > 0.35) { p.px(x - 1, y, C[7]); p.px(x + 1, y, C[7]); p.px(x, y - 1, C[7]); p.px(x, y + 1, C[7]); }
      if (tw > 0.8) { p.px(x - 2, y, C[5]); p.px(x + 2, y, C[5]); p.px(x, y - 2, C[5]); p.px(x, y + 2, C[5]); }
      p.light(x, y, C[9], 0.5 * tw);
      p.glow(x, y, 5, C[7], 0.12 * tw);
    } else if (tw > 0.25 + 0.4 * (1 - dim)) {
      p.px(x, y, tw > 0.75 ? C[10] : tw > 0.5 ? C[8] : C[5]);
    }
  }

  // ---- a meteor once a loop: white head, a gold-to-rose dotted trail, a glint where it burns out
  {
    const t0 = 0.18, t1 = 0.34, u = (ph - t0) / (t1 - t0);
    if (u > 0 && u < 1) {
      const x0 = 250, y0 = 8, dx = -150, dy = 46, e = 1 - Math.pow(1 - u, 2);
      const hx = x0 + dx * e, hy = y0 + dy * e, L = 34 * Math.sin(u * Math.PI) + 4;
      const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
      for (let d = 0; d < L; d += 1) {
        const k = 1 - d / L, x = hx - ux * d, y = hy - uy * d;
        if (d > 2 && bayer(x, y) > k * 1.1) continue;
        p.px(x, y, k > 0.85 ? WHITE : k > 0.55 ? C[9] : k > 0.3 ? C[7] : C[5]);
      }
      p.px(hx, hy, WHITE);
      p.glow(hx, hy, 9, C[9], 0.5 * Math.sin(u * Math.PI));
      if (u > 0.82) {
        const g = Math.round(3 * Math.sin(((u - 0.82) / 0.18) * Math.PI));
        for (let d = 1; d <= g; d++) { p.px(hx + d, hy, C[10]); p.px(hx - d, hy, C[10]); p.px(hx, hy + d, C[10]); p.px(hx, hy - d, C[10]); }
      }
    }
  }

  // ---- the sun: hot white-gold top cooling to rose, cut by bands that slide down and thicken
  p.glow(CX, SUN_Y, 90, C[6], 0.22);
  p.glow(CX, SUN_Y, 52, C[8], 0.2);
  const cut = (y) => {
    // bands below the sun's equator; they scroll down one band spacing per loop (seamless)
    const rel = y - (SUN_Y - 6);
    if (rel < 0) return false;
    const sp = 7, pos = rel + ph * sp, k = pos % sp, thick = 0.6 + rel * 0.075;
    return k < thick;
  };
  p.shade(CX - SUN_R - 1, SUN_Y - SUN_R - 1, CX + SUN_R + 1, HZ, (x, y, out) => {
    const dx = x - CX, dy = y - SUN_Y, d = Math.hypot(dx, dy);
    if (d > SUN_R || y >= HZ) return;
    if (cut(y)) return;
    const v = 1 - (y - (SUN_Y - SUN_R)) / (2 * SUN_R);
    // a lit rim on the upper left, a darker rim lower right
    const rim = d > SUN_R - 1.2;
    let c = dstep(SUN, clamp(v * 1.15 - 0.05), x, y);
    if (rim && dy < 0 && dx < 8) c = mix(c, WHITE, 0.5);
    return c;
  });

  // ---- mountains: two ranges from tileable noise, the far one lit along its ridge by the sun
  const ridge = (x, sc, amp, base, seed) => {
    let h = 0, f = 1, a = 1;
    for (let k = 0; k < 4; k++) { h += a * tileNoise((x / W) * sc * f, 0, sc * f, 0, seed + k); f *= 2; a *= 0.5; }
    return base - amp * Math.pow(Math.max(0, h), 1.4);
  };
  for (let x = 0; x < W; x++) {
    const far = Math.round(ridge(x + 0.5, 5, 30, HZ, s + 11));
    const near = Math.round(ridge(x + 0.5, 3, 24, HZ, s + 37) + 4);
    const sunSide = 1 - Math.min(1, Math.abs(x - CX) / 150);
    for (let y = far; y < HZ; y++) {
      if (y >= near) break;
      const top = y - far;
      let c = MTN_FAR;
      if (top === 0) c = sunSide > 0.3 ? RIM2 : RIM;
      else if (top === 1 && sunSide > 0.5) c = RIM;
      else if (top < 6 && bayer(x, y) < (1 - top / 6) * 0.5 * sunSide) c = C[4];
      p.px(x, y, c);
    }
    if (sunSide > 0.2) p.light(x, far, C[7], 0.35 * sunSide);
    for (let y = near; y < HZ; y++) {
      const top = y - near;
      p.px(x, y, top === 0 ? C[4] : top < 3 && bayer(x, y) < 0.35 ? C[3] : MTN_NEAR);
    }
  }

  // ---- the floor: dark glassy base, the sun's reflection broken into scan streaks
  const CAM = 60, SPEED = 3, COLS = 3.2; // three grid rows per loop: seamless
  p.shade(0, HZ + 1, W - 1, H - 1, (x, y, out) => {
    const dy = Math.floor(y) - HZ;
    let c = FLOOR;
    if (dy < 14 && bayer(x, y) < (1 - dy / 14) * 0.55) c = FLOOR2;
    const rx = Math.abs(x - CX), wob = Math.sin(dy * 0.55 - ph * TAU * 3);
    const half = (32 - dy * 0.3) * (0.72 + 0.28 * wob);
    if (rx < half && dy % 2 === 1 && dy < 56) {
      const k = 1 - rx / half, f = 1 - dy / 56;
      c = k > 0.75 && dy < 12 ? C[8] : k > 0.4 && f > 0.35 ? C[6] : C[4];
      out.l = C[7]; out.k = 0.14 * k * f;
    }
    return c;
  });
  // columns: straight 1 px lines from the vanishing point, dithering in where they crowd together
  for (let k = -26; k <= 26; k++) {
    const dyEnd = H - HZ, x1 = CX + (k * dyEnd) / COLS;
    // clip to the screen edge so the fade runs along the visible part
    let dyB = dyEnd, xB = x1;
    if (x1 < 0 || x1 > W - 1) { xB = x1 < 0 ? 0 : W - 1; dyB = ((xB - CX) * COLS) / k; }
    const dyA = Math.abs(k) < 1 ? 3 : 7 + Math.abs(k) * 0.55;
    if (dyB <= dyA) continue;
    const xA = CX + (k * dyA) / COLS;
    const depth = (u) => dyA + (dyB - dyA) * u;
    const near = (u) => clamp((depth(u) - 4) / 55);
    const fadeIn = 9 + Math.abs(k) * 0.9;
    p.line(xA, HZ + dyA, xB, HZ + dyB,
      (u) => (near(u) > 0.6 ? G[4] : near(u) > 0.38 && Math.abs(k) < 12 ? G[3] : G[2]),
      1);
    void fadeIn;
    p.glowLine(CX + (k * 20) / COLS, HZ + 20, xB, HZ + dyB, 2.5, G[3], 0.1);
  }
  // rows: a horizontal line wherever the scrolling world depth is whole
  const fr = ((ph * SPEED) % 1);
  for (let m = 0; m < 40; m++) {
    const z = m + 1 - fr;
    if (z < 0.5) continue;
    const dy = CAM / z;
    if (HZ + dy > H - 1) continue;
    const gap = CAM / z - CAM / (z + 1), vis = gap >= 2.6 ? 1 : 0;
    if (vis <= 0.02) break;
    const y = Math.round(HZ + dy), near = clamp((dy - 4) / 55);
    const c = near > 0.6 ? G[4] : near > 0.22 ? G[3] : G[2];
    for (let x = 0; x < W; x++) {
      if (vis < 1 && bayer(x, y) > vis) continue;
      const g = p.get(x, y);
      p.px(x, y, g === G[3] || g === G[4] || g === G[2] ? G[5] : c);
    }
    p.glowLine(0, y, W, y, 2 + 3 * near, G[3], (0.1 + 0.25 * near) * vis);
  }

  // ---- horizon: a white-hot line with a magenta halo
  for (let x = 0; x < W; x++) {
    const k = 1 - Math.min(1, Math.abs(x - CX) / 170);
    p.px(x, HZ, k > 0.55 ? C[10] : k > 0.25 ? G[4] : G[3]);
  }
  p.glowLine(0, HZ, W, HZ, 6, G[3], 0.35);
  p.glowLine(CX - 70, HZ, CX + 70, HZ, 4, C[9], 0.3);

  // ---- motes drifting up off the horizon, seamless
  for (let i = 0; i < 26; i++) {
    const per = 1, off = rand(i, 21, s), u = (((ph * per + off) % 1) + 1) % 1;
    const x0 = rand(i, 22, s) * W, sway = Math.sin((u * 2 + rand(i, 23, s)) * TAU) * 3;
    const x = x0 + sway, y = HZ - 2 - u * 70;
    const k = Math.sin(u * Math.PI);
    if (k < 0.15) continue;
    p.px(x, y, k > 0.7 ? C[9] : C[6]);
    p.light(x, y, C[7], 0.4 * k);
  }
}
