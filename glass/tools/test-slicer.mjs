// Checks that slicing a closed mesh gives two closed meshes whose volumes add up.
import { IcosahedronGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { solidFromGeometry, sliceSolid, solidMass } from "../src/slicer.js";

function closed(s) {
  const q = (x) => Math.round(x * 1e6);
  const key = (k) => `${q(s.pos[k * 3])},${q(s.pos[k * 3 + 1])},${q(s.pos[k * 3 + 2])}`;
  const edges = new Map();
  for (let t = 0; t < s.mat.length; t++) for (let i = 0; i < 3; i++) {
    const a = key(t * 3 + i), b = key(t * 3 + ((i + 1) % 3));
    if (a === b) continue;
    const k = a + ">" + b;
    edges.set(k, (edges.get(k) || 0) + 1);
  }
  let bad = 0;
  for (const [k, n] of edges) { const [a, b] = k.split(">"); if ((edges.get(b + ">" + a) || 0) !== n) bad++; }
  return bad;
}
let s = solidFromGeometry(mergeVertices(new IcosahedronGeometry(0.04, 12)));
const v0 = solidMass(s).volume;
console.log("tris", s.mat.length, "vol", v0.toExponential(4), "open edges", closed(s));
let pieces = [s];
const t0 = performance.now();
for (let i = 0; i < 6; i++) {
  const n = { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };
  const l = Math.hypot(n.x, n.y, n.z); n.x /= l; n.y /= l; n.z /= l;
  const next = [];
  for (const p of pieces) {
    const t1 = performance.now();
    const r = sliceSolid(p, n, (Math.random() - 0.5) * 0.02);
    if (!r) { next.push(p); continue; }
    next.push(r.a, r.b);
    if (i === 0) console.log("slice ms", (performance.now() - t1).toFixed(1), "loops", r.loops.length);
  }
  pieces = next;
}
const vs = pieces.map((p) => solidMass(p).volume);
console.log("pieces", pieces.length, "sum vol", vs.reduce((a, b) => a + b).toExponential(4), "min", Math.min(...vs).toExponential(2), "open edges", pieces.map(closed).reduce((a, b) => a + b), "total ms", (performance.now() - t0).toFixed(0));
