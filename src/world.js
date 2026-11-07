// The alley the cat falls down: the walls, the far building, and what sticks out into the way.
import { Rng, clamp, lerp, rand, hex, mix, scale, createFx } from "../vendor/pixelfx/core/index.js";
import * as birdFx from "../vendor/pixelfx/fx/critters/bird.js";
import { W, H, WALL, PLAY_L, PLAY_R, PLAY_W, PX_PER_M, TUNE } from "./config.js";

const INK = hex("#1b1426");

// colour zones down the building, blended by depth (metres); after the last they cycle
const ZONES = [
  { wall: "#3f3462", trim: "#53477c", dim: "#221c3c", lit: "#ffd27a", brick: "#5e4a6c", brick2: "#544262", mortar: "#30253a" },
  { wall: "#2c4060", trim: "#3d5680", dim: "#18243c", lit: "#9ff0ff", brick: "#425a72", brick2: "#3a5068", mortar: "#223040" },
  { wall: "#4a2c50", trim: "#64406c", dim: "#26162c", lit: "#ff8fc8", brick: "#6a3e5e", brick2: "#5e3554", mortar: "#341d30" },
  { wall: "#213a3a", trim: "#2f5252", dim: "#122222", lit: "#c6ff8a", brick: "#35554e", brick2: "#2e4b45", mortar: "#18292a" },
].map((z) =>
  // the far wall stays dim so what sticks out into the alley reads first
  Object.fromEntries(Object.entries(z).map(([k, v]) => [k, ["wall", "trim", "dim"].includes(k) ? scale(hex(v), 0.78) : k === "lit" ? scale(hex(v), 0.85) : hex(v)])),
);
const ZONE_M = 650;

export function zoneAt(depthM) {
  const u = Math.max(0, depthM) / ZONE_M, i = Math.floor(u), f = clamp((u - i - 0.75) / 0.25);
  const a = ZONES[i % ZONES.length], b = ZONES[(i + 1) % ZONES.length];
  if (f <= 0) return a;
  const out = {};
  for (const k in a) out[k] = mix(a[k], b[k], f);
  return out;
}

const SKY_TOP = hex("#120e26"), SKY_LOW = hex("#4b2f60"), STAR = hex("#e8e4ff"), MOON = hex("#fff4d6");
const SLAB = hex("#9a94b0"), SLAB_TOP = hex("#c9c4da"), SLAB_UNDER = hex("#5c5674"), RAIL = hex("#3a3350");
const AC_BODY = hex("#d6d4e0"), AC_SHADE = hex("#a3a0b8"), AC_GRILL = hex("#5f5c76");
const ROPE = hex("#e8dcc4"), PIN = hex("#b07a48");
const PLANK = hex("#8a5a3a"), PLANK_TOP = hex("#b47c50");
const CLOTH = ["#e05a5a", "#5aa0e0", "#f2c84a", "#7cc46a", "#ecebf4", "#c97ad8", "#f08a3a"].map(hex);
const NEON = ["#ff5fa2", "#5ff2ff", "#b6ff5f", "#ffb84a"].map(hex);
const FISH_PAL = { k: "#1b1426", a: "#8fd0ff", b: "#4f8fd0", w: "#ffffff" };

const SHIRT = [
  "..kkk.kkk..",
  ".kaaakaaak.",
  "kaaaaaaaaak",
  "kakaaaaakak",
  "kk.kaaak.kk",
  "...kaaak...",
  "...kaaak...",
  "...kbbbk...",
  "...kkkkk...",
];
const PANTS = ["kkkkkkk", "kbbbbbk", "kaaaaak", "kaakaak", "kaakaak", "kaakaak", "kaakaak", "kbbkbbk", "kkkkkkk"];
const SOCK = ["kkk..", "kak..", "kak..", "kbk..", "kaakk", "kaaak", "kkkkk"];
const TOWEL = ["kkkkkkkkk", "kaaaaaaak", "kbbbbbbbk", "kaaaaaaak", "kaaaaaaak", "kaaaaaaak", "kbbbbbbbk", "kaaaaaaak", "kkkkkkkkk"];
const CLOTHES = [SHIRT, PANTS, SOCK, TOWEL];
export const FISH = [".kkkkk.kk", "kakaaakak", "kawaaaaak", "kbbbbbkak", ".kkkkk.kk"];
const SIGN_WORDS = ["BAR", "INN", "CAFE", "NEKO", "HOTEL", "RAMEN"];

const rectOf = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
export const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export class World {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.obs = []; // { type, rects, top, bottom, passed, ... }
    this.fish = []; // { x, y, taken }
    this.nextY = 230;
    this.spacing = 200;
    this.free = [PLAY_L + 8, PLAY_R - 8]; // where the cat can pass at the last row
    this.t = 0;
  }

  /** 0 at the top, 1 from TUNE.deepAt metres down. */
  hardness(y) {
    return clamp(y / PX_PER_M / TUNE.deepAt);
  }

  spawnUntil(yMax) {
    while (this.nextY < yMax) {
      const k = this.hardness(this.nextY), R = this.rng;
      this.spawn(this.nextY, k);
      this.spacing = lerp(96, 52, k) + R.range(0, lerp(36, 16, k));
      this.nextY += this.spacing;
    }
  }

  /**
   * Keep every row passable from the one before: a row's opening must lie within reach of the last
   * opening. Reach is how far the cat can slide sideways under the canopy across the spacing between
   * the two rows, with a safety margin. free is the range the cat's centre can pass through.
   */
  reach() {
    return clamp((this.spacing / TUNE.chuteSpeed) * TUNE.moveSpeed * TUNE.chuteSteer * 0.6, 18, 100);
  }
  near(lo, hi) {
    const r = this.reach(), f = this.free;
    return [Math.max(lo, f[0] - r), Math.min(hi, f[1] + r)];
  }
  meets([a, b]) {
    const r = this.reach();
    return a <= this.free[1] + r && b >= this.free[0] - r && b - a >= 0;
  }

  spawn(y, k) {
    const R = this.rng, m = y / PX_PER_M, MIN = PLAY_L + 8, MAX = PLAY_R - 8;
    const table = [
      ["ledge", 30],
      ["ac", 18],
      ["laundry", m > 30 ? 22 : 0],
      ["pair", m > 70 ? 18 : 0],
      ["sign", m > 20 ? 12 : 0],
      ["bird", m > 110 ? 10 + 14 * k : 0],
    ];
    let pick = R.next() * table.reduce((s, [, w]) => s + w, 0), type = "ledge";
    for (const [t, w] of table) if ((pick -= w) < 0) { type = t; break; }
    let side = R.sign();
    const fishChance = 0.45;
    if (type === "ledge") {
      let len = Math.round(R.range(lerp(50, 70, k), lerp(84, 108, k)));
      if (m < 45) len = Math.min(len, 64); // the first rows are a warm-up
      const freeOf = (sd, l) => (sd < 0 ? [PLAY_L + l + 8, MAX] : [MIN, PLAY_R - l - 8]);
      if (!this.meets(freeOf(side, len))) side = -side;
      while (!this.meets(freeOf(side, len)) && len > 30) len -= 6;
      this.ledge(side, len, y);
      this.free = freeOf(side, len);
      if (R.chance(fishChance)) this.addFish(side < 0 ? PLAY_L + len + R.range(10, 22) : PLAY_R - len - R.range(10, 22), y + R.range(-4, 4));
    } else if (type === "pair") {
      const gap = Math.round(lerp(48, 32, k)), half = gap / 2;
      const [lo, hi] = this.near(PLAY_L + 18 + half, PLAY_R - 18 - half);
      const gc = lo <= hi ? R.range(lo, hi) : clamp((this.free[0] + this.free[1]) / 2, PLAY_L + 18 + half, PLAY_R - 18 - half);
      const a = Math.round(gc - half - PLAY_L);
      this.ledge(-1, a, y);
      this.ledge(1, PLAY_W - gap - a, y);
      this.free = [PLAY_L + a + 8, PLAY_L + a + gap - 8];
      if (R.chance(fishChance + 0.2)) this.addFish(PLAY_L + a + gap / 2, y + 1);
    } else if (type === "ac") {
      this.ac(side, y);
      this.free = side < 0 ? [PLAY_L + 26, MAX] : [MIN, PLAY_R - 26];
      if (R.chance(0.35)) {
        this.ac(-side, y + R.range(24, 40));
        this.free = [PLAY_L + 26, PLAY_R - 26];
      }
      if (R.chance(fishChance)) this.addFish(R.range(PLAY_L + 30, PLAY_R - 30), y + R.range(30, 50));
    } else if (type === "laundry") {
      const gap = Math.round(lerp(42, 30, k));
      const half = gap / 2, [lo, hi] = this.near(PLAY_L + 14 + half, PLAY_R - 14 - half);
      const gc = lo <= hi ? R.range(lo, hi) : clamp((this.free[0] + this.free[1]) / 2, PLAY_L + 14 + half, PLAY_R - 14 - half);
      const gx = Math.round(gc - half);
      this.laundry(y, gx, gap);
      this.free = [gx + 8, gx + gap - 8];
      if (R.chance(fishChance + 0.15)) this.addFish(gx + gap / 2, y + 10);
    } else if (type === "sign") {
      if (!this.meets(side < 0 ? [PLAY_L + 30, MAX] : [MIN, PLAY_R - 30])) side = -side;
      this.sign(side, y);
      this.free = side < 0 ? [PLAY_L + 30, MAX] : [MIN, PLAY_R - 30];
      if (R.chance(fishChance)) this.addFish(side < 0 ? PLAY_L + 40 : PLAY_R - 40, y + R.range(6, 24));
    } else if (type === "bird") {
      const n = k > 0.5 && R.chance(0.5) ? 2 : 1;
      for (let i = 0; i < n; i++) this.bird(y + i * 30, R.sign(), lerp(60, 110, k) + R.range(0, 25));
      this.free = [MIN, MAX];
    }
    this.obs[this.obs.length - 1].free = this.free.slice();
  }

  ledge(side, len, y) {
    const x0 = side < 0 ? PLAY_L : PLAY_R - len, x1 = x0 + len;
    const pot = this.rng.chance(0.4) ? Math.round(this.rng.range(x0 + 4, x1 - 10)) : null;
    this.obs.push({ type: "ledge", side, x0, x1, y, pot, potColor: this.rng.pick(CLOTH), rects: [rectOf(x0, y - 6, x1, y + 5)], top: y - 6, bottom: y + 5 });
  }

  ac(side, y) {
    const w = 18, x0 = side < 0 ? PLAY_L : PLAY_R - w;
    this.obs.push({ type: "ac", side, x0, y, w, rects: [rectOf(x0, y, x0 + w, y + 12)], top: y, bottom: y + 14, ph: this.rng.range(0, 6) });
  }

  laundry(y, gx, gap) {
    const R = this.rng, sag = R.range(5, 9), items = [];
    const ropeY = (x) => y + sag * Math.sin((Math.PI * (x - PLAY_L)) / PLAY_W);
    let x = PLAY_L + R.int(2, 6);
    while (x < PLAY_R - 4) {
      const rows = R.pick(CLOTHES), w = rows[0].length;
      if (x + w > PLAY_R - 1) break;
      if (x + w > gx && x < gx + gap) {
        x = gx + gap + R.int(1, 3);
        continue;
      }
      items.push({ x, y: Math.round(ropeY(x + w / 2)), rows, c: R.pick(CLOTH), ph: R.range(0, 6) });
      x += w + R.int(2, 7);
    }
    const rects = items.map((it) => rectOf(it.x + 1, it.y + 1, it.x + it.rows[0].length - 1, it.y + it.rows.length));
    this.obs.push({ type: "laundry", y, sag, ropeY, items, rects, top: y, bottom: y + sag + 12, gx, gap });
  }

  sign(side, y) {
    const word = this.rng.pick(SIGN_WORDS), h = word.length * 7 + 4, w = 13;
    const x0 = side < 0 ? PLAY_L + 7 : PLAY_R - 7 - w;
    this.obs.push({
      type: "sign", side, word, x0, y, w, h, c: this.rng.pick(NEON), seed: this.rng.int(0, 1e6),
      rects: [rectOf(x0, y + 2, x0 + w, y + 4 + h), rectOf(side < 0 ? PLAY_L : x0 + w - 2, y, side < 0 ? x0 + 2 : PLAY_R, y + 3)],
      top: y, bottom: y + 4 + h,
    });
  }

  bird(y, from, speed) {
    const x = from < 0 ? -10 : W + 10, vx = -from * speed;
    const fx = createFx(birdFx, { x, y: 0, flip: vx < 0, seed: this.rng.int(1, 999) });
    this.obs.push({ type: "bird", x, y, vx, fx, rects: [rectOf(x - 8, y - 6, x + 8, y + 4)], top: y - 8, bottom: y + 6 });
  }

  addFish(x, y) {
    this.fish.push({ x: Math.round(clamp(x, PLAY_L + 8, PLAY_R - 8)), y: Math.round(y), taken: false, ph: this.rng.range(0, 6) });
  }

  update(dt, camY) {
    this.t += dt;
    for (const o of this.obs) {
      if (o.type !== "bird") continue;
      // birds set off well before they scroll into view, so they are already crossing when they arrive
      if (o.y - camY > H + 220) continue;
      o.x += o.vx * dt;
      o.fx.update(dt);
      const r = o.rects[0];
      r.x0 = o.x - 8; r.x1 = o.x + 8;
    }
    // forget what scrolled away above
    const gone = camY - 60;
    this.obs = this.obs.filter((o) => o.bottom > gone && !(o.type === "bird" && (o.x < -60 || o.x > W + 60) && Math.sign(o.vx) === Math.sign(o.x - W / 2)));
    this.fish = this.fish.filter((f) => f.y > gone && !f.taken);
  }

  // ---- drawing

  /** Sky, the far building and the side walls, straight into the frame's colour buffer. */
  drawBackdrop(frame, camY) {
    const C = frame.color, depth = Math.max(0, camY + H / 2) / PX_PER_M, Z = zoneAt(depth);
    const backTop = -12, sideTop = -22;
    for (let sy = 0; sy < H; sy++) {
      const wy = sy + camY;
      // the far wall scrolls at half speed
      const by = Math.floor(sy + camY * 0.5), floor = Math.floor(by / 40), fy = by - floor * 40;
      const skyRow = mix(SKY_TOP, SKY_LOW, clamp((by + 140) / 100));
      for (let sx = 0; sx < W; sx++) {
        let c;
        const inLeft = sx < WALL, inRight = sx >= W - WALL;
        if ((inLeft || inRight) && wy >= sideTop) c = this.brick(sx, wy, Z, inLeft);
        else if (by >= backTop) {
          // floors of windows on the far wall
          const col = Math.floor((sx - PLAY_L + 3) / 24), fx = sx - PLAY_L + 3 - col * 24;
          if (fy < 3) c = fy === 0 ? INK : Z.trim;
          else if (fx >= 6 && fx < 18 && fy >= 12 && fy < 30) {
            const lit = rand(col, floor, 7) > 0.48;
            const wx = fx - 6, wyy = fy - 12;
            if (wx === 0 || wx === 11 || wyy === 0) c = INK;
            else if (wyy === 17) c = Z.trim; // sill
            else if (lit) {
              const curtain = rand(col, floor, 3) > 0.6 && (wx < 3 || wx > 8);
              c = curtain ? scale(Z.lit, 0.72) : wyy < 3 ? mix(Z.lit, 0xffffffff, 0.3) : Z.lit;
              if (wx === 6 && rand(col, floor, 9) > 0.85 && wyy > 7) c = scale(Z.lit, 0.45); // someone home
            } else c = wx + wyy === 9 || wx + wyy === 10 ? Z.trim : Z.dim;
          } else c = Z.wall;
          // ambient shadow against the side walls
          if (sx < WALL + 5 || sx >= W - WALL - 5) c = scale(c, 0.78);
        } else {
          c = skyRow;
          if (rand(sx, by, 11) > 0.995) c = STAR;
        }
        C[sy * W + sx] = c;
      }
    }
  }

  brick(sx, wy, Z, left) {
    const x = left ? sx : W - 1 - sx;
    if (wy < -20) return INK;
    if (wy < -17) return Z.trim; // parapet cap
    // the inner edge of the wall catches light; the face is brick
    if (x === WALL - 1) return INK;
    if (x === WALL - 2) return Z.trim;
    // a drainpipe down the left building
    if (left && x >= 4 && x <= 6) return x === 5 ? (wy % 48 < 3 ? INK : Z.trim) : wy % 48 < 3 ? Z.trim : Z.mortar;
    const row = Math.floor(wy / 4), off = (row & 1) * 4, bx = Math.floor((x + off) / 8);
    if (((wy % 4) + 4) % 4 === 0 || (x + off) % 8 === 0) return Z.mortar;
    return rand(bx, row, left ? 1 : 2) > 0.7 ? Z.brick2 : Z.brick;
  }

  /** Window glow and the moon, into the light buffer. */
  drawLights(p, camY) {
    const depth = Math.max(0, camY + H / 2) / PX_PER_M, Z = zoneAt(depth);
    const f0 = Math.floor((camY * 0.5) / 40) - 1, f1 = Math.floor((camY * 0.5 + H) / 40) + 1;
    for (let floor = Math.max(-1, f0); floor <= f1; floor++)
      for (let col = 0; col < 7; col++) {
        if (rand(col, floor, 7) <= 0.48) continue;
        // the far wall scrolls at half speed
        const sx = PLAY_L - 3 + col * 24 + 12, sy = floor * 40 + 21 - camY * 0.5;
        if (sx < PLAY_L || sx > PLAY_R || floor * 40 < -12) continue;
        p.glow(sx, sy, 11, Z.lit, 0.1);
      }
    const my = -92 - camY * 0.5;
    if (my > -40) {
      p.circle(130, my, 8, MOON);
      p.px(127, my - 2, hex("#e8dcb8"));
      p.px(132, my + 3, hex("#e8dcb8"));
      p.glow(130, my, 30, MOON, 0.25);
    }
  }

  drawStart(p, camY) {
    // the plank the cat starts on, sticking out from the left roof
    if (camY > 30) return;
    const y = -camY;
    p.rect(PLAY_L, y, 52, 4, PLANK);
    p.rect(PLAY_L, y, 52, 1, PLANK_TOP);
    p.rect(PLAY_L, y + 4, 52, 1, INK);
    p.rect(PLAY_L + 51, y, 1, 5, INK);
    p.line(PLAY_L, y + 14, PLAY_L + 12, y + 5, INK);
  }

  draw(p, camY) {
    const t = this.t;
    for (const o of this.obs) {
      if (o.bottom - camY < -20 || o.top - camY > H + 20) continue;
      if (o.type === "ledge") this.drawLedge(p, o, camY);
      else if (o.type === "ac") this.drawAc(p, o, camY, t);
      else if (o.type === "laundry") this.drawLaundry(p, o, camY, t);
      else if (o.type === "sign") this.drawSign(p, o, camY, t);
      else if (o.type === "bird") {
        // a warning at the wall while it's still off screen
        if ((o.x < 4 || o.x > W - 4) && Math.floor(t * 8) % 2) {
          const wx = o.x < 4 ? 4 : W - 7, wy = Math.round(clamp(o.y - camY, 30, H - 12));
          p.text("!", wx + 1, wy - 3, hex("#ffd24a"), { outline: INK });
        }
        o.fx.options.x = Math.round(o.x);
        o.fx.options.y = Math.round(o.y - camY);
        o.fx.draw(p.frame);
        p.reset();
      }
    }
    for (const f of this.fish) {
      const bob = Math.round(Math.sin(t * 3 + f.ph) * 1.5), x = f.x - 4, y = f.y - 2 + bob - camY;
      p.sprite(FISH, FISH_PAL, x, y, { flip: Math.sin(t * 0.7 + f.ph) > 0 });
      p.glow(f.x, f.y + bob - camY, 8, hex("#8fd0ff"), 0.22 + 0.1 * Math.sin(t * 6 + f.ph));
      if (Math.sin(t * 4 + f.ph) > 0.92) p.px(x + 2, y - 1, 0xffffffff);
    }
  }

  drawLedge(p, o, camY) {
    const y = o.y - camY, x0 = o.x0, len = o.x1 - o.x0;
    // railing
    p.rect(x0, y - 6, len, 1, RAIL);
    for (let x = o.side < 0 ? x0 + 2 : x0 + 1; x < o.x1 - 1; x += 3) p.rect(x, y - 5, 1, 5, RAIL);
    p.rect(o.side < 0 ? o.x1 - 1 : x0, y - 6, 1, 6, RAIL);
    if (o.pot !== null) {
      const px = o.pot;
      p.rect(px - 2, y - 13, 1, 3, hex("#4f9a4a"));
      p.rect(px + 2, y - 12, 1, 3, hex("#4f9a4a"));
      p.rect(px, y - 14, 1, 4, hex("#6fc45a"));
      p.circle(px, y - 15, 1.5, o.potColor);
      p.rect(px - 3, y - 10, 7, 5, hex("#b5603e"));
      p.rect(px - 3, y - 10, 7, 1, hex("#d07a52"));
      p.rect(px - 3, y - 6, 7, 1, INK);
    }
    // slab
    p.rect(x0, y, len, 5, SLAB);
    p.rect(x0, y, len, 1, SLAB_TOP);
    p.rect(x0, y + 3, len, 2, SLAB_UNDER);
    p.rect(x0, y + 5, len, 1, INK);
    p.rect(o.side < 0 ? o.x1 : x0 - 1, y, 1, 6, INK);
  }

  drawAc(p, o, camY, t) {
    const y = o.y - camY, x0 = o.x0, w = o.w;
    p.rect(x0, y, w, 12, AC_BODY);
    p.rect(x0, y + 9, w, 3, AC_SHADE);
    p.rect(x0, y - 1, w, 1, INK);
    p.rect(x0, y + 12, w, 1, INK);
    p.rect(o.side < 0 ? x0 + w : x0 - 1, y - 1, 1, 14, INK);
    // fan grill and a spinning blade
    const cx = o.side < 0 ? x0 + 11 : x0 + 6, cy = y + 6;
    p.circle(cx, cy, 4.2, AC_GRILL);
    p.circle(cx, cy, 3, AC_SHADE);
    const a = t * 18 + o.ph;
    p.line(cx - Math.cos(a) * 3, cy - Math.sin(a) * 3, cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, INK);
    p.px(cx, cy, INK);
    for (let i = 0; i < 3; i++) p.rect(o.side < 0 ? x0 + 2 : x0 + w - 5, y + 2 + i * 3, 3, 1, AC_GRILL);
    // bracket
    const bx = o.side < 0 ? PLAY_L : PLAY_R - 1;
    p.line(bx, y + 20, bx - o.side * 10, y + 13, RAIL);
    // a drip now and then
    const d = (t * 0.7 + o.ph) % 1.6;
    if (d < 0.6) p.px(o.side < 0 ? x0 + 4 : x0 + w - 5, Math.round(y + 13 + d * d * 60), hex("#9fd8ff"));
  }

  drawLaundry(p, o, camY, t) {
    const pts = [];
    for (let x = PLAY_L; x <= PLAY_R; x += 4) pts.push([x, Math.round(o.ropeY(x) - camY)]);
    p.polyline(pts, ROPE);
    for (const it of o.items) {
      const sway = Math.round(Math.sin(t * 2.4 + it.ph) * 0.8), y = it.y - camY;
      p.sprite(it.rows, { k: INK, a: it.c, b: scale(it.c, 0.72) }, it.x + sway, y + 1);
      p.rect(it.x + 1, y - 1, 1, 2, PIN);
      p.rect(it.x + it.rows[0].length - 2, y - 1, 1, 2, PIN);
    }
    p.rect(PLAY_L, Math.round(o.y - camY) - 1, 2, 3, INK);
    p.rect(PLAY_R - 2, Math.round(o.y - camY) - 1, 2, 3, INK);
  }

  drawSign(p, o, camY, t) {
    const y = o.y - camY, x0 = o.x0, w = o.w, h = o.h;
    // flickers off now and then
    const fl = rand(Math.floor(t * 12), o.seed) > 0.04 ? 1 : 0.15;
    const c = fl > 0.5 ? o.c : scale(o.c, 0.35);
    const armX0 = o.side < 0 ? PLAY_L : x0 + 2, armX1 = o.side < 0 ? x0 + w - 2 : PLAY_R;
    p.rect(armX0, y, armX1 - armX0, 2, RAIL);
    p.px(x0 + 3, y + 2, RAIL);
    p.px(x0 + w - 4, y + 2, RAIL);
    p.rect(x0, y + 3, w, h + 1, INK);
    p.rect(x0 + 1, y + 4, w - 2, h - 1, hex("#1d1630"));
    p.rect(x0 + 1, y + 4, w - 2, 1, c);
    p.rect(x0 + 1, y + 2 + h, w - 2, 1, c);
    [...o.word].forEach((ch, i) => p.text(ch, x0 + w / 2, y + 7 + i * 7, c, { align: "center" }));
    p.glow(x0 + w / 2, y + 4 + h / 2, 18, o.c, 0.32 * fl);
  }
}
