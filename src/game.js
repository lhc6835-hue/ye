// The game: title, the fall, scoring, and the crash.
import "./font.js";
import { createFrame, painterFor, composite, createFx, hex, clamp, lerp, mix, PAL, Rng } from "../vendor/pixelfx/core/index.js";
import * as poofFx from "../vendor/pixelfx/fx/spawn/poof.js";
import * as collectFx from "../vendor/pixelfx/fx/pickups/collect-burst.js";
import * as comboFx from "../vendor/pixelfx/fx/ui/combo-counter.js";
import * as featherFx from "../vendor/pixelfx/fx/holy/feather-burst.js";
import { W, H, PLAY_L, PX_PER_M, TUNE } from "./config.js";
import { Cat } from "./cat.js";
import { World, overlap } from "./world.js";
import { COATS } from "./sprites.js";
import { sfx, setWind, isMuted } from "./audio.js";

const STREAK = hex("#8a82b0");
const INK = hex("#1b1426"), WHITE = hex("#ffffff"), SOFT = hex("#cfc8e8"), GOLD = hex("#ffd24a"), PINK = hex("#ff6fae");
const MULT_COLORS = ["#cfc8e8", "#cfc8e8", "#8ff0ff", "#9cff8a", "#ffe066", "#ffb04a", "#ff7a5a", "#ff5fa2", "#d27aff", "#ffffff"].map(hex);
const COAT_ORDER = Object.keys(COATS);
const START_X = PLAY_L + 40, START_Y = -7;

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("catchute." + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("catchute." + k, JSON.stringify(v));
    } catch {}
  },
};

/** Darken everything drawn so far by k, and switch the glow off inside a box (a panel goes there). */
function dim(f, k, [bx, by, bw, bh]) {
  const C = f.color, L = f.light;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x, c = C[i];
      C[i] = (c & 0xff000000) | (((((c >>> 16) & 255) * k) | 0) << 16) | (((((c >>> 8) & 255) * k) | 0) << 8) | (((c & 255) * k) | 0);
      L[i] = x >= bx && x < bx + bw && y >= by && y < by + bh ? 0 : L[i];
    }
}

export class Game {
  constructor() {
    this.frame = createFrame(W, H);
    this.img = new ImageData(W, H);
    this.best = store.get("best", 0);
    this.coat = COAT_ORDER.includes(store.get("coat")) ? store.get("coat") : "ginger";
    this.runs = 0;
    this.reset();
  }

  reset() {
    this.seed = (Date.now() ^ (this.runs * 0x9e3779b1)) >>> 0;
    this.rng = new Rng(this.seed);
    this.world = new World(this.seed);
    this.cat = new Cat(this.coat);
    this.cat.reset(START_X, START_Y);
    this.state = "title";
    this.camOff = 96;
    this.camY = this.cat.y - this.camOff;
    this.score = 0;
    this.mult = 1;
    this.diveT = 0;
    this.lastY = this.cat.y;
    this.maxDepth = 0;
    this.fx = []; // { fx, wx, wy, hud }
    this.pops = []; // floating text
    this.lines = []; // wind streaks
    this.shake = 0;
    this.freeze = 0;
    this.deadT = 0;
    this.t = 0;
    this.newBest = false;
  }

  start() {
    this.state = "play";
    this.runs++;
    this.cat.standing = false;
    this.cat.vy = -80;
    this.cat.vx = 55;
    this.cat.facing = 1;
    sfx.jump();
  }

  get depth() {
    return Math.max(0, this.cat.y) / PX_PER_M;
  }

  cycleCoat(d) {
    const i = (COAT_ORDER.indexOf(this.coat) + d + COAT_ORDER.length) % COAT_ORDER.length;
    this.coat = COAT_ORDER[i];
    this.cat.setCoat(this.coat);
    store.set("coat", this.coat);
    sfx.pickup();
  }

  addFx(mod, opts, wx, wy, hud = false) {
    this.fx.push({ fx: createFx(mod, { x: wx, y: hud ? wy : 0, ...opts }), wx, wy, hud });
  }
  pop(text, wx, wy, c = WHITE, big = false) {
    this.pops.push({ text, x: wx, y: wy, c, big, t: 0 });
  }

  update(dt, input) {
    this.t += dt;
    for (const f of this.fx) f.fx.update(dt);
    this.fx = this.fx.filter((f) => !f.fx.done());
    for (const q of this.pops) q.t += dt;
    this.pops = this.pops.filter((q) => q.t < 0.9);
    this.shake = Math.max(0, this.shake - dt * 14);
    if (this.freeze > 0) {
      this.freeze -= dt;
      return;
    }
    const cat = this.cat;

    if (this.state === "title") {
      if (input.leftPressed) this.cycleCoat(-1);
      if (input.rightPressed) this.cycleCoat(1);
      if (input.pressed) this.start();
      cat.update(dt, input, 0);
      return;
    }

    if (this.state === "dead") {
      this.deadT += dt;
      this.world.update(dt, this.camY);
      if (input.leftPressed) this.cycleCoat(-1);
      if (input.rightPressed) this.cycleCoat(1);
      if (this.deadT > 0.45 && (input.pressed || input.retry)) {
        this.reset();
        this.start();
      }
      return;
    }

    // ---- falling
    const k = this.world.hardness(cat.y), wasOpen = cat.open > 0.5;
    cat.update(dt, input, k);
    if (!wasOpen && cat.open > 0.5) sfx.chute();
    if (wasOpen && cat.open <= 0.5) sfx.close();

    // the dive multiplier: grows while the canopy stays packed, gone the moment it opens
    if (cat.diving && cat.vy > 60) {
      this.diveT += dt;
      const m = Math.min(TUNE.multMax, 1 + Math.floor(this.diveT / TUNE.multEvery));
      if (m > this.mult) {
        this.mult = m;
        this.fx = this.fx.filter((f) => f.fx.meta !== comboFx.meta);
        this.addFx(comboFx, { count: m, label: "DIVE", palette: m >= 6 ? PAL.fire : m >= 4 ? PAL.gold : PAL.ice }, W / 2, 42, true);
        sfx.mult(m);
      }
    } else if (cat.open > 0.6) {
      if (this.mult > 1) {
        sfx.multLost();
        for (const f of this.fx) if (f.fx.meta === comboFx.meta) f.fx.stop();
        this.pop("x1", cat.x, cat.y - 22, SOFT);
      }
      this.mult = 1;
      this.diveT = 0;
    }

    const dy = Math.max(0, cat.y - this.lastY);
    this.lastY = Math.max(this.lastY, cat.y);
    this.score += (dy / PX_PER_M) * this.mult;
    this.maxDepth = Math.max(this.maxDepth, this.depth);

    this.world.spawnUntil(this.camY + H + 140);
    this.world.update(dt, this.camY);

    // crashes, close calls, fish
    const hb = cat.hitbox();
    for (const o of this.world.obs) {
      for (const r of o.rects)
        if (overlap(hb, r)) {
          this.die(o);
          return;
        }
      if (!o.passed && hb.y0 > o.bottom) {
        o.passed = true;
        let gap = Infinity;
        for (const r of o.rects) gap = Math.min(gap, Math.max(r.x0 - hb.x1, hb.x0 - r.x1));
        if (cat.diving && gap < 7) {
          const pts = 20 * this.mult;
          this.score += pts;
          this.pop("CLOSE! +" + pts, cat.x, cat.y - 16, GOLD);
          sfx.near();
          this.shake = Math.max(this.shake, 1.2);
        }
      }
    }
    for (const f of this.world.fish)
      if (!f.taken && Math.abs(f.x - cat.x) < 11 && Math.abs(f.y - cat.y) < 9) {
        f.taken = true;
        const pts = 50 * this.mult;
        this.score += pts;
        this.pop("+" + pts, f.x, f.y - 10, hex("#8fd0ff"));
        this.addFx(collectFx, { palette: PAL.ice, seed: this.rng.int(1, 999) }, f.x, f.y + 30);
        sfx.pickup();
      }

    // the camera looks further ahead the faster we fall
    const want = lerp(112, 78, clamp((cat.vy - 40) / 200));
    this.camOff += (want - this.camOff) * Math.min(1, dt * 3);
    this.camY = cat.y - this.camOff;

    setWind(clamp((cat.vy - 40) / 240));
    this.updateLines(dt);
  }

  updateLines(dt) {
    const v = this.cat.vy, R = this.rng;
    if (v > 110 && R.chance(clamp((v - 110) / 140) * dt * 40)) this.lines.push({ x: R.int(PLAY_L + 2, W - PLAY_L - 2), y: H + 4, len: R.int(6, 18) });
    for (const l of this.lines) l.y -= Math.max(v, 220) * 1.6 * dt;
    this.lines = this.lines.filter((l) => l.y + l.len > 0);
  }

  die(o) {
    const cat = this.cat;
    this.state = "dead";
    this.deadT = 0;
    this.freeze = 0.16;
    this.shake = 5;
    sfx.hit();
    setWind(0);
    this.addFx(poofFx, { seed: this.rng.int(1, 999) }, cat.x, cat.y + 10);
    if (o.type === "bird") this.addFx(featherFx, { seed: this.rng.int(1, 999) }, o.x, o.y);
    const s = Math.floor(this.score);
    if (s > this.best) {
      this.best = s;
      this.newBest = this.runs > 0;
      store.set("best", s);
      setTimeout(() => sfx.best(), 450);
    }
  }

  // ---- drawing

  draw(ctx) {
    const f = this.frame, cam = Math.round(this.camY);
    f.light.fill(0);
    this.world.drawBackdrop(f, cam);
    const p = painterFor(f);
    this.world.drawLights(p, cam);
    this.world.drawStart(p, cam);
    for (const l of this.lines) p.line(l.x, l.y, l.x, l.y + l.len, STREAK);
    this.world.draw(p, cam);
    p.reset();
    if (this.state !== "dead" || this.freeze > 0) this.cat.draw(p, cam);
    for (const e of this.fx) {
      if (e.hud) continue;
      e.fx.options.x = Math.round(e.wx);
      e.fx.options.y = Math.round(e.wy - cam);
      e.fx.draw(f);
    }
    p.reset();
    for (const q of this.pops)
      p.text(q.text, q.x, q.y - cam - q.t * 22, q.c, { align: "center", outline: INK, font: q.big ? "big" : "mini" });

    if (this.state === "title") this.drawTitle(p);
    else this.drawHud(p);
    for (const e of this.fx) if (e.hud) e.fx.draw(f);
    p.reset();
    if (this.state === "dead" && this.deadT > 0.3) this.drawResult(p);

    composite(f, this.img.data, INK);
    const s = this.shake, sx = s ? Math.round((Math.random() * 2 - 1) * s) : 0, sy = s ? Math.round((Math.random() * 2 - 1) * s) : 0;
    if (s) {
      ctx.fillStyle = "#1b1426";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.putImageData(this.img, sx, sy);
  }

  drawHud(p) {
    p.text(String(Math.floor(this.score)), 6, 6, WHITE, { font: "big", outline: INK });
    p.text(Math.floor(this.depth) + "M", 6, 17, SOFT, { outline: INK });
    const m = this.mult, c = MULT_COLORS[m];
    p.text("x" + m, W - 6, 6, c, { font: "big", align: "right", outline: INK });
    // progress to the next step
    if (m < TUNE.multMax) {
      const u = this.cat.diving ? (this.diveT % TUNE.multEvery) / TUNE.multEvery : 0;
      p.rect(W - 31, 16, 26, 3, INK);
      p.rect(W - 30, 17, Math.round(24 * u), 1, c);
    }
    if (this.depth < 30 && this.state === "play") {
      p.text("HOLD MOUSE: CHUTE", W / 2, H - 30, WHITE, { align: "center", outline: INK });
      p.text("A D: MOVE", W / 2, H - 22, SOFT, { align: "center", outline: INK });
    }
  }

  drawTitle(p) {
    const bob = Math.round(Math.sin(this.t * 2) * 1.5);
    p.text("CATCHUTE", W / 2, 148 + bob, GOLD, { font: "big", scale: 2, align: "center", outline: INK, shadow: hex("#8e1d2e") });
    if (Math.floor(this.t * 2) % 2 === 0) p.text("CLICK TO JUMP", W / 2, 178, WHITE, { align: "center", outline: INK });
    p.text("HOLD MOUSE: OPEN CHUTE", W / 2, 198, SOFT, { align: "center", outline: INK });
    p.text("LET GO: DIVE FAST", W / 2, 206, SOFT, { align: "center", outline: INK });
    p.text("A D OR ARROWS: MOVE", W / 2, 214, SOFT, { align: "center", outline: INK });
    p.text("DIVE LONGER = BIGGER x", W / 2, 228, GOLD, { align: "center", outline: INK });
    p.text("< " + COATS[this.coat].name + " >", W / 2, 248, WHITE, { align: "center", outline: INK });
    p.text("A D: CHANGE CAT", W / 2, 256, SOFT, { align: "center", outline: INK });
    if (this.best > 0) p.text("BEST " + this.best, W / 2, 274, GOLD, { align: "center", outline: INK });
    p.text(isMuted() ? "M: SOUND OFF" : "M: SOUND ON", W / 2, H - 10, SOFT, { align: "center", outline: INK });
  }

  drawResult(p) {
    const x0 = 24, y0 = 104, w = W - 48, h = 112;
    dim(this.frame, 1 - 0.45 * clamp((this.deadT - 0.3) / 0.2), [x0 - 1, y0 - 1, w + 2, h + 2]);
    p.rect(x0 - 1, y0 - 1, w + 2, h + 2, INK);
    p.rect(x0, y0, w, h, hex("#2a2142"));
    p.rect(x0, y0, w, 1, hex("#53477c"));
    p.text("OOPS!", W / 2, y0 + 10, PINK, { font: "big", scale: 2, align: "center", outline: INK });
    p.text("SCORE", x0 + 12, y0 + 40, SOFT);
    p.text(String(Math.floor(this.score)), x0 + w - 12, y0 + 38, WHITE, { font: "big", align: "right" });
    p.text("DEPTH", x0 + 12, y0 + 54, SOFT);
    p.text(Math.floor(this.maxDepth) + "M", x0 + w - 12, y0 + 54, WHITE, { align: "right" });
    p.text("BEST", x0 + 12, y0 + 66, SOFT);
    p.text(String(this.best), x0 + w - 12, y0 + 66, GOLD, { align: "right" });
    if (this.newBest && Math.floor(this.t * 4) % 2 === 0) p.text("NEW BEST!", W / 2, y0 + 80, GOLD, { align: "center", outline: INK });
    if (this.deadT > 0.45) p.text("CLICK TO RETRY", W / 2, y0 + 96, Math.sin(this.t * 6) > -0.3 ? WHITE : SOFT, { align: "center" });
    p.text("< " + COATS[this.coat].name + " >", W / 2, y0 + h + 10, SOFT, { align: "center", outline: INK });
  }
}
