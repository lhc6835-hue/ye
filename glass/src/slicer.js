// Cuts a closed triangle mesh with a plane into two closed meshes and caps both cut faces.
//
// A "solid" is a plain triangle soup: per corner a position, normal, colour and uv, and per triangle a
// material slot (0 = skin, 1 = cut face). Every piece stays in the original fruit's local frame, so the
// interior shaders that read object-space position keep lining up after any number of cuts.
import { BufferGeometry, BufferAttribute, ShapeUtils, Vector2 } from "three";

const STRIDE = 11; // px py pz nx ny nz r g b u v

export function solidFromGeometry(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const pos = new Float32Array(g.attributes.position.array);
  const nor = new Float32Array(g.attributes.normal.array);
  const col = g.attributes.color ? new Float32Array(g.attributes.color.array) : new Float32Array(n * 3).fill(1);
  const uv = g.attributes.uv ? new Float32Array(g.attributes.uv.array) : new Float32Array(n * 2);
  return { pos, nor, col, uv, mat: new Uint8Array(n / 3) };
}

export function geometryFromSolid(s) {
  const tris = s.mat.length;
  const order = [];
  const counts = [0, 0];
  for (let t = 0; t < tris; t++) counts[s.mat[t]]++;
  for (let m = 0; m < 2; m++) for (let t = 0; t < tris; t++) if (s.mat[t] === m) order.push(t);
  const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9), uv = new Float32Array(tris * 6);
  order.forEach((t, i) => {
    pos.set(s.pos.subarray(t * 9, t * 9 + 9), i * 9);
    nor.set(s.nor.subarray(t * 9, t * 9 + 9), i * 9);
    col.set(s.col.subarray(t * 9, t * 9 + 9), i * 9);
    uv.set(s.uv.subarray(t * 6, t * 6 + 6), i * 6);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nor, 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  if (counts[0]) g.addGroup(0, counts[0] * 3, 0);
  if (counts[1]) g.addGroup(counts[0] * 3, counts[1] * 3, 1);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Volume and centroid by summing signed tetrahedra against the origin. */
export function solidMass(s) {
  const p = s.pos;
  let v = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2], bx = p[i + 3], by = p[i + 4], bz = p[i + 5], qx = p[i + 6], qy = p[i + 7], qz = p[i + 8];
    const d = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    v += d;
    cx += d * (ax + bx + qx) / 4;
    cy += d * (ay + by + qy) / 4;
    cz += d * (az + bz + qz) / 4;
  }
  if (Math.abs(v) < 1e-12) return { volume: 0, cx: 0, cy: 0, cz: 0, radius: 0 };
  cx /= v; cy /= v; cz /= v;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  return { volume: v, cx, cy, cz, radius: Math.sqrt(r2) };
}

class Builder {
  constructor() {
    this.v = []; // STRIDE floats per corner
    this.m = [];
  }
  tri(a, b, c, mat) {
    this.v.push(...a, ...b, ...c);
    this.m.push(mat);
  }
  solid() {
    const tris = this.m.length;
    const pos = new Float32Array(tris * 9), nor = new Float32Array(tris * 9), col = new Float32Array(tris * 9), uv = new Float32Array(tris * 6);
    const v = this.v;
    for (let k = 0; k < tris * 3; k++) {
      const o = k * STRIDE;
      pos[k * 3] = v[o]; pos[k * 3 + 1] = v[o + 1]; pos[k * 3 + 2] = v[o + 2];
      nor[k * 3] = v[o + 3]; nor[k * 3 + 1] = v[o + 4]; nor[k * 3 + 2] = v[o + 5];
      col[k * 3] = v[o + 6]; col[k * 3 + 1] = v[o + 7]; col[k * 3 + 2] = v[o + 8];
      uv[k * 2] = v[o + 9]; uv[k * 2 + 1] = v[o + 10];
    }
    return { pos, nor, col, uv, mat: Uint8Array.from(this.m) };
  }
}

function corner(s, k) {
  return [s.pos[k * 3], s.pos[k * 3 + 1], s.pos[k * 3 + 2], s.nor[k * 3], s.nor[k * 3 + 1], s.nor[k * 3 + 2],
    s.col[k * 3], s.col[k * 3 + 1], s.col[k * 3 + 2], s.uv[k * 2], s.uv[k * 2 + 1]];
}

const q = (x) => Math.round(x * 2e6);
const pkey = (c) => q(c[0]) + "," + q(c[1]) + "," + q(c[2]);

/**
 * Splits solid `s` by the plane n·x = c (n is {x,y,z}, unit length).
 * Returns { a, b, loops } where `a` is the side n points into, `b` the other, and `loops` the
 * outlines of the cut face as arrays of [x,y,z]. Returns null if the plane misses the solid.
 */
export function sliceSolid(s, n, c) {
  const A = new Builder(), B = new Builder();
  const pts = []; // cut points, each a corner array
  const ids = new Map(); // edge key -> index into pts
  const segs = [];
  const tris = s.mat.length;
  const d = [0, 0, 0];
  const cs = [null, null, null];

  const cut = (ca, cb, da, db) => {
    // canonical order so neighbours compute bit-identical points for their shared edge
    let ka = pkey(ca), kb = pkey(cb);
    if (ka > kb) {
      [ca, cb] = [cb, ca];
      [da, db] = [db, da];
      [ka, kb] = [kb, ka];
    }
    const key = ka + "|" + kb;
    let id = ids.get(key);
    if (id !== undefined) return id;
    const t = da / (da - db);
    const r = new Array(STRIDE);
    for (let i = 0; i < STRIDE; i++) r[i] = ca[i] + (cb[i] - ca[i]) * t;
    const l = Math.hypot(r[3], r[4], r[5]) || 1;
    r[3] /= l; r[4] /= l; r[5] /= l;
    id = pts.length;
    pts.push(r);
    ids.set(key, id);
    return id;
  };

  for (let t = 0; t < tris; t++) {
    let pos = 0;
    for (let i = 0; i < 3; i++) {
      const k = t * 3 + i;
      let v = n.x * s.pos[k * 3] + n.y * s.pos[k * 3 + 1] + n.z * s.pos[k * 3 + 2] - c;
      if (Math.abs(v) < 1e-9) v = 1e-9; // never exactly on the plane: no degenerate splits
      d[i] = v;
      if (v > 0) pos++;
    }
    const mat = s.mat[t];
    if (pos === 3 || pos === 0) {
      const target = pos === 3 ? A : B;
      target.tri(corner(s, t * 3), corner(s, t * 3 + 1), corner(s, t * 3 + 2), mat);
      continue;
    }
    for (let i = 0; i < 3; i++) cs[i] = corner(s, t * 3 + i);
    // the vertex that is alone on its side
    let L = 0;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, k = (i + 2) % 3;
      if (d[i] > 0 !== d[j] > 0 && d[i] > 0 !== d[k] > 0) L = i;
    }
    const i1 = (L + 1) % 3, i2 = (L + 2) % 3;
    const p01 = cut(cs[L], cs[i1], d[L], d[i1]);
    const p02 = cut(cs[L], cs[i2], d[L], d[i2]);
    const lone = d[L] > 0 ? A : B, other = d[L] > 0 ? B : A;
    lone.tri(cs[L], pts[p01], pts[p02], mat);
    other.tri(pts[p01], cs[i1], cs[i2], mat);
    other.tri(pts[p01], cs[i2], pts[p02], mat);
    if (p01 !== p02) segs.push([p01, p02]);
  }

  if (!segs.length || !A.m.length || !B.m.length) return null;

  // chain the cut segments into closed outlines
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const [a, b] of segs) {
    link(a, b);
    link(b, a);
  }
  const used = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    let prev = -1, cur = start;
    for (let guard = 0; guard < 100000; guard++) {
      const nb = adj.get(cur).find((x) => x !== prev && !used.has(x));
      if (nb === undefined) break;
      loop.push(nb);
      used.add(nb);
      prev = cur;
      cur = nb;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return null;

  // 2D frame on the plane
  const ax = Math.abs(n.x) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ax[1] * n.z - ax[2] * n.y, uy = ax[2] * n.x - ax[0] * n.z, uz = ax[0] * n.y - ax[1] * n.x;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const vx = n.y * uz - n.z * uy, vy = n.z * ux - n.x * uz, vz = n.x * uy - n.y * ux;
  const to2 = (p) => new Vector2(p[0] * ux + p[1] * uy + p[2] * uz, p[0] * vx + p[1] * vy + p[2] * vz);

  const polys = loops.map((loop) => {
    // drop points that sit on top of their neighbour
    const idx = [];
    for (const id of loop) {
      if (idx.length) {
        const a = pts[idx[idx.length - 1]], b = pts[id];
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 2e-7) continue;
      }
      idx.push(id);
    }
    const p2 = idx.map((id) => to2(pts[id]));
    let area = 0;
    for (let i = 0; i < p2.length; i++) {
      const a = p2[i], b = p2[(i + 1) % p2.length];
      area += a.x * b.y - b.x * a.y;
    }
    return { idx, p2, area: Math.abs(area / 2) };
  }).filter((p) => p.idx.length >= 3 && p.area > 1e-10);

  const inside = (pt, poly) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
  };
  // nesting depth decides outer outline vs hole
  for (const p of polys) {
    p.depth = 0;
    p.parent = null;
    for (const o of polys) if (o !== p && o.area > p.area && inside(p.p2[0], o.p2)) {
      p.depth++;
      if (!p.parent || o.area < p.parent.area) p.parent = o;
    }
  }
  const capA = [], capB = [];
  const cn = [-n.x, -n.y, -n.z];
  for (const outer of polys.filter((p) => p.depth % 2 === 0)) {
    const holes = polys.filter((p) => p.parent === outer && p.depth % 2 === 1);
    const contour = outer.p2.slice();
    const holes2 = holes.map((h) => h.p2.slice());
    const ids2 = outer.idx.concat(...holes.map((h) => h.idx));
    let faces;
    try {
      faces = ShapeUtils.triangulateShape(contour, holes2);
    } catch {
      continue;
    }
    for (const f of faces) {
      let a = pts[ids2[f[0]]], b = pts[ids2[f[1]]], c3 = pts[ids2[f[2]]];
      if (!a || !b || !c3) continue;
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
      const e2x = c3[0] - a[0], e2y = c3[1] - a[1], e2z = c3[2] - a[2];
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      // piece A (positive side) faces -n through its cut, piece B faces +n
      const facesNeg = fx * cn[0] + fy * cn[1] + fz * cn[2] > 0;
      capA.push(facesNeg ? [a, b, c3] : [a, c3, b]);
      capB.push(facesNeg ? [a, c3, b] : [a, b, c3]);
    }
  }
  const capCorner = (p, sgn) => [p[0], p[1], p[2], sgn * n.x, sgn * n.y, sgn * n.z, 1, 1, 1, 0, 0];
  for (const [a, b, c3] of capA) A.tri(capCorner(a, -1), capCorner(b, -1), capCorner(c3, -1), 1);
  for (const [a, b, c3] of capB) B.tri(capCorner(a, 1), capCorner(b, 1), capCorner(c3, 1), 1);

  return { a: A.solid(), b: B.solid(), loops: polys.map((p) => p.idx.map((id) => pts[id].slice(0, 3))) };
}
