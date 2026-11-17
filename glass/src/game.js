// Game logic: the knife following the pointer, the cut itself (catch, bite, resisted slide, release),
// glass pieces with real rigid-body physics, spawning new fruit and tidying old pieces.
//
// How a cut feels:
//  1. The edge touches the glass and stops there (it "catches"); the pointer pulling ahead of the knife
//     stores force, and the fruit gets pressed.
//  2. Once enough force builds up the blade bites in with a crack.
//  3. It then slides through, slowed by the amount of glass along the edge at that depth (wider chord =
//     more resistance) with tiny stick-slip hitches that line up with the crunch grains.
//  4. As it goes, the cut face appears only behind the edge and the halves wedge apart slightly.
//  5. When the edge comes out the far side the halves become separate bodies and fall apart.
import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { sliceSolid, solidFromGeometry, geometryFromSolid, solidMass } from "./slicer.js";
import { FRUITS, FRUIT_BY_ID, prepare, makeAttachments, restQuaternion } from "./fruits.js";
import { makeKnife, EDGE } from "./knife.js";
import { BOARD, BOARD_TOP, causticTexture } from "./stage.js";
import * as sfx from "./audio.js";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const CRUMB_RADIUS = 0.0105; // pieces smaller than this can't be cut any more; the blade pushes them
const MAX_PIECES = 24;
const TILT = 0.5; // how far the blade is turned so its face catches the light (rad)
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const shadowGlass = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true, opacity: 0.42 });

class Chunk {
  constructor(game, def, solid, geometry, { whole = false } = {}) {
    this.game = game;
    this.def = def;
    this.solid = solid;
    this.whole = whole;
    this.mass = solidMass(solid);
    this.crumb = this.mass.radius < CRUMB_RADIUS;
    this.group = new THREE.Group();
    this.node = new THREE.Group(); // wedge transform while being cut
    this.group.add(this.node);
    this.geometry = geometry;
    if (!geometry.boundsTree) geometry.computeBoundsTree();
    this.mesh = new THREE.Mesh(geometry, whole ? def.skinMat : [def.skinMat, def.capMat]);
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = shadowGlass;
    this.node.add(this.mesh);
    this.attachments = [];
    this.body = null;
    this.born = performance.now();
    this.caustic = new THREE.Mesh(game.causticGeo, new THREE.MeshBasicMaterial({
      map: game.causticTex, color: new THREE.Color(def.glass.atten).lerp(new THREE.Color(0xffffff), 0.45),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    this.caustic.rotation.x = -Math.PI / 2;
    this.caustic.renderOrder = 2;
    game.scene.add(this.group, this.caustic);
  }
  addAttachment(a) {
    a.mesh.traverse((o) => {
      if (o.isMesh) o.customDepthMaterial = shadowGlass;
    });
    this.attachments.push(a);
    this.node.add(a.mesh);
  }
  sync() {
    if (!this.body) return;
    const t = this.body.translation(), r = this.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
  }
  centroidWorld(out) {
    return out.set(this.mass.cx, this.mass.cy, this.mass.cz).applyMatrix4(this.node.matrixWorld);
  }
  dispose(keepGeometry = false) {
    this.game.scene.remove(this.group, this.caustic);
    this.caustic.material.dispose();
    if (!keepGeometry && this.geometry !== this.def.geometry) {
      this.geometry.disposeBoundsTree?.();
      this.geometry.dispose();
    }
  }
}

export class Game {
  constructor(stage, physics, settings, hooks) {
    this.stage = stage;
    this.scene = stage.scene;
    this.physics = physics;
    this.settings = settings;
    this.hooks = hooks; // { onCount(n), haptic(ms) }
    this.chunks = [];
    this.causticTex = causticTexture();
    this.causticGeo = new THREE.PlaneGeometry(1, 1);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    // knife state
    this.knife = makeKnife(stage.woodTex?.diff);
    this.knife.visible = false; // until the pointer first shows up
    this.scene.add(this.knife);
    this.K = new THREE.Vector3(0.3, 0.16, 0.05);
    this.Kvel = new THREE.Vector3();
    this.d = new THREE.Vector3(0, -1, 0); // edge direction (the way it cuts)
    this.e = new THREE.Vector3(0, 0, -1); // along the blade toward the tip
    this.depth = 0;
    this.pointer = { x: 0, y: 0, active: false, touch: false, seen: false };
    this.mode = "free";
    this.cut = null;
    this.nextSpawn = performance.now() + 400;
    this.lastDef = null;
    this.time = 0;
    this.inside = new Set(); // chunks the blade already overlaps (e.g. after a touch lands on one)
  }

  // ---------- input ----------
  setPointer(x, y, active, touch) {
    const p = this.pointer;
    const wasActive = p.active;
    p.x = x;
    p.y = y;
    p.active = active;
    p.touch = touch;
    if (active && (!wasActive || !p.seen)) {
      // the knife appears where the finger lands instead of flying in across the fruit
      p.seen = true;
      this.knife.visible = true;
      if (touch || !wasActive) {
        const T = this.targetPoint();
        if (T && this.mode === "free") {
          this.K.copy(T);
          this.Kvel.set(0, 0, 0);
          this.inside = new Set(this.chunks.filter((c) => this.edgeHits(c, this.K)));
        }
      }
    }
  }

  /** Where the pointer asks the knife edge to be. */
  targetPoint() {
    const st = this.stage, p = this.pointer;
    if (!p.seen) return null;
    if (!p.active) {
      // finger lifted: the knife rests up and to the right of the board
      return tmpV2.copy(st.right).multiplyScalar(0.42).add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(st.forward, 0.05).clone();
    }
    const ndc = new THREE.Vector2(p.x, p.y + (p.touch ? 0.09 : 0));
    this.raycaster.setFromCamera(ndc, st.camera);
    const ray = this.raycaster.ray;
    const plane = new THREE.Plane(st.forward.clone(), -this.depth);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    hit.x = THREE.MathUtils.clamp(hit.x, -0.6, 0.6);
    hit.z = THREE.MathUtils.clamp(hit.z, -0.6, 0.6);
    hit.y = Math.min(hit.y, 0.32);
    return hit;
  }

  /** Lowest the knife origin may go so the edge rests on whatever is under it. */
  floorAt(K) {
    const onBoard = Math.abs(K.x) < BOARD.w / 2 + 0.002 && Math.abs(K.z) < BOARD.d / 2 + 0.002;
    const surface = onBoard ? BOARD_TOP : 0;
    const drop = Math.min(0, this.e.y * EDGE.flat, -this.e.y * EDGE.heel);
    return surface + 0.0003 - drop;
  }

  // ---------- knife pose ----------
  updateOrientation(dt, vel) {
    const st = this.stage;
    const v = tmpV.copy(vel).addScaledVector(st.forward, -vel.dot(st.forward));
    const speed = v.length();
    if (speed > 0.07) {
      v.divideScalar(speed);
      // the edge leads the motion, except when lifting the knife back up (spine first)
      if (v.dot(UP) < 0.3) {
        const k = 1 - Math.exp(-dt * Math.min(18, 6 + speed * 30));
        this.d.lerp(v, k).normalize();
      }
    }
    const f = st.forward;
    const e0 = tmpV2.copy(f).addScaledVector(this.d, -f.dot(this.d));
    if (e0.lengthSq() < 1e-6) e0.copy(st.right);
    e0.normalize();
    const a = e0.clone().applyAxisAngle(this.d, TILT), b = e0.clone().applyAxisAngle(this.d, -TILT);
    const score = (x) => x.dot(st.right) - 0.5 * x.y;
    const want = score(a) < score(b) ? a : b;
    this.e.lerp(want, 1 - Math.exp(-dt * 16));
    this.e.addScaledVector(this.d, -this.e.dot(this.d)).normalize();
  }

  knifeQuat(d, e, out = new THREE.Quaternion()) {
    const n = tmpV.crossVectors(d, e).normalize();
    tmpM.makeBasis(e, d.clone().negate(), n);
    return out.setFromRotationMatrix(tmpM);
  }

  /** Does the straight part of the edge, at knife position K, touch this chunk's glass? */
  edgeHits(chunk, K, e = this.e) {
    const r = chunk.mass.radius + 0.002;
    const c = chunk.centroidWorld(tmpV);
    // distance from centre to the edge segment
    const a = tmpV2.copy(K).addScaledVector(e, -EDGE.heel);
    const len = EDGE.heel + EDGE.flat;
    const t = THREE.MathUtils.clamp(tmpV.clone().sub(a).dot(e), 0, len);
    if (a.clone().addScaledVector(e, t).distanceTo(c) > r) return false;
    this.raycaster.set(a, e);
    this.raycaster.near = 0;
    this.raycaster.far = len;
    if (this.raycaster.intersectObject(chunk.mesh, false).length) return true;
    this.raycaster.set(a.clone().addScaledVector(e, len), e.clone().negate());
    return this.raycaster.intersectObject(chunk.mesh, false).length > 0;
  }

  // ---------- main update ----------
  update(dt) {
    this.time += dt;
    const now = performance.now();
    for (const c of this.chunks) c.sync();
    if (this.cut) for (const p of [this.cut.A, this.cut.B]) p.group.position.copy(this.cut.chunk.group.position), p.group.quaternion.copy(this.cut.chunk.group.quaternion);
    this.scene.updateMatrixWorld();

    if (this.mode === "free") this.updateFree(dt);
    else this.updateCut(dt);

    // knife pose and its kinematic collider
    this.knife.position.copy(this.K);
    if (this.mode === "free") this.knifeQuat(this.d, this.e, this.knife.quaternion);
    this.physics.setKnife(this.knife.position, this.knife.quaternion);

    this.physics.step(dt, (body, dv, surface) => this.onImpact(body, dv, surface), (h) => this.beforeStep(h));
    for (const c of this.chunks) c.sync();
    if (this.cut) this.placeCutPieces();
    this.scene.updateMatrixWorld();
    this.updateCaustics();
    this.housekeeping(now);
  }

  updateFree(dt) {
    const st = this.stage;
    // move the knife's working depth to the fruit under the pointer, so the edge meets it
    if (this.pointer.active) {
      this.raycaster.setFromCamera(new THREE.Vector2(this.pointer.x, this.pointer.y + (this.pointer.touch ? 0.09 : 0)), st.camera);
      const ray = this.raycaster.ray;
      let best = null, bestD = Infinity;
      for (const c of this.chunks) {
        if (c.dissolving) continue;
        const cw = c.centroidWorld(new THREE.Vector3());
        const dist = ray.distanceToPoint(cw) - c.mass.radius;
        if (dist < 0.05 && dist < bestD) {
          bestD = dist;
          best = cw;
        }
      }
      const want = best ? best.dot(st.forward) : 0.0;
      this.depth += (want - this.depth) * (1 - Math.exp(-dt * 9));
    }
    const T = this.targetPoint();
    const prev = this.K.clone();
    if (T) {
      T.y = Math.max(T.y, this.floorAt(T));
      // critically damped spring, sub-stepped for stability
      const w = this.pointer.active ? 42 : 12;
      const n = Math.ceil(dt / (1 / 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const ax = w * w * (T.x - this.K.x) - 2 * w * this.Kvel.x;
        const ay = w * w * (T.y - this.K.y) - 2 * w * this.Kvel.y;
        const az = w * w * (T.z - this.K.z) - 2 * w * this.Kvel.z;
        this.Kvel.x += ax * h; this.Kvel.y += ay * h; this.Kvel.z += az * h;
        this.K.addScaledVector(this.Kvel, h);
      }
    }
    const floor = this.floorAt(this.K);
    if (this.K.y < floor) {
      if (this.Kvel.y < -0.12) sfx.knifeBoard(-this.Kvel.y, this.pan(this.K));
      this.K.y = floor;
      this.Kvel.y = Math.max(0, this.Kvel.y);
    }
    this.updateOrientation(dt, this.Kvel);

    // forget chunks the blade has left
    for (const c of [...this.inside]) if (!this.chunks.includes(c) || !this.edgeHits(c, this.K)) this.inside.delete(c);

    // sweep the edge from where it was to where it is now and look for first contact
    const move = this.K.clone().sub(prev);
    const dist = move.length();
    if (dist < 1e-6 || !this.pointer.active) return;
    const steps = Math.min(16, Math.ceil(dist / 0.0018));
    const cands = this.chunks.filter((c) => !c.crumb && !c.dissolving && !this.inside.has(c) && !(c.cooldown > this.time));
    if (!cands.length) return;
    const P = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      P.copy(prev).addScaledVector(move, i / steps);
      for (const c of cands) {
        if (!this.edgeHits(c, P)) continue;
        // refine the touching point
        let lo = (i - 1) / steps, hi = i / steps;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) / 2;
          if (this.edgeHits(c, tmpV.copy(prev).addScaledVector(move, mid).clone())) hi = mid;
          else lo = mid;
        }
        const Kc = prev.clone().addScaledVector(move, hi);
        const dir = move.clone().normalize();
        if (dir.dot(this.d) < 0.25) {
          // spine or flat first: the glass blocks the blade and gets shoved instead
          this.K.copy(prev.clone().addScaledVector(move, lo));
          this.Kvel.multiplyScalar(0.1);
          this.shove(c, dir, dist);
          return;
        }
        this.K.copy(Kc);
        if (this.startCut(c, Kc)) return;
        c.cooldown = this.time + 0.25;
        return;
      }
    }
  }

  shove(c, dir, dist) {
    if (!c.body) return;
    const m = c.body.mass();
    const imp = dir.clone().multiplyScalar(Math.min(0.6, dist * 30) * m * 0.5);
    imp.y = Math.min(imp.y, 0);
    c.body.applyImpulseAtPoint(imp, this.K, true);
    sfx.impact("glass", Math.min(1, dist * 40), 1.3, this.pan(this.K));
  }

  pan(p) {
    return THREE.MathUtils.clamp(p.dot(this.stage.right) / 0.25, -1, 1) * 0.6;
  }

  // ---------- cutting ----------
  startCut(chunk, Kc) {
    const g = chunk.group;
    const inv = tmpQ.copy(g.quaternion).invert();
    const d = this.d.clone(), e = this.e.clone();
    e.addScaledVector(d, -e.dot(d)).normalize();
    const dl = d.clone().applyQuaternion(inv).normalize();
    const el = e.clone().applyQuaternion(inv).normalize();
    const nl = new THREE.Vector3().crossVectors(dl, el).normalize();
    const Kl = g.worldToLocal(Kc.clone());
    const res = sliceSolid(chunk.solid, nl, nl.dot(Kl));
    if (!res) return false;
    const ma = solidMass(res.a), mb = solidMass(res.b);
    if (Math.min(ma.volume, mb.volume) < chunk.mass.volume * 0.008) return false;
    // the cut outline in blade coordinates: u along the cut direction, v along the blade
    const loops = res.loops.map((l) => l.map((p) => {
      const q = new THREE.Vector3(p[0] - Kl.x, p[1] - Kl.y, p[2] - Kl.z);
      return [q.dot(dl), q.dot(el)];
    }));
    let sEnd = -Infinity;
    for (const l of loops) for (const [u] of l) sEnd = Math.max(sEnd, u);
    if (sEnd < 0.0025) return false;
    const chordAt = (s) => {
      const vs = [];
      for (const l of loops)
        for (let i = 0; i < l.length; i++) {
          const [u1, v1] = l[i], [u2, v2] = l[(i + 1) % l.length];
          if (u1 > s !== u2 > s) vs.push(v1 + ((s - u1) / (u2 - u1)) * (v2 - v1));
        }
      vs.sort((a, b) => a - b);
      let sum = 0;
      for (let i = 0; i + 1 < vs.length; i += 2) {
        const a = Math.max(vs[i], -EDGE.heel - 0.01), b = Math.min(vs[i + 1], EDGE.tip);
        if (b > a) sum += b - a;
      }
      return sum;
    };
    let maxChord = 1e-4;
    for (let i = 1; i < 24; i++) maxChord = Math.max(maxChord, chordAt((sEnd * i) / 24));

    const def = chunk.def;
    if (!def.clipCap) def.clipCap = def.makeClipCap();
    const mk = (solid) => {
      const p = new Chunk(this, def, solid, geometryFromSolid(solid));
      p.mesh.material = [def.skinMat, def.clipCap];
      p.group.position.copy(g.position);
      p.group.quaternion.copy(g.quaternion);
      return p;
    };
    const A = mk(res.a), B = mk(res.b);
    chunk.mesh.visible = false;
    chunk.caustic.visible = false;
    for (const a of chunk.attachments) (nl.dot(a.anchor) - nl.dot(Kl) > 0 ? A : B).addAttachment(a);

    const knifeWorldQ = this.knifeQuat(d, e);
    this.cut = {
      chunk, A, B, Kl, dl, el, nl, sEnd, chordAt, maxChord, s: 0, v: 0, phase: "bite",
      qLocal: inv.clone().multiply(knifeWorldQ), grainAcc: 0, nextGrain: 0.002, hitch: 0, alpha: 0,
      biteGap: (0.007 + 0.009 * def.hardness) * Math.min(1.3, Math.max(0.6, chunk.mass.radius / 0.035)),
      pitch: Math.min(1.7, Math.max(0.8, 0.036 / chunk.mass.radius)), t0: this.time, scrapeT: 0,
    };
    if (chunk.body) {
      chunk.body.setAngularDamping(6);
      chunk.body.setLinearDamping(2);
    }
    this.mode = "cut";
    this.Kvel.set(0, 0, 0);
    sfx.impact("glass", 0.12, this.cut.pitch, this.pan(Kc));
    return true;
  }

  updateCut(dt) {
    const c = this.cut;
    const g = c.chunk.group;
    const d = c.dl.clone().applyQuaternion(g.quaternion);
    const e = c.el.clone().applyQuaternion(g.quaternion);
    const Kcur = g.localToWorld(c.Kl.clone().addScaledVector(c.dl, c.s));
    const T = this.pointer.active ? this.targetPoint() : null;
    const def = c.chunk.def;
    let gap = -1, lat = 0;
    if (T) {
      const diff = T.clone().sub(Kcur);
      gap = diff.dot(d);
      lat = diff.addScaledVector(d, -gap).addScaledVector(this.stage.forward, -diff.dot(this.stage.forward)).length();
    }
    if (!T || gap < (c.phase === "bite" ? -0.012 : -0.022) || lat > 0.09) {
      this.abortCut();
      return;
    }
    c.pressure = THREE.MathUtils.clamp(gap / c.biteGap, 0, 1.5);
    if (c.phase === "bite") {
      // the edge sits on the surface; the glass gives a hair under load
      c.s = Math.min(0.0012, Math.max(0, gap) * 0.06);
      if (gap > c.biteGap) {
        c.phase = "cut";
        c.snap = 0.0022;
        c.v = 0.08;
        sfx.bite(c.pitch, this.pan(Kcur));
        this.hooks.haptic(14);
      }
    } else {
      const chordN = c.chordAt(Math.max(0.0005, c.s)) / c.maxChord;
      const resist = def.hardness * (0.3 + 0.7 * chordN);
      let vt = (Math.max(0, gap - 0.0025) * 18) / (0.45 + 1.5 * resist);
      vt = Math.min(vt, 1.4);
      if (c.hitch > 0) {
        vt *= 0.72;
        c.hitch -= dt;
      }
      c.v += (vt - c.v) * (1 - Math.exp(-dt * 24));
      let ds = c.v * dt;
      if (c.snap > 0) {
        const k = Math.min(c.snap, c.snap * (1 - Math.exp(-dt * 40)) + 0.0002);
        ds += k;
        c.snap -= k;
      }
      c.s += ds;
      c.grainAcc += ds;
      // a continuous soft "sss" that follows the blade: louder with more glass on the edge
      sfx.texture(THREE.MathUtils.clamp(c.v / 0.2, 0, 1) * (0.35 + 0.65 * chordN), Math.min(1, c.v / 0.45), this.pan(Kcur));
      if (c.grainAcc > c.nextGrain) {
        // now and then a little grit, with a matching micro-hitch in the blade
        c.grainAcc = 0;
        c.nextGrain = 0.004 + Math.random() * 0.007;
        const amt = THREE.MathUtils.clamp(c.v / 0.22, 0.15, 1) * (0.45 + 0.55 * chordN);
        sfx.grain(amt, c.pitch, this.pan(Kcur));
        c.hitch = 0.012 + Math.random() * 0.01;
        if (amt > 0.5) this.hooks.haptic(4);
      }
      if (c.s >= c.sEnd) {
        this.finishCut();
        return;
      }
    }
    // the blade wedges the halves open behind the edge
    c.alpha = 0.04 * smooth(c.s / c.sEnd) * Math.min(1.2, 0.6 + def.hardness * 0.4);
    // knife pose rides with the fruit, with a faint tremble while pressing
    const tremble = c.phase === "bite" ? Math.sin(this.time * 95) * 0.00018 * c.pressure : Math.sin(this.time * 70) * 0.00005 * Math.min(1, c.v * 4);
    const n = new THREE.Vector3().crossVectors(d, e).normalize();
    this.K.copy(Kcur).addScaledVector(n, tremble);
    this.knife.quaternion.copy(g.quaternion).multiply(c.qLocal);
    // reveal the cut face only where the edge has passed
    const plane = def.clipCap.clippingPlanes[0];
    plane.normal.copy(d).negate();
    plane.constant = d.dot(Kcur) + 0.0006;
    c.dWorld = d;
    c.Kworld = Kcur.clone();
  }

  beforeStep(h) {
    const c = this.cut;
    if (!c || !c.chunk.body || !c.dWorld) return;
    const m = c.chunk.body.mass();
    const f = 9.81 * m * (c.phase === "bite" ? 0.45 : 0.25) * Math.min(1, c.pressure || 0);
    if (f <= 0) return;
    c.chunk.body.applyImpulseAtPoint({ x: c.dWorld.x * f * h, y: c.dWorld.y * f * h, z: c.dWorld.z * f * h }, c.Kworld, true);
  }

  placeCutPieces() {
    const c = this.cut;
    const H = c.Kl.clone().addScaledVector(c.dl, c.s);
    for (const [p, sgn] of [[c.A, 1], [c.B, -1]]) {
      p.group.position.copy(c.chunk.group.position);
      p.group.quaternion.copy(c.chunk.group.quaternion);
      const q = new THREE.Quaternion().setFromAxisAngle(c.el, (sgn * c.alpha) / 2);
      p.node.quaternion.copy(q);
      p.node.position.copy(H).sub(H.clone().applyQuaternion(q));
    }
  }

  finishCut() {
    const c = this.cut;
    const parent = c.chunk;
    sfx.textureStop();
    this.placeCutPieces();
    this.scene.updateMatrixWorld();
    const pb = parent.body;
    const v0 = pb ? pb.linvel() : { x: 0, y: 0, z: 0 };
    const w0 = pb ? pb.angvel() : { x: 0, y: 0, z: 0 };
    const p0 = pb ? pb.translation() : parent.group.position;
    const g = parent.group;
    const nW = c.nl.clone().applyQuaternion(g.quaternion);
    const eW = c.el.clone().applyQuaternion(g.quaternion);
    const dW = c.dl.clone().applyQuaternion(g.quaternion);
    const speed = c.v;
    for (const [p, sgn] of [[c.A, 1], [c.B, -1]]) {
      // bake the wedge into the body pose
      const m = p.node.matrixWorld;
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
      m.decompose(pos, quat, scl);
      p.node.position.set(0, 0, 0);
      p.node.quaternion.identity();
      p.group.position.copy(pos);
      p.group.quaternion.copy(quat);
      const cw = p.centroidWorld(new THREE.Vector3());
      const r = cw.clone().sub(p0);
      const wv = new THREE.Vector3(w0.x, w0.y, w0.z).cross(r);
      const sep = (0.035 + Math.random() * 0.03) * (p.crumb ? 1.6 : 1);
      const lin = new THREE.Vector3(v0.x, v0.y, v0.z).add(wv).addScaledVector(nW, sgn * sep).addScaledVector(dW, Math.min(0.05, speed * 0.08));
      const ang = new THREE.Vector3(w0.x, w0.y, w0.z).addScaledVector(eW, sgn * (0.8 + Math.random() * 0.8) * (0.03 / Math.max(0.012, p.mass.radius)));
      p.body = this.physics.addBody(p.solid.pos, pos, quat, { crumb: p.crumb, linvel: lin, angvel: ang });
      p.mesh.material = [p.def.skinMat, p.def.capMat];
      this.chunks.push(p);
    }
    this.removeChunk(parent);
    sfx.through(speed, c.pitch, this.pan(this.K));
    this.hooks.haptic(18);
    if (parent.whole) {
      this.hooks.onCount();
      this.nextSpawn = Math.min(this.nextSpawn, performance.now() + 1100);
    }
    // the knife carries on from where it came out
    this.Kvel.copy(dW).multiplyScalar(Math.max(0.1, speed));
    this.d.copy(dW);
    this.e.copy(eW);
    this.inside = new Set([c.A, c.B].filter((p) => this.edgeHits(p, this.K)));
    this.cut = null;
    this.mode = "free";
  }

  abortCut() {
    sfx.textureStop();
    const c = this.cut;
    const parent = c.chunk;
    for (const p of [c.A, c.B]) {
      for (const a of p.attachments) parent.node.add(a.mesh);
      p.dispose();
    }
    parent.mesh.visible = true;
    parent.caustic.visible = true;
    if (parent.body) {
      parent.body.setAngularDamping(0.25);
      parent.body.setLinearDamping(0.08);
    }
    parent.cooldown = this.time + 0.2;
    this.inside.add(parent);
    this.cut = null;
    this.mode = "free";
  }

  removeChunk(c) {
    const i = this.chunks.indexOf(c);
    if (i >= 0) this.chunks.splice(i, 1);
    this.inside.delete(c);
    if (c.body) {
      this.physics.remove(c.body);
      c.body = null;
    }
    c.dispose();
  }

  onImpact(body, dv, surface) {
    const c = this.chunks.find((x) => x.body === body);
    if (!c) return;
    const pitch = Math.min(1.9, Math.max(0.75, 0.036 / Math.max(0.006, c.mass.radius)));
    sfx.impact(surface, dv, pitch, this.pan(c.group.position));
  }

  // ---------- caustics: light gathered by the glass, landing inside its shadow ----------
  updateCaustics() {
    const L = this.stage.lightDir;
    for (const c of this.chunks) {
      const m = c.caustic;
      if (c.crumb || !c.mesh.visible) {
        m.visible = false;
        continue;
      }
      const cw = c.centroidWorld(tmpV);
      const onBoard = Math.abs(cw.x) < BOARD.w / 2 && Math.abs(cw.z) < BOARD.d / 2;
      const surf = onBoard ? BOARD_TOP : 0;
      const h = Math.max(0, cw.y - surf);
      m.position.set(cw.x - (L.x / L.y) * h * 0.92, surf + 0.0006, cw.z - (L.z / L.y) * h * 0.92);
      const r = c.mass.radius;
      const lift = Math.max(0, h - r * 1.1);
      const sz = r * (1.05 + lift * 6);
      m.scale.set(sz, sz, 1);
      const shrink = c.dissolving ? Math.max(0, 1 - (performance.now() - c.dissolving) / 400) : 1;
      m.material.opacity = 0.5 * Math.max(0, 1 - lift / 0.12) * Math.min(1, r / 0.02) * shrink;
      m.visible = true;
    }
  }

  // ---------- spawning and tidying ----------
  housekeeping(now) {
    const hasWhole = this.chunks.some((c) => c.whole && !c.dissolving) || (this.cut && this.cut.chunk.whole);
    if (!hasWhole && now > this.nextSpawn) {
      this.spawn();
      this.nextSpawn = now + 1e9;
    }
    // too many pieces, or pieces gone off the table: melt the oldest away
    const pieces = this.chunks.filter((c) => !c.whole && !c.dissolving && !(this.cut && this.cut.chunk === c));
    let extra = pieces.length - MAX_PIECES;
    for (const c of pieces) {
      const p = c.group.position;
      if (c.galleryOnly) continue;
      const far = Math.abs(p.x) > 0.7 || Math.abs(p.z) > 0.7 || p.y < -0.2;
      if (extra > 0 || far) {
        this.dissolve(c);
        extra--;
      }
    }
    for (const c of [...this.chunks]) {
      if (!c.dissolving) continue;
      const t = (now - c.dissolving) / 420;
      const s = Math.max(0.001, 1 - smooth(t));
      c.node.scale.setScalar(s);
      if (t >= 1) this.removeChunk(c);
    }
  }

  dissolve(c) {
    c.dissolving = performance.now();
    if (c.body) {
      // freeze it where it is while it melts
      this.physics.remove(c.body);
      c.body = null;
    }
    sfx.sparkle(this.pan(c.group.position));
  }

  spawn() {
    const enabled = this.settings.fruits.filter((id) => FRUIT_BY_ID[id]);
    const pool = enabled.length ? enabled : FRUITS.map((f) => f.id);
    let id = pool[(Math.random() * pool.length) | 0];
    if (pool.length > 1 && id === this.lastDef) id = pool[(pool.indexOf(id) + 1 + ((Math.random() * (pool.length - 1)) | 0)) % pool.length];
    this.lastDef = id;
    const def = prepare(FRUIT_BY_ID[id]);
    // pick the free spot nearest the middle of the board
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      // keep new fruit well inside what the camera frames (narrower across a portrait screen)
      const [ax, az] = this.stage.portrait ? [0.16, 0.06] : [0.22, 0.12];
      const x = (Math.random() - 0.5) * ax * (i < 6 ? 0.4 : 1);
      const z = (Math.random() - 0.5) * az * (i < 6 ? 0.4 : 1);
      let md = 1;
      for (const c of this.chunks) md = Math.min(md, Math.hypot(c.group.position.x - x, c.group.position.z - z) - c.mass.radius);
      const score = Math.min(md, 0.09) - 0.25 * Math.hypot(x, z);
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
    const solid = solidFromGeometry(def.geometry);
    const ch = new Chunk(this, def, solid, def.geometry, { whole: true });
    for (const a of makeAttachments(def)) ch.addAttachment(a);
    const q = restQuaternion(def, Math.random() * Math.PI * 2);
    const pos = new THREE.Vector3(best[0], BOARD_TOP + 0.14 + def.size, best[1]);
    ch.body = this.physics.addBody(solid.pos, pos, q, {
      angvel: new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5),
    });
    ch.sync();
    this.chunks.push(ch);
  }

  /** Debug view (?gallery=whole|cut|cut2): every fruit laid out still, whole or cut open toward the camera. */
  gallery(mode) {
    this.nextSpawn = Infinity;
    const cam = this.stage.camera.position;
    FRUITS.forEach((d, i) => {
      const def = prepare(d);
      const col = i % 5, row = Math.floor(i / 5);
      const pos = new THREE.Vector3((col - 2) * 0.07, BOARD_TOP + 0.03, (row - 1) * 0.07);
      let solid = solidFromGeometry(def.geometry), geo = def.geometry, whole = true;
      const q = new THREE.Quaternion();
      if (mode !== "whole") {
        const n = mode === "cut2" ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        const res = sliceSolid(solid, n, 0.0005);
        solid = res.a;
        geo = geometryFromSolid(solid);
        whole = false;
        const toCam = cam.clone().sub(pos).normalize();
        q.setFromUnitVectors(new THREE.Vector3(-n.x, -n.y, -n.z), toCam);
      } else q.copy(restQuaternion(def, 0.4));
      const ch = new Chunk(this, def, solid, geo, { whole });
      if (whole) for (const a of makeAttachments(def)) ch.addAttachment(a);
      ch.group.position.copy(pos);
      ch.group.quaternion.copy(q);
      ch.galleryOnly = true;
      this.chunks.push(ch);
    });
  }

  /** Builds every fruit's shaders ahead of time so the first cut never stutters. */
  async warmUp(renderer, camera) {
    const tmp = [], clones = [];
    for (const def of FRUITS) {
      prepare(def);
      if (!def.clipCap) def.clipCap = def.makeClipCap();
      const g = def.geometry;
      const split = g.clone();
      const n = g.index.count;
      split.addGroup(0, n - 3, 0);
      split.addGroup(n - 3, 3, 1);
      clones.push(split);
      for (const [geo, mats] of [[g, def.skinMat], [split, [def.skinMat, def.capMat]], [split, [def.skinMat, def.clipCap]]]) {
        const m = new THREE.Mesh(geo, mats);
        m.position.set(0, -5, 0);
        m.castShadow = true;
        m.customDepthMaterial = shadowGlass;
        tmp.push(m);
      }
      for (const a of makeAttachments(def)) {
        a.mesh.position.y -= 5;
        tmp.push(a.mesh);
      }
    }
    for (const m of tmp) this.scene.add(m);
    try {
      await renderer.compileAsync(this.scene, camera);
    } catch {
      renderer.compile(this.scene, camera);
    }
    for (const m of tmp) this.scene.remove(m);
    for (const g of clones) g.dispose();
  }
}
