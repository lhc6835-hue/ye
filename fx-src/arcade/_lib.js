// Shared bits for the arcade hub effects: an ordered-dither threshold and a few tiny helpers.
import { hex } from "../../core/index.js";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 4x4 Bayer threshold (0..1) at a pixel center. */
export const bayer = (x, y) => (BAYER[((Math.floor(y) & 3) << 2) | (Math.floor(x) & 3)] + 0.5) / 16;

/** Pick a step of a ramp from a 0..1 value with dithered boundaries (hard pixel-art bands). */
export function dstep(R, v, x, y) {
  const f = Math.max(0, Math.min(0.9999, v)) * (R.length - 1);
  const i = Math.floor(f), u = f - i;
  return R[Math.min(R.length - 1, i + (u > bayer(x, y) ? 1 : 0))];
}

export const INK = hex("#0a0614");

/**
 * Fill a shape given as a color function over a box, with a 1 px ink outline around it.
 * fn(x, y) returns a color or 0 at pixel centers (local space, unrotated). rot rotates the shape about (cx, cy).
 */
export function shape(p, x0, y0, x1, y1, fn, ink = INK, rot = 0, cx = 0, cy = 0) {
  const ca = Math.cos(-rot), sa = Math.sin(-rot);
  const at = (x, y) => {
    if (!rot) return fn(x, y);
    const dx = x - cx, dy = y - cy;
    return fn(cx + dx * ca - dy * sa, cy + dx * sa + dy * ca);
  };
  const R = rot ? Math.hypot(Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy))) : 0;
  const bx0 = rot ? cx - R : x0, bx1 = rot ? cx + R : x1, by0 = rot ? cy - R : y0, by1 = rot ? cy + R : y1;
  p.shade(bx0 - 1, by0 - 1, bx1 + 1, by1 + 1, (x, y) => {
    const c = at(x, y);
    if (c) return c;
    if (ink && (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1))) return ink;
  });
}

/** A 4-arm star glint of arm length n. */
export function glint(p, x, y, n, c, tip, k = 0.4) {
  n = Math.round(n);
  if (n < 1) return;
  p.px(x, y, c);
  for (let d = 1; d <= n; d++) {
    const cc = d === n && n > 1 ? tip : c;
    p.px(x + d, y, cc); p.px(x - d, y, cc); p.px(x, y + d, cc); p.px(x, y - d, cc);
  }
  if (n > 2) { p.px(x + 1, y + 1, tip); p.px(x - 1, y - 1, tip); p.px(x + 1, y - 1, tip); p.px(x - 1, y + 1, tip); }
  p.glow(x, y, n * 3 + 2, c, k);
}
