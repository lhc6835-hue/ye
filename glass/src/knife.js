// A chef's knife built from its real cross-section: a flat grind from a 2.2 mm spine down to a
// fine edge, curved belly toward the tip, steel bolster, wood handle with three rivets.
//
// Model frame: the origin is the point on the edge that follows the pointer. +X runs along the edge
// toward the tip, +Y from the edge up to the spine, +Z is the blade's face normal.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const EDGE = { heel: 0.07, tip: 0.13, flat: 0.075 }; // straight edge runs from -heel to +flat

const edgeY = (x) => (x <= EDGE.flat ? 0 : 0.034 * Math.pow((x - EDGE.flat) / (EDGE.tip - EDGE.flat), 1.9));
const spineY = (x) => (x <= 0.04 ? 0.046 : 0.046 - 0.012 * Math.pow((x - 0.04) / (EDGE.tip - 0.04), 2.2));

function bladeGeometry() {
  const NX = 90, NY = 14;
  const x0 = -EDGE.heel, x1 = EDGE.tip;
  const pos = [], uv = [], idx = [];
  const halfT = (x, v) => {
    // v: 0 at the edge, 1 at the spine
    const spine = 0.0011 * (1 - 0.65 * Math.max(0, (x - 0.0) / (x1 - 0.0)));
    const grind = Math.pow(v, 0.85);
    const micro = 0.00004; // the honed edge
    return Math.max(micro, spine * grind);
  };
  // two faces (+z, -z)
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NX; i++) {
      const x = x0 + ((x1 - x0) * i) / NX;
      const ye = edgeY(x), ys = Math.max(ye + 0.0004, spineY(x));
      for (let j = 0; j <= NY; j++) {
        const v = j / NY;
        // denser rows close to the edge, where the bevel catches light
        const vv = Math.pow(v, 1.4);
        const y = ye + (ys - ye) * vv;
        pos.push(x, y, side * halfT(x, vv));
        uv.push((x - x0) / (x1 - x0), y / 0.05);
      }
    }
    for (let i = 0; i < NX; i++)
      for (let j = 0; j < NY; j++) {
        const a = base + i * (NY + 1) + j, b = a + NY + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
  }
  const off = (NX + 1) * (NY + 1);
  // spine strip and edge strip join the two faces
  for (let i = 0; i < NX; i++) {
    const a = i * (NY + 1), b = (i + 1) * (NY + 1);
    idx.push(a + NY, b + NY, off + a + NY, b + NY, off + b + NY, off + a + NY); // spine
    idx.push(a, off + a, b, b, off + a, off + b); // edge
  }
  // heel
  for (let j = 0; j < NY; j++) idx.push(j, j + 1, off + j, j + 1, off + j + 1, off + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  // smooth the two big faces but keep the spine/edge creases: recompute with a crease merge
  return smoothFaces(ng);
}

/** Averages normals of coincident vertices only when the faces meet at a shallow angle. */
function smoothFaces(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e6)},${Math.round(p.getY(i) * 1e6)},${Math.round(p.getZ(i) * 1e6)}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  }
  const out = new Float32Array(p.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), s = new THREE.Vector3();
  for (const list of map.values())
    for (const i of list) {
      a.fromBufferAttribute(n, i);
      s.set(0, 0, 0);
      for (const j of list) {
        b.fromBufferAttribute(n, j);
        if (a.dot(b) > 0.6) s.add(b);
      }
      s.normalize();
      out[i * 3] = s.x;
      out[i * 3 + 1] = s.y;
      out[i * 3 + 2] = s.z;
    }
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  return g;
}

export function makeKnife(woodMap) {
  const group = new THREE.Group();
  const steel = new THREE.MeshPhysicalMaterial({
    color: 0xe6e9ee, metalness: 1, roughness: 0.2, anisotropy: 0.7, anisotropyRotation: 0,
    clearcoat: 0.25, clearcoatRoughness: 0.12, envMapIntensity: 1.25, side: THREE.DoubleSide,
  });
  const blade = new THREE.Mesh(bladeGeometry(), steel);
  blade.castShadow = true;
  group.add(blade);

  const polished = new THREE.MeshPhysicalMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.12, envMapIntensity: 1.3 });
  const bolster = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.034, 0.0075, 3, 0.0025), polished);
  bolster.position.set(-EDGE.heel - 0.005, 0.03, 0);
  bolster.castShadow = true;
  group.add(bolster);

  const wood = new THREE.MeshPhysicalMaterial({
    color: 0x6b4a36, map: woodMap || null, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2,
  });
  if (woodMap) {
    const t = woodMap.clone();
    t.repeat.set(0.35, 0.08);
    t.rotation = Math.PI / 2;
    t.needsUpdate = true;
    wood.map = t;
  }
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.118, 0.026, 0.0175, 5, 0.0075), wood);
  // slight downward sweep at the butt like a real handle
  const hp = handle.geometry.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const u = (x + 0.059) / 0.118; // 0 at butt
    hp.setY(i, hp.getY(i) * (1 + 0.12 * (1 - u)) - 0.004 * (1 - u) * (1 - u));
  }
  handle.geometry.computeVertexNormals();
  handle.position.set(-EDGE.heel - 0.012 - 0.059, 0.031, 0);
  handle.castShadow = true;
  group.add(handle);
  const rivetG = new THREE.CylinderGeometry(0.0026, 0.0026, 0.0182, 16);
  rivetG.rotateX(Math.PI / 2);
  for (const dx of [0.022, 0.058, 0.094]) {
    const r = new THREE.Mesh(rivetG, polished);
    r.position.set(-EDGE.heel - 0.012 - dx, 0.031, 0);
    group.add(r);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}
