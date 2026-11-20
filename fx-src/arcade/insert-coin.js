// A token flips down into a coin slot: it spins on the way, clacks into the slot, the slot flashes
// and a fan of sparks and a "+1" pop out of it.
import { fit, clamp, seg, ease, rand, fly, flyV, TAU, WHITE, hex, mix } from "../../core/index.js";
import { shape, glint, INK } from "./_lib.js";

export const meta = {
  name: "Insert coin",
  desc: "A gold token tumbles down spinning on its edge, drops into a slot with a clack, the slot flashes white, sparks fan up and a +1 credit pops and floats away.",
  tags: ["arcade", "coin", "credit", "ui", "pickup"],
  size: [96, 144],
  origin: [48, 116],
  duration: 1.5,
  loop: false,
  fps: 30,
  bg: "dark",
  options: {
    palette: ["#2a1604", "#5e3208", "#a05c0c", "#e09414", "#ffc626", "#ffe866", "#fff8c4", "#ffffff"],
    accent: ["#3d0a33", "#b0228f", "#f53cd1", "#ff86e6", "#ffd2f6"],
    seed: 3,
  },
};

const DROP = 0.42, R = 9, SLOT_W = 14;

function token(p, C, x, y, spin) {
  // spin: 0..1 around the vertical axis; the face narrows to its rim and shows the other side
  const c = Math.cos(spin * TAU), wx = Math.max(0.12, Math.abs(c)), front = c > 0, thick = 2;
  const edgeSide = Math.sign(Math.sin(spin * TAU)) || 1;
  shape(p, x - R - thick, y - R, x + R + thick, y + R, (px, py) => {
    const dy = py - y, rr = R * R - dy * dy;
    if (rr < 0) return 0;
    const half = Math.sqrt(rr) * wx, dx = px - x;
    // the reeded rim shows as a band beside the face when it turns edge-on
    const ex = dx - edgeSide * thick * (1 - wx);
    if (Math.abs(dx) <= half + 0.01) {
      const u = dx / Math.max(0.5, half), v = dy / R, d = Math.hypot(u, v);
      if (d > 0.82) return u - v < -0.4 ? C[6] : u - v > 0.9 ? C[2] : C[4];      // rim, lit top left
      if (d > 0.66) return u - v < 0 ? C[3] : C[2];                               // groove
      // the embossed mark: a diamond on the front, a ring on the back
      const mark = front ? Math.abs(u) + Math.abs(v) < 0.42 : Math.abs(d - 0.32) < 0.1;
      if (mark) return u + v < 0 ? C[6] : C[3];
      return u - v < -0.2 ? C[5] : C[4];
    }
    if (Math.abs(ex) <= half + thick && Math.sign(dx) === edgeSide) return (Math.floor(py) & 1) ? C[2] : C[3];
    return 0;
  }, INK);
}

export function draw(p, t, o) {
  const C = fit(o.palette, 8), A = fit(o.accent, 5), s = o.seed;

  // ---- the fall: in from above, accelerating, spinning faster as it drops
  if (t < DROP + 0.08) {
    const u = clamp(t / DROP), e = ease.inQuad(u);
    const y = -112 + 112 * e - R, x = Math.sin(u * 2.2) * 3;
    const spin = u * 2.6;
    if (t < DROP) {
      // a speed trail of faint gold ticks above it
      for (let i = 1; i < 5; i++) {
        const ty = y - i * 4 * u - R;
        if (u > 0.3) p.px(x + ((i & 1) ? -3 : 3), ty, i < 3 ? C[4] : C[2]);
      }
      token(p, C, x, y, spin);
      p.glow(x, y, 16, C[4], 0.25);
    } else {
      // half swallowed by the slot for a couple of frames: only its top shows
      const k = seg(t, DROP, DROP + 0.08);
      p.rect(-SLOT_W / 2 + 2, -2 - (1 - k) * 6, SLOT_W - 4, (1 - k) * 6, C[4]);
    }
  }

  // ---- the slot: a dark mouth with a lit lip, flashing on the hit
  const hit = t - DROP;
  const flash = hit >= 0 ? Math.exp(-hit * 9) : 0;
  // (the slot itself belongs to the page; only its lip flashes here)
  if (flash > 0.04) {
    p.rect(-SLOT_W / 2, -1, SLOT_W, 2, flash > 0.3 ? WHITE : A[3], Math.min(1, flash * 2));
    p.line(-SLOT_W / 2 - 1, -3, SLOT_W / 2, -3, flash > 0.15 ? A[4] : A[2], Math.min(1, flash * 2));
    p.glowLine(-SLOT_W / 2, 0, SLOT_W / 2, 0, 5 + 10 * flash, A[2], 0.8 * flash);
  }

  if (hit < 0) return;

  // ---- hero frame: a white bar bursting out of the slot
  if (hit < 0.07) {
    const w = 18 + hit * 300;
    p.rect(-w / 2, -2, w, 3, WHITE);
    p.glow(0, -2, 40, A[3], 0.7);
  }

  // ---- shock rings: two flat ellipses rolling out of the slot
  for (let i = 0; i < 2; i++) {
    const a = hit - i * 0.07;
    if (a < 0 || a > 0.4) continue;
    const k = ease.outQuart(a / 0.4), rx = 8 + 34 * k, ry = 2 + 6 * k, f = 1 - a / 0.4;
    for (let g = 0; g < TAU; g += 0.04) {
      const x = Math.cos(g) * rx, y = Math.sin(g) * ry - 1;
      if (Math.sin(g) > 0.2 && f < 0.5) continue;
      p.dot(x, y, f > 0.6 ? WHITE : i ? A[2] : A[3], f * 1.4);
    }
  }

  // ---- sparks: a fan thrown upward, stretched with speed, falling back
  for (let i = 0; i < 18; i++) {
    const delay = rand(i, 1, s) * 0.06, a0 = hit - delay;
    const life = 0.35 + rand(i, 2, s) * 0.4;
    if (a0 < 0 || a0 > life) continue;
    const ang = -Math.PI / 2 + (rand(i, 3, s) - 0.5) * 2.2, sp = 90 + rand(i, 4, s) * 120;
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    const [x, y] = fly((rand(i, 5, s) - 0.5) * SLOT_W, -2, vx, vy, a0, 420, 2.5);
    const [ux, uy] = flyV(vx, vy, a0, 420, 2.5), sl = Math.hypot(ux, uy) || 1, L = Math.min(5, sl / 40);
    const k = 1 - a0 / life;
    const c = k > 0.7 ? WHITE : i % 3 === 0 ? A[3] : k > 0.35 ? C[5] : C[3];
    p.line(x, y, x - (ux / sl) * L, y - (uy / sl) * L, (u) => (u < 0.4 ? c : i % 3 === 0 ? A[2] : C[2]));
    p.light(x, y, i % 3 === 0 ? A[3] : C[5], 0.6 * k);
  }

  // ---- +1: pops up with an overshoot, hangs, blinks out
  {
    const a = hit - 0.05;
    if (a > 0 && a < 0.95) {
      const pop = ease.outBack(clamp(a / 0.22)), y = -18 - 22 * pop - a * 6;
      const blink = a > 0.7 && Math.floor(a * 20) % 2 === 0;
      if (!blink) {
        p.text("+1", 1, y, (gx, gy) => (gy < 3 ? WHITE : C[5]), { font: "big", scale: 2, align: "center", outline: INK, shadow: A[1] });
        p.glow(0, y + 7, 18, C[5], 0.3 * (1 - a));
      }
    }
  }

  // ---- glints left hanging in the air
  for (let i = 0; i < 5; i++) {
    const a = hit - 0.12 - i * 0.09;
    if (a < 0 || a > 0.32) continue;
    const k = Math.sin((a / 0.32) * Math.PI);
    const x = (rand(i, 8, s) - 0.5) * 50, y = -10 - rand(i, 9, s) * 46;
    glint(p, x, y, 1 + 2 * k, i & 1 ? WHITE : C[6], i & 1 ? A[3] : C[4], 0.3 * k);
  }

  // ---- after-glow in the slot, fading
  p.glow(0, -1, 22, C[4], 0.35 * Math.exp(-hit * 4));
}
