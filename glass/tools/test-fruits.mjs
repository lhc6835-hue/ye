// Cuts every fruit shape many times at random and checks each piece stays a closed mesh with its volume kept.
import { FRUITS, prepare } from "../src/fruits.js";
import { solidFromGeometry, sliceSolid, solidMass } from "../src/slicer.js";

function openEdges(s) {
  const q = (x) => Math.round(x * 1e6);
  const key = (k) => `${q(s.pos[k * 3])},${q(s.pos[k * 3 + 1])},${q(s.pos[k * 3 + 2])}`;
  const edges = new Map();
  for (let t = 0; t < s.mat.length; t++) for (let i = 0; i < 3; i++) {
    const a = key(t * 3 + i), b = key(t * 3 + ((i + 1) % 3));
    if (a === b) continue;
    edges.set(a + ">" + b, (edges.get(a + ">" + b) || 0) + 1);
  }
  let bad = 0;
  for (const [k, n] of edges) { const [a, b] = k.split(">"); if ((edges.get(b + ">" + a) || 0) !== n) bad++; }
  return bad;
}
let fails = 0;
for (const def of FRUITS) {
  prepare(def);
  const s0 = solidFromGeometry(def.geometry);
  const v0 = solidMass(s0).volume;
  let pieces = [s0], worst = 0, open0 = openEdges(s0), ms = 0, cuts = 0;
  for (let round = 0; round < 4; round++) {
    const next = [];
    for (const p of pieces) {
      const m = solidMass(p);
      const n = { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };
      const l = Math.hypot(n.x, n.y, n.z); n.x /= l; n.y /= l; n.z /= l;
      const c = n.x * m.cx + n.y * m.cy + n.z * m.cz + (Math.random() - 0.5) * m.radius * 0.6;
      const t = performance.now();
      const r = sliceSolid(p, n, c);
      ms += performance.now() - t; cuts++;
      if (!r) { next.push(p); continue; }
      next.push(r.a, r.b);
    }
    pieces = next;
  }
  const vs = pieces.map((p) => solidMass(p).volume);
  const sum = vs.reduce((a, b) => a + b, 0);
  const open = pieces.map(openEdges).reduce((a, b) => a + b, 0);
  const err = Math.abs(sum - v0) / v0;
  const neg = vs.filter((v) => v <= 0).length;
  const ok = open0 === 0 && open === 0 && err < 1e-3 && neg === 0;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${def.id.padEnd(11)} tris ${String(s0.mat.length).padStart(5)}  pieces ${String(pieces.length).padStart(2)}  vol err ${(err * 100).toFixed(4)}%  open ${open0}/${open}  neg ${neg}  avg slice ${(ms / cuts).toFixed(1)} ms`);
}
process.exit(fails ? 1 : 0);
