// The cat: falling, steering, the canopy, and the scarf streaming in the wind.
import { clamp, lerp, ease, hex, mix } from "../vendor/pixelfx/core/index.js";
import { GLIDE, DIVE, palette, CAT_W, CAT_H, GLIDE_RING, GLIDE_SCARF, DIVE_SCARF } from "./sprites.js";
import { TUNE, PLAY_L, PLAY_R } from "./config.js";

const INK = hex("#1b1426"), LINE = hex("#3b2c40");
const CANOPY = [hex("#e0403c"), hex("#f3e7d0")], CANOPY_SHADE = [hex("#a32a35"), hex("#cdbfa8")];
const SCARF = [hex("#e0403c"), hex("#b8303a")];
const SCARF_LEN = 8;
const GAUGE = hex("#f3e7d0"), GAUGE_LOW = hex("#e0403c");

// the body's hit box around (x, y), smaller than the drawing so grazes feel fair
const HIT = { x0: -7, x1: 7, y0: -3, y1: 5 };

export class Cat {
  constructor(coat) {
    this.setCoat(coat);
    this.reset(0, 0);
  }
  setCoat(coat) {
    this.coat = coat;
    this.pal = palette(coat);
  }
  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.open = 0; // 0 packed .. 1 fully open
    this.facing = 1; // 1 right, -1 left (the sprite is drawn facing left)
    this.t = 0;
    this.blink = 2;
    this.standing = true;
    this.canopy = 1; // gauge: 1 full .. 0 spent
    this.spent = false; // ran dry: stays packed until refilled to TUNE.canopyReopen
    this.justSpent = false;
    this.scarf = Array.from({ length: SCARF_LEN }, () => ({ x, y }));
  }

  /** k: 0 at the top, 1 at the deepest difficulty. */
  update(dt, input, k) {
    this.t += dt;
    if (this.standing) {
      this.vx = this.vy = 0;
      this.updateScarf(dt);
      return;
    }
    this.justSpent = false;
    const want = input.hold && !this.spent;
    this.open = clamp(this.open + (want ? dt / TUNE.openTime : -dt / TUNE.closeTime));
    if (this.open > 0.5) {
      this.canopy -= TUNE.canopyDrain * dt;
      if (this.canopy <= 0) {
        this.canopy = 0;
        this.spent = this.justSpent = true;
      }
    } else {
      this.canopy = Math.min(1, this.canopy + TUNE.canopyRefill * dt);
      if (this.spent && this.canopy >= TUNE.canopyReopen) this.spent = false;
    }

    // falling: gravity up to the dive speed, or the canopy braking down to its own
    const dive = lerp(TUNE.diveSpeed, TUNE.diveSpeedDeep, k);
    const target = lerp(dive, TUNE.chuteSpeed, ease.outQuad(this.open));
    if (this.vy < target) this.vy = Math.min(target, this.vy + TUNE.gravity * dt);
    else this.vy += (target - this.vy) * Math.min(1, TUNE.chuteDrag * dt);

    // steering
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) {
      this.facing = dir;
      const max = TUNE.moveSpeed * lerp(1, TUNE.chuteSteer, this.open);
      this.vx = clamp(this.vx + dir * TUNE.moveAccel * dt, -max, max);
    } else {
      const b = TUNE.moveBrake * dt;
      this.vx = Math.abs(this.vx) <= b ? 0 : this.vx - Math.sign(this.vx) * b;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const lo = PLAY_L - HIT.x0 + 1, hi = PLAY_R - HIT.x1 - 1;
    if (this.x < lo) { this.x = lo; this.vx = 0; }
    if (this.x > hi) { this.x = hi; this.vx = 0; }

    this.blink -= dt;
    if (this.blink < -0.12) this.blink = 1.5 + ((this.t * 7919) % 2.5);
    this.updateScarf(dt);
  }

  get diving() {
    return !this.standing && this.open < 0.25;
  }

  hitbox() {
    return { x0: this.x + HIT.x0, x1: this.x + HIT.x1, y0: this.y + HIT.y0, y1: this.y + HIT.y1 };
  }

  // the sprite's top-left, and a point of the sprite in world space (mirrored when facing right)
  get left() { return Math.round(this.x - CAT_W / 2); }
  get top() { return Math.round(this.y - CAT_H / 2); }
  at([px, py]) {
    const flip = this.facing > 0;
    return [this.left + (flip ? CAT_W - 1 - px : px), this.top + py];
  }

  updateScarf(dt) {
    // the loose end points back along the wind (the opposite way to the cat's motion), with a flutter that
    // grows with speed; at rest it droops
    const [ax, ay] = this.at(this.open > 0.5 || this.standing ? GLIDE_SCARF : DIVE_SCARF);
    const speed = Math.hypot(this.vx, this.vy);
    const fx = -this.vx - this.facing * 22, fy = -this.vy + (this.standing ? 40 : 22);
    const base = Math.atan2(fy, fx), flutter = 0.12 + 0.5 * clamp(speed / 220);
    let x = ax + 0.5, y = ay + 0.5;
    this.scarf[0].x = x;
    this.scarf[0].y = y;
    for (let i = 1; i < SCARF_LEN; i++) {
      const a = base + Math.sin(this.t * (8 + speed * 0.05) - i * 0.9) * flutter * (i / SCARF_LEN);
      x += Math.cos(a) * 2;
      y += Math.sin(a) * 2;
      // ease each point towards its target so it trails a little when turning
      const s = this.scarf[i], k = Math.min(1, dt * 30);
      s.x += (x - s.x) * k;
      s.y += (y - s.y) * k;
      x = s.x;
      y = s.y;
    }
  }

  draw(p, camY) {
    const flip = this.facing > 0;
    const sy = (wy) => Math.round(wy - camY);
    // scarf behind the body
    for (let i = SCARF_LEN - 1; i >= 1; i--) {
      const a = this.scarf[i - 1], b = this.scarf[i], c = SCARF[i % 2];
      const x0 = Math.round(a.x), y0 = sy(a.y), x1 = Math.round(b.x), y1 = sy(b.y);
      p.line(x0, y0, x1, y1, c);
      // two pixels wide until the frayed tip
      if (i < SCARF_LEN - 2) p.line(x0 + 1, y0, x1 + 1, y1, c);
    }
    const ring = this.at(GLIDE_RING);
    if (this.open > 0.02) this.drawCanopy(p, ring[0], sy(ring[1]));

    let rows;
    if (this.open > 0.5 || this.standing) {
      const swing = Math.floor(this.t * 3) % 2 && !this.standing && Math.abs(this.vx) > 20 ? 1 : 0;
      rows = this.blink < 0 ? GLIDE[2] : GLIDE[swing];
    } else rows = DIVE[Math.floor(this.t * 14) % 2];
    p.sprite(rows, this.pal, this.left, sy(this.top), { flip });
    if (!this.standing && this.canopy < 0.999) this.drawGauge(p, sy(this.top) - 5);
  }

  // the canopy gauge, a small bar over the cat while it isn't full
  drawGauge(p, y) {
    const w = 16, x = Math.round(this.x - w / 2), fill = Math.round((w - 2) * this.canopy);
    const c = this.spent ? (Math.floor(this.t * 10) % 2 ? GAUGE_LOW : INK) : this.canopy < 0.3 ? GAUGE_LOW : GAUGE;
    p.rect(x, y, w, 3, INK);
    p.rect(x + 1, y + 1, fill, 1, c);
  }

  drawCanopy(p, rx, ry) {
    const e = ease.outBack(this.open), lag = clamp(-this.vx * 0.06, -6, 6);
    const hw = Math.round(3 + 14 * e), hh = 2 + 8 * e;
    const cx = rx + Math.round(lag), cy = ry - Math.round(8 + 14 * e);
    const breathe = Math.sin(this.t * 5) * 0.6 * this.open;
    // lines first, so the canopy sits on top of them
    const bottom = (dx) => cy + 1 + Math.round(Math.abs(Math.sin(((dx + hw) / (2 * hw)) * Math.PI * 3)) * 1.5);
    for (const dx of [-hw, -Math.round(hw / 3), Math.round(hw / 3), hw]) p.line(cx + dx, bottom(dx), rx, ry, LINE);
    const panels = 5;
    for (let dx = -hw; dx <= hw; dx++) {
      const u = dx / (hw + 0.5), top = Math.round(cy - (hh + breathe) * Math.sqrt(Math.max(0, 1 - u * u)));
      const bot = bottom(dx), panel = Math.floor(((dx + hw) / (2 * hw + 1)) * panels) % 2;
      for (let y = top; y <= bot; y++) {
        let c = y === top || y === bot || dx === -hw || dx === hw ? INK : CANOPY[panel];
        // shade the right and the underside
        if (c !== INK && (y >= bot - 1 || u > 0.55)) c = CANOPY_SHADE[panel];
        if (c !== INK && y === top + 1 && u < 0.2) c = mix(c, 0xffffffff, 0.4);
        p.px(cx + dx, y, c);
      }
    }
  }
}
