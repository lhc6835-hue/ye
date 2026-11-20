// DEV badge: a warning beacon on a hazard-striped base, its lamp turning and throwing beams.
import { fit, rand, clamp, TAU, WHITE, hex } from "../../core/index.js";
import { shape, INK } from "./_lib.js";

export const meta = {
  name: "Badge dev",
  desc: "An amber warning beacon on a hazard-striped base: the lamp inside the glass dome turns, its beam swings round and flares out both sides each time it faces us.",
  tags: ["arcade", "badge", "beacon", "dev", "wip", "warning", "icon", "loop"],
  size: [32, 32], origin: [16, 17], duration: 1.2, loop: true, fps: 30, bg: "dark",
  options: { palette: ["#2a0e04", "#5e2208", "#a0420c", "#e07214", "#ffa026", "#ffd066", "#fff2c4", "#ffffff"], metal: ["#14121c", "#2a2638", "#4a4660", "#7a7690"], stripe: "#ffd23c", seed: 1 },
};

export function draw(p, t, o) {
  const C = fit(o.palette, 8), M = fit(o.metal, 4), ST = hex(o.stripe), ph = t / meta.duration;
  const a = ph * TAU, face = Math.cos(a), bx = Math.sin(a) * 6; // the lamp's beam: x on the dome, and how much it faces us
  // beams out to both sides when it faces us
  if (face > 0.2) {
    const k = (face - 0.2) / 0.8, dir = Math.sign(bx) || 1;
    for (let i = 0; i < 2; i++) {
      const sd = i ? dir : -dir, len = 7 + 8 * k;
      p.shade(sd > 0 ? 6 : -6 - len, -9, sd > 0 ? 6 + len : -6, 3, (x, y, out) => {
        const dx = Math.abs(x) - 6, spread = 1.5 + dx * 0.5;
        if (Math.abs(y + 3) > spread) return;
        out.l = C[5]; out.k = 0.4 * k * (1 - dx / len);
        if (Math.abs(y + 3) < 0.7 && dx < len * 0.7 && i === 0) { out.a = 0.7 * k; return C[6]; }
      });
    }
  }
  p.glow(0, -3, 16, C[4], 0.25 + 0.4 * Math.max(0, face));
  shape(p, -11, -11, 11, 11, (x, y) => {
    // base: dark metal block with yellow-black hazard stripes
    if (y >= 4 && y < 10 && Math.abs(x) <= 10) {
      if (y < 5) return M[3];
      if (y >= 9) return M[0];
      const st = ((Math.floor(x + y + 40) % 6) + 6) % 6 < 3;
      return st ? (x < 0 ? ST : hex("#c8a020")) : M[1];
    }
    if (y >= 2 && y < 4 && Math.abs(x) <= 8) return y < 3 ? M[3] : M[2];
    // glass dome
    const d = Math.hypot(x, (y - 2) * 1.1);
    if (y < 2 && d <= 7.5) {
      if (d > 6.4) return x < -1 && y < -2 ? C[6] : C[3];          // the rim of the glass
      const near = Math.abs(x - bx);
      if (face > 0 && near < 1.6) return face > 0.7 ? WHITE : C[6];  // the lamp's hot face
      if (near < 3) return C[5];
      if (x < -3 && y < -3) return C[5];                            // highlight on the glass
      return y < -3 ? C[4] : C[3];
    }
    // little cap on top
    if (y >= -9 && y < -7 && Math.abs(x) <= 1.5) return M[3];
    return 0;
  }, INK);
  p.light(bx, -2, WHITE, 0.4 * Math.max(0, face));
}
