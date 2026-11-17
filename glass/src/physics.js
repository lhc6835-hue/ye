// Rigid-body physics with Rapier: glass-dense convex bodies on a wooden board on a table.
import RAPIER from "@dimforge/rapier3d-compat";
import { BOARD } from "./stage.js";

// collision groups: membership << 16 | filter
const G_STATIC = 1, G_FRUIT = 2, G_CRUMB = 4, G_KNIFE = 8;
const groups = (member, filter) => (member << 16) | filter;
export const GROUP = {
  static: groups(G_STATIC, G_FRUIT | G_CRUMB),
  fruit: groups(G_FRUIT, G_STATIC | G_FRUIT | G_CRUMB),
  crumb: groups(G_CRUMB, G_STATIC | G_FRUIT | G_CRUMB | G_KNIFE),
  knife: groups(G_KNIFE, G_CRUMB),
};

export const GLASS_DENSITY = 2500; // kg/m^3
const DT = 1 / 120;

export class Physics {
  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    const w = (this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }));
    w.timestep = DT;
    w.integrationParameters.numSolverIterations = 6;
    this.acc = 0;
    this.kind = new Map(); // collider handle -> "board" | "table" | "glass" | "knife"
    // table
    const t = w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.05, 3).setTranslation(0, -0.05, 0).setFriction(0.5).setRestitution(0.1).setCollisionGroups(GROUP.static));
    this.kind.set(t.handle, "table");
    // board
    const b = w.createCollider(RAPIER.ColliderDesc.cuboid(BOARD.w / 2, BOARD.h / 2, BOARD.d / 2).setTranslation(0, BOARD.h / 2, 0).setFriction(0.62).setRestitution(0.12).setCollisionGroups(GROUP.static));
    this.kind.set(b.handle, "board");
    // knife blade: kinematic, only nudges crumbs too small to cut
    this.knife = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
    const kc = w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.02, 0.0012).setTranslation(0.03, 0.02, 0).setCollisionGroups(GROUP.knife).setFriction(0.3), this.knife);
    this.kind.set(kc.handle, "knife");
    this.bodies = new Set();
  }

  /** Creates a dynamic body whose collider is the convex hull of `positions` (local frame). */
  addBody(positions, pos, quat, { crumb = false, linvel, angvel } = {}) {
    const R = this.R;
    const pts = hullPoints(positions);
    let desc = R.ColliderDesc.convexHull(pts);
    if (!desc) {
      const bb = bounds(positions);
      desc = R.ColliderDesc.cuboid(Math.max(0.001, bb.hx), Math.max(0.001, bb.hy), Math.max(0.001, bb.hz)).setTranslation(bb.cx, bb.cy, bb.cz);
    }
    desc.setDensity(GLASS_DENSITY).setFriction(0.55).setRestitution(0.16).setCollisionGroups(crumb ? GROUP.crumb : GROUP.fruit);
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setCcdEnabled(true)
      .setLinearDamping(0.08)
      .setAngularDamping(0.25);
    if (linvel) bd.setLinvel(linvel.x, linvel.y, linvel.z);
    if (angvel) bd.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z });
    const body = this.world.createRigidBody(bd);
    const col = this.world.createCollider(desc, body);
    this.kind.set(col.handle, "glass");
    body.userData = { col, prev: { x: linvel?.x || 0, y: linvel?.y || 0, z: linvel?.z || 0 }, lastHit: 0 };
    this.bodies.add(body);
    return body;
  }

  remove(body) {
    if (!body) return;
    this.kind.delete(body.userData.col.handle);
    this.bodies.delete(body);
    this.world.removeRigidBody(body);
  }

  setKnife(pos, quat) {
    this.knife.setNextKinematicTranslation(pos);
    this.knife.setNextKinematicRotation(quat);
  }

  /** Advances in fixed steps; reports impacts as onImpact(body, strengthMs, surface, point). */
  step(dt, onImpact, beforeStep) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const g = -9.81 * DT;
    let steps = 0;
    while (this.acc >= DT && steps < 8) {
      beforeStep?.(DT);
      this.world.step();
      this.acc -= DT;
      steps++;
      const now = performance.now();
      for (const b of this.bodies) {
        const u = b.userData;
        const v = b.linvel();
        const dx = v.x - u.prev.x, dy = v.y - (u.prev.y + g), dz = v.z - u.prev.z;
        u.prev = { x: v.x, y: v.y, z: v.z };
        if (b.isSleeping()) continue;
        const dv = Math.hypot(dx, dy, dz);
        if (dv > 0.12 && now - u.lastHit > 70) {
          let surface = null, best = 0;
          this.world.contactPairsWith(u.col, (other) => {
            const k = this.kind.get(other.handle);
            const rank = k === "glass" ? 3 : k === "board" ? 2 : k === "table" ? 1 : 0;
            if (rank > best) {
              best = rank;
              surface = k;
            }
          });
          if (surface && surface !== "knife") {
            u.lastHit = now;
            onImpact(b, dv, surface, b.translation());
          }
        }
      }
    }
    return steps;
  }
}

function hullPoints(p) {
  const seen = new Map();
  const out = [];
  for (let i = 0; i < p.length; i += 3) {
    const k = Math.round(p[i] * 4000) + "," + Math.round(p[i + 1] * 4000) + "," + Math.round(p[i + 2] * 4000);
    if (seen.has(k)) continue;
    seen.set(k, 1);
    out.push(p[i], p[i + 1], p[i + 2]);
  }
  const n = out.length / 3;
  const MAX = 420;
  if (n <= MAX) return new Float32Array(out);
  // keep the extremes in many directions, then fill with an even sample
  const keep = new Set();
  for (let k = 0; k < 64; k++) {
    const t = Math.acos(1 - (2 * (k + 0.5)) / 64), f = Math.PI * (1 + Math.sqrt(5)) * k;
    const dx = Math.sin(t) * Math.cos(f), dy = Math.cos(t), dz = Math.sin(t) * Math.sin(f);
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = out[i * 3] * dx + out[i * 3 + 1] * dy + out[i * 3 + 2] * dz;
      if (v > bv) {
        bv = v;
        bi = i;
      }
    }
    keep.add(bi);
  }
  const step = n / (MAX - keep.size);
  for (let x = 0; x < n && keep.size < MAX; x += step) keep.add(Math.floor(x));
  const res = new Float32Array(keep.size * 3);
  let j = 0;
  for (const i of keep) {
    res[j++] = out[i * 3];
    res[j++] = out[i * 3 + 1];
    res[j++] = out[i * 3 + 2];
  }
  return res;
}

function bounds(p) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
    z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2 };
}
