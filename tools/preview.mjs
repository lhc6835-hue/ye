// Renders the hand-drawn sprites, every pose in every coat, to a zoomed PNG to look at and refine.
// node tools/preview.mjs [out.png]
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createFrame, clearFrame, painterFor, composite, hex } from "../vendor/pixelfx/core/index.js";
import { encodePNG } from "./png.mjs";
import * as S from "../src/sprites.js";

const poses = [...S.GLIDE, ...S.DIVE], coats = Object.keys(S.COATS);
const pad = 4, cw = S.CAT_W + pad * 2, ch = S.CAT_H + pad * 2;
const W = cw * poses.length, H = ch * coats.length, Z = 8;
const frame = createFrame(W, H);
clearFrame(frame);
const p = painterFor(frame);
coats.forEach((coat, j) =>
  poses.forEach((s, i) => {
    for (const row of s) if (row.length !== S.CAT_W) throw new Error(`pose ${i}: row "${row}" is ${row.length} wide`);
    p.sprite(s, S.palette(coat), i * cw + pad, j * ch + pad);
  }),
);
const small = new Uint8ClampedArray(W * H * 4);
composite(frame, small, hex("#948568"));
const big = new Uint8ClampedArray(W * Z * H * Z * 4);
for (let y = 0; y < H * Z; y++)
  for (let x = 0; x < W * Z; x++) {
    const s = ((y / Z) | 0) * W + ((x / Z) | 0), d = y * W * Z + x;
    for (let c = 0; c < 4; c++) big[d * 4 + c] = small[s * 4 + c];
  }
const out = process.argv[2] ?? "records/sprites.png";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePNG(W * Z, H * Z, big));
console.log(out);
