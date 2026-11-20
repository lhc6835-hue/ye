// A CRT switching on over whatever is behind it: a dot, a white-hot line, the line opening into the
// picture with bright edges, a wash of white settling, a scan bar rolling down. Ends fully transparent.
import { clamp, seg, ease, rand, WHITE, hex, mix } from "../../core/index.js";
import { bayer } from "./_lib.js";

export const meta = {
  name: "CRT power on",
  desc: "Over a dark screen a white dot sparks, stretches into a glowing scan line, then the line splits and opens into the picture with white-hot edges, a white wash cools off it and one bright bar rolls down before it settles.",
  tags: ["arcade", "transition", "crt", "tv", "power", "screen"],
  size: [320, 180],
  origin: [0, 0],
  duration: 1.0,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: ["#000000", "#0a0614", "#3a1a5c", "#7ad8ff", "#e8f8ff", "#ffffff"], tint: "#f53cd1", seed: 2 },
};

const W = 320, H = 180, CX = 160, CY = 90;

export function draw(p, t, o) {
  const BLACK = hex(o.palette[0]), DEEP = hex(o.palette[1]), MID = hex(o.palette[2]), CYAN = hex(o.palette[3]),
    PALE = hex(o.palette[4]), TINT = hex(o.tint);

  // phases
  const dot = seg(t, 0.0, 0.12), line = seg(t, 0.1, 0.28), open = seg(t, 0.28, 0.52), wash = seg(t, 0.3, 0.62), roll = seg(t, 0.5, 0.95);

  // ---- line width and opening height
  const hw = t < 0.1 ? 0 : (W / 2 + 2) * ease.outExpo(line);
  const hh = t < 0.28 ? 0.6 : 0.6 + (H / 2) * ease.outQuart(open);

  // ---- black around the opening (the off picture)
  if (open < 1) {
    p.shade(0, 0, W - 1, H - 1, (x, y) => {
      const inX = Math.abs(x - CX) <= hw, inY = Math.abs(y - CY) <= hh;
      if (inX && inY) return;
      // a faint phosphor afterglow just outside the line
      const dy = Math.abs(y - CY) - hh;
      if (t > 0.1 && dy < 3 && inX && bayer(x, y) < (1 - dy / 3) * 0.4) return DEEP;
      return BLACK;
    });
  }

  // ---- the dot: sparks to life at the center
  if (t < 0.16) {
    const k = ease.outBack(clamp(dot * 1.3)), r = 1 + 2.5 * k * (1 - seg(t, 0.12, 0.16));
    p.circle(CX, CY, r, WHITE);
    p.glow(CX, CY, 14 + 10 * k, CYAN, 0.8);
    p.px(CX - r - 2, CY, PALE); p.px(CX + r + 2, CY, PALE); p.px(CX, CY - r - 2, PALE); p.px(CX, CY + r + 2, PALE);
  }

  // ---- the line: white-hot core, cyan glow, tinted ends
  if (t >= 0.1 && open < 1) {
    const th = Math.max(1, hh * 2);
    if (t < 0.28) {
      p.rect(CX - hw, CY - 1, hw * 2, 2, WHITE);
      p.px(CX - hw - 1, CY - 1, TINT); p.px(CX + hw, CY - 1, TINT);
      p.glowLine(CX - hw, CY, CX + hw, CY, 10, CYAN, 0.7);
      p.glowLine(CX - hw * 0.6, CY, CX + hw * 0.6, CY, 4, WHITE, 0.5);
    } else {
      // the opening's two edges: white lines that cool as they separate
      const k = 1 - open, c = k > 0.6 ? WHITE : k > 0.3 ? PALE : CYAN;
      for (const e of [-1, 1]) {
        const y = CY + e * hh;
        p.line(0, y, W - 1, y, c);
        p.glowLine(0, y, W, y, 6, CYAN, 0.5 * k);
      }
      void th;
    }
  }

  // ---- the white wash: a flash in the fresh opening that cools fast, solid only for a frame or two
  if (t >= 0.28 && wash < 1) {
    const k = 1 - ease.outCubic(wash);
    p.shade(0, Math.max(0, CY - hh), W - 1, Math.min(H - 1, CY + hh), (x, y, out) => {
      const v = k * (1 - Math.abs(y - CY) / (H * 0.62));
      if (v <= 0.03) return;
      out.l = CYAN; out.k = 0.3 * v;
      if ((Math.floor(y) & 1) === 0 && v > 0.35) { out.a = Math.min(0.85, (v - 0.35) * 1.6); return v > 0.75 ? WHITE : PALE; }
    });
  }

  // ---- a bright scan bar rolling down once
  if (roll > 0 && roll < 1) {
    const y0 = -16 + (H + 32) * ease.inOutQuad(roll), f = Math.sin(roll * Math.PI);
    p.shade(0, Math.max(0, y0 - 10), W - 1, Math.min(H - 1, y0 + 10), (x, y, out) => {
      const d = Math.abs(y - y0) / 10;
      if (d > 1) return;
      out.l = PALE; out.k = 0.18 * (1 - d) * f;
      if (d < 0.15 && bayer(x, y) < 0.5 * f) { out.a = 0.5; return PALE; }
    });
  }

  // ---- a little colour fringing on the edges while the picture is fresh
  if (open > 0 && wash < 0.6) {
    const k = 1 - wash / 0.6;
    for (let y = 0; y < H; y += 2) {
      if (Math.abs(y - CY) > hh) continue;
      if (rand(y, Math.floor(t * 30), o.seed) < 0.5) continue;
      p.dot(0, y, TINT, 0.6 * k); p.dot(W - 1, y, CYAN, 0.6 * k);
    }
  }
  void MID; void mix;
}
