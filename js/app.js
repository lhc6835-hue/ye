/* PIXEL ARCADE hub. Reads data/games.json and renders the floor.
   Effects are the custom ones in tools/pixelfx/src/fx/arcade, bundled into js/fx.bundle.js. */
(() => {
  "use strict";

  // ---------------------------------------------------------------- constants
  const STATUS = {
    release: { label: "RELEASE", ko: "정식 출시", color: "var(--st-release)", hex: "#ffc626", sprite: "badge-release", order: 0,
      desc: "누구나 끝까지 즐길 수 있는 완성 버전. 이후엔 버그 수정과 추가 콘텐츠 업데이트가 이어져요." },
    beta: { label: "BETA", ko: "베타 테스트", color: "var(--st-beta)", hex: "#4ce8d8", sprite: "badge-beta", order: 1,
      desc: "콘텐츠는 거의 다 들어갔고 다듬는 중. 플레이해보고 피드백을 주면 가장 큰 도움이 되는 단계예요." },
    alpha: { label: "ALPHA", ko: "알파", color: "var(--st-alpha)", hex: "#f53cd1", sprite: "badge-alpha", order: 2,
      desc: "핵심 플레이는 돌아가지만 기능과 밸런스가 크게 바뀔 수 있어요. 버그가 많을 수 있어요." },
    dev: { label: "DEV", ko: "개발 중", color: "var(--st-dev)", hex: "#ffa026", sprite: "badge-dev", order: 3,
      desc: "프로토타입이나 실험 빌드. 아이디어를 시험해보는 단계라 언제든 갈아엎을 수 있어요." },
    soon: { label: "SOON", ko: "공개 예정", color: "var(--st-soon)", hex: "#8a78e0", sprite: "badge-soon", order: 4,
      desc: "만들고 있다는 것만 공개한 상태. 곧 플레이할 수 있는 빌드가 올라와요." },
  };
  const STAGE_ORDER = ["soon", "dev", "alpha", "beta", "release"]; // the real development sequence
  const FILTERS = ["all", "release", "beta", "alpha", "dev", "soon"];
  const PLATFORM = { web: "WEB", windows: "WIN", mac: "MAC", linux: "LINUX", android: "ANDROID", ios: "iOS", switch: "SWITCH" };
  const NEW_DAYS = 14;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("arcade:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("arcade:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const st = (s) => STATUS[String(s || "").toLowerCase()] || STATUS.dev;
  const stKey = (s) => (STATUS[String(s || "").toLowerCase()] ? String(s).toLowerCase() : "dev");
  const fmtDate = (d) => (d ? String(d).replace(/-/g, ".") : "----.--.--");
  const ver = (v) => (v ? "v" + String(v).replace(/^v/i, "") : "v-.-.-");
  const pad2 = (n) => String(n).padStart(2, "0");
  const daysSince = (d) => (d ? (Date.now() - new Date(d + "T00:00:00").getTime()) / 864e5 : Infinity);
  const safeUrl = (u) => (u && /^(https?:)?\/\//i.test(u) ? u : u && /^[\w./-]+$/.test(u) && !u.includes("..") ? u : "");

  // ---------------------------------------------------------------- sound
  const Sound = {
    on: store.get("sfx", true),
    pool: {},
    bgm: null,
    bgmOn: false,
    play(name, vol = 0.5) {
      if (!this.on) return;
      try {
        let base = this.pool[name];
        if (!base) base = this.pool[name] = new Audio(`assets/sfx/${name}.mp3`);
        const a = base.cloneNode();
        a.volume = vol;
        a.play().catch(() => {});
      } catch { /* audio unavailable */ }
    },
    bgmVol: 0.22,
    setBgm(src) {
      if (!src) return;
      this.bgm = new Audio(src);
      this.bgm.loop = true;
      this.bgm.preload = "none";
      this.bgm.volume = this.bgmVol;
      // browsers only allow sound after a click: if BGM was left on last visit, resume on the first one
      if (store.get("bgm", false)) {
        const resume = (e) => { removeEventListener("pointerdown", resume); removeEventListener("keydown", resume); if (e.target?.closest?.("#bgmToggle")) return; if (!this.bgmOn) { this.toggleBgm(); syncToggles(); } };
        addEventListener("pointerdown", resume); addEventListener("keydown", resume);
      }
    },
    toggleBgm() {
      if (!this.bgm) return false;
      this.bgmOn = !this.bgmOn;
      store.set("bgm", this.bgmOn);
      if (this.bgmOn) this.bgm.play().catch(() => { this.bgmOn = false; store.set("bgm", false); syncToggles(); });
      else this.bgm.pause();
      return this.bgmOn;
    },
    duck(on) { if (this.bgm) this.bgm.volume = on ? this.bgmVol * 0.45 : this.bgmVol; },
  };

  // ---------------------------------------------------------------- sprite sheets (badges, no-signal)
  const Sprites = {
    imgs: {},
    list: new Set(),
    vis: new WeakMap(),
    io: "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => Sprites.vis.set(e.target, e.isIntersecting)), { rootMargin: "100px" }) : null,
    img(id) {
      const S = window.SPRITES?.[id];
      if (!S) return null;
      if (!this.imgs[id]) { const im = new Image(); im.src = S.src; this.imgs[id] = im; }
      return this.imgs[id];
    },
    canvas(id, cls, offset = Math.random()) {
      const S = window.SPRITES?.[id];
      const c = h("canvas", { class: cls, width: S ? S.w : 32, height: S ? S.h : 32, "aria-hidden": "true" });
      c._sp = { id, offset };
      this.img(id);
      this.list.add(c);
      this.io ? this.io.observe(c) : this.vis.set(c, true);
      return c;
    },
    forget(root) { for (const c of $$("canvas", root)) if (c._sp) { this.list.delete(c); this.io?.unobserve(c); } },
    tick(time) {
      for (const c of this.list) {
        if (!c.isConnected) { this.list.delete(c); continue; }
        if (this.vis.get(c) === false && c._f !== undefined) continue;
        const sp = c._sp, S = window.SPRITES[sp.id], im = this.imgs[sp.id];
        if (!im || !im.complete || !im.naturalWidth) continue;
        const f = REDUCED ? 0 : Math.floor((time / 1000) * S.fps + sp.offset * S.frames) % S.frames;
        if (f === c._f) continue;
        c._f = f;
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, S.w, S.h);
        ctx.drawImage(im, (f % S.cols) * S.w, Math.floor(f / S.cols) * S.h, S.w, S.h, 0, 0, S.w, S.h);
      }
    },
  };

  // ---------------------------------------------------------------- live pixel effects
  const PX = window.PixelFX;
  const Fx = {
    // the attract screen: synth horizon at 30 fps while visible
    horizon: null,
    initHorizon() {
      const cv = $("#horizon");
      if (!PX || !cv) return;
      const ctx = cv.getContext("2d"), frame = PX.createFrame(320, 180), img = new ImageData(320, 180);
      const fx = PX.createFx(PX.fx.synthHorizon, { x: 0, y: 0 });
      let visible = true, acc = 1;
      if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(cv);
      const draw = () => { PX.clearFrame(frame); fx.draw(frame); PX.composite(frame, img.data, 0xff0f0618); ctx.putImageData(img, 0, 0); };
      this.horizon = (dt) => {
        if (!visible || document.hidden) return;
        if (REDUCED) { if (!this._drawnOnce) { fx.update(1.2); draw(); this._drawnOnce = true; } return; }
        acc += dt;
        if (acc < 1 / 30) return;
        fx.update(acc); acc = 0; draw();
      };
    },

    // one-shots over the whole page, drawn at 1/S resolution and scaled up crisp
    layer: null, ctx: null, frame: null, img: null, S: 3, active: [],
    resize() {
      const cv = this.layer = this.layer || $("#fxLayer");
      this.S = innerWidth < 640 ? 2 : 3;
      const w = Math.ceil(innerWidth / this.S), hgt = Math.ceil(innerHeight / this.S);
      if (cv.width === w && cv.height === hgt) return;
      cv.width = w; cv.height = hgt;
      this.ctx = cv.getContext("2d");
      this.frame = PX.createFrame(w, hgt);
      this.img = new ImageData(w, hgt);
    },
    burst(mod, el, opts = {}) {
      if (!PX || REDUCED || !el) return;
      this.resize();
      const r = el.getBoundingClientRect();
      const x = (r.left + r.width / 2 + (opts.dx || 0)) / this.S, y = (r.top + r.height / 2 + (opts.dy || 0)) / this.S;
      this.active.push(PX.createFx(mod, { x: Math.round(x), y: Math.round(y), ...(opts.fx || {}) }));
    },
    tickLayer(dt) {
      if (!this.active.length) { if (this._dirty) { this.ctx.clearRect(0, 0, this.layer.width, this.layer.height); this._dirty = false; } return; }
      PX.clearFrame(this.frame);
      this.active = this.active.filter((f) => { f.update(dt); if (f.t >= f.meta.duration) return false; f.draw(this.frame); return true; });
      PX.composite(this.frame, this.img.data, null);
      this.ctx.putImageData(this.img, 0, 0);
      this._dirty = true;
    },

    // the CRT switching on in the detail dialog
    crt: null,
    playCrt() {
      const cv = $("#crtCanvas");
      if (!PX || REDUCED) { cv.hidden = true; return; }
      cv.hidden = false;
      const ctx = cv.getContext("2d"), frame = PX.createFrame(320, 180), img = new ImageData(320, 180);
      const fx = PX.createFx(PX.fx.crtPowerOn, { x: 0, y: 0 });
      this.crt = (dt) => {
        fx.update(dt);
        if (fx.t >= fx.meta.duration) { ctx.clearRect(0, 0, 320, 180); cv.hidden = true; this.crt = null; return; }
        PX.clearFrame(frame); fx.draw(frame); PX.composite(frame, img.data, null); ctx.putImageData(img, 0, 0);
      };
    },
  };

  // ---------------------------------------------------------------- state
  let DATA = { site: {}, games: [] };
  const state = { filter: store.get("filter", "all"), q: "", sort: store.get("sort", "updated"), credits: 0, sel: -1, notesShown: 6 };
  if (!FILTERS.includes(state.filter)) state.filter = "all";

  // ---------------------------------------------------------------- toast
  let toastT = 0;
  function toast(head, msg) {
    const t = $("#toast");
    t.replaceChildren(h("b", { text: head }), msg);
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------------------------------------------------------------- site text
  function renderSite() {
    const s = DATA.site || {};
    document.title = s.name || "PIXEL ARCADE";
    for (const el of $$("[data-site]")) {
      const v = s[el.dataset.site];
      if (v) el.textContent = v;
    }
    $("#year").textContent = new Date().getFullYear();
    const L = s.links || {};
    const list = $("#devLinks");
    const rows = [["GITHUB", L.github], ["ITCH.IO", L.itch], ["BLOG", L.blog]];
    list.replaceChildren(...[...rows.map(([k, u]) => h("li", {}, safeUrl(u) ? h("a", { href: safeUrl(u), target: "_blank", rel: "noopener", text: k }) : h("span", { class: "off", text: k + " · 준비 중" }))),
      L.email ? h("li", {}, h("span", { class: "off", text: "MAIL" }), " ", h("span", { class: "mail", text: L.email })) : null].filter(Boolean));
    Sound.setBgm(safeUrl(s.bgm));
    $("#bgmToggle").disabled = !Sound.bgm;
    $("#bgmToggle").title = Sound.bgm ? "배경음악" : "배경음악 파일이 아직 없어요";
  }

  // ---------------------------------------------------------------- board + ticker + now showing
  const sortedByUpdate = () => [...DATA.games].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  function renderBoard() {
    const G = DATA.games, n = (k) => G.filter((g) => stKey(g.status) === k).length;
    $("#boardList").replaceChildren(...["release", "beta", "alpha", "dev", "soon"].map((k, i) =>
      h("li", { style: `--c:${STATUS[k].color}` }, Sprites.canvas(STATUS[k].sprite, "", i * 0.17), h("span", { class: "nm", text: STATUS[k].label }), h("span", { class: "ct", text: pad2(n(k)) }))));
    $("#totalCount").textContent = pad2(G.length);
    $("#hiCount").textContent = pad2(G.length);
    const last = sortedByUpdate()[0];
    $("#hiDate").textContent = fmtDate(last?.updated);
    $("#boardMeta").replaceChildren(
      h("span", {}, "LAST UPDATE ", h("b", { text: fmtDate(last?.updated) })),
      h("span", {}, "LATEST ", h("b", { text: last ? `${last.title} ${last.version ? ver(last.version) : "TBA"}` : "-" })));
  }
  function renderTicker() {
    const items = [];
    for (const g of DATA.games) for (const c of g.changelog || []) items.push({ g, c });
    items.sort((a, b) => String(b.c.date).localeCompare(String(a.c.date)));
    const run = $("#tickerRun");
    const spans = items.slice(0, 8).map(({ g, c }) => h("span", {}, h("em", { text: fmtDate(c.date) }), "  ", h("b", { text: g.title }), ` ${ver(c.version)} · ${(c.notes || []).join(" / ")}`));
    if (!spans.length) spans.push(h("span", { text: "아직 소식이 없어요. 첫 게임을 기다리는 중!" }));
    run.replaceChildren(...spans);
    run.style.animationDuration = Math.max(20, spans.length * 9) + "s";
  }
  let nsIdx = 0, nsTimer = 0;
  function featured() { const f = DATA.games.filter((g) => g.featured); return f.length ? f : DATA.games.slice(0, 3); }
  function renderNowShowing() {
    const list = featured(), box = $("#nowShowing");
    if (!list.length) { box.querySelector(".ttl").textContent = "COMING SOON"; return; }
    const g = list[nsIdx % list.length], S = st(g.status);
    box.replaceChildren(h("span", { class: "lbl", text: "NOW SHOWING" }), h("span", { class: "ttl", text: g.title }),
      h("span", { class: "tag", style: `color:${S.color};box-shadow:inset 0 0 0 1px ${S.color}`, text: S.label }), h("span", { class: "tag", text: ver(g.version) }));
    box.classList.remove("swap"); void box.offsetWidth; box.classList.add("swap");
    clearInterval(nsTimer);
    nsTimer = setInterval(() => { nsIdx++; renderNowShowing(); }, 5000);
  }

  // ---------------------------------------------------------------- filters + grid
  function renderChips() {
    const count = (f) => (f === "all" ? DATA.games.length : DATA.games.filter((g) => stKey(g.status) === f).length);
    $("#chips").replaceChildren(...FILTERS.map((f) =>
      h("button", { class: "chip", "data-f": f, "aria-pressed": String(state.filter === f), style: f === "all" ? "" : `--c:${STATUS[f].color}`,
        onclick: () => { state.filter = f; store.set("filter", f); Sound.play("filter", 0.4); renderChips(); renderGrid(); } },
        f === "all" ? null : h("i"), f === "all" ? "ALL" : STATUS[f].label, h("span", { class: "n", text: pad2(count(f)) }))));
  }
  function visibleGames() {
    const q = state.q.trim().toLowerCase();
    let list = DATA.games.filter((g) => state.filter === "all" || stKey(g.status) === state.filter);
    if (q) list = list.filter((g) => [g.title, g.subtitle, g.description, ...(g.genre || []), st(g.status).label, st(g.status).ko].join(" ").toLowerCase().includes(q));
    const by = {
      updated: (a, b) => String(b.updated || "").localeCompare(String(a.updated || "")),
      status: (a, b) => st(a.status).order - st(b.status).order || String(b.updated || "").localeCompare(String(a.updated || "")),
      title: (a, b) => String(a.title).localeCompare(String(b.title), "ko"),
    }[state.sort] || (() => 0);
    return list.sort(by);
  }
  function screenFor(g, cls) {
    const cover = safeUrl(g.cover);
    if (cover) return h("img", { src: cover, alt: `${g.title} 화면`, loading: "lazy", class: cls });
    return Sprites.canvas("no-signal", cls, (g.id || "").length * 0.13);
  }
  function card(g, i) {
    const S = st(g.status), play = safeUrl(g.links?.play);
    const isNew = daysSince(g.updated) <= NEW_DAYS;
    const el = h("article", { class: "card px-cut", style: `--c:${g.color || S.hex}`, tabindex: "0", "data-i": i, "aria-label": `${g.title}, ${S.ko}, ${ver(g.version)}` },
      h("div", { class: "card-marquee" }, h("h3", { text: g.title })),
      h("div", { class: "card-screen" },
        screenFor(g),
        h("span", { class: "st", style: `--c:${S.color}` }, Sprites.canvas(S.sprite, "", i * 0.21), S.label),
        isNew ? h("span", { class: "new-flag", text: "NEW" }) : null,
        h("span", { class: "ver", text: g.status === "soon" && !g.version ? "TBA" : ver(g.version) })),
      h("div", { class: "card-body" },
        g.subtitle ? h("span", { class: "sub", text: g.subtitle }) : null,
        h("p", { text: g.description || "" }),
        h("div", { class: "tags" }, ...(g.platforms || []).map((p) => h("span", { class: "tag plat", text: PLATFORM[p] || String(p).toUpperCase() })), ...(g.genre || []).map((x) => h("span", { class: "tag", text: x }))),
        h("div", { class: "card-meta" }, h("span", { text: g.players || "" }), h("span", { text: "UPD " + fmtDate(g.updated) }))),
      h("div", { class: "card-deck" },
        h("button", { class: "btn", "data-act": "info", text: "INFO" }),
        play ? h("a", { class: "btn primary", href: play, target: "_blank", rel: "noopener", "data-act": "play" }, "▶ PLAY")
             : h("button", { class: "btn locked", "data-act": "locked", "aria-disabled": "true" }, g.status === "soon" ? "SOON" : "준비 중")));
    el.addEventListener("mouseenter", () => { if (state.sel !== i) Sound.play("hover", 0.25); select(i, false); });
    el.addEventListener("focus", () => select(i, false));
    el.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "play") { Fx.burst(PX.fx.pressStart, e.target.closest("a")); Sound.play("start", 0.5); return; }
      if (act === "locked") { Sound.play("denied", 0.5); toast("LOCKED", `${g.title}의 플레이 링크는 아직 준비 중이에요.`); return; }
      openDetail(g);
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === el) { e.preventDefault(); openDetail(g); } });
    return el;
  }
  function renderGrid() {
    const grid = $("#grid"), list = visibleGames();
    Sprites.forget(grid);
    state.sel = -1;
    const none = !DATA.games.length;
    grid.replaceChildren(...(list.length ? list.map(card) : [h("div", { class: "empty" },
      Sprites.canvas("no-signal", "empty-screen"),
      h("b", { text: none ? "NOW LOADING..." : "NO GAME FOUND" }),
      h("span", { text: none ? "아직 올라온 게임이 없어요. 첫 게임이 곧 들어와요!" : "조건에 맞는 게임이 없어요. 필터나 검색어를 바꿔보세요." }))]));
    $("#resultLine").textContent = `${pad2(list.length)} / ${pad2(DATA.games.length)} GAMES`;
  }
  function select(i, scroll = true) {
    const cards = $$("#grid .card");
    if (!cards.length) return;
    i = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => c.classList.toggle("sel", k === i));
    state.sel = i;
    if (scroll) { cards[i].focus({ preventScroll: true }); cards[i].scrollIntoView({ block: "nearest", behavior: REDUCED ? "auto" : "smooth" }); }
  }
  function gridCols() {
    const cards = $$("#grid .card");
    if (cards.length < 2) return 1;
    const top = cards[0].offsetTop;
    const n = cards.findIndex((c) => c.offsetTop !== top);
    return n < 0 ? cards.length : n;
  }

  // ---------------------------------------------------------------- patch notes + stages
  function renderNotes() {
    const items = [];
    for (const g of DATA.games) for (const c of g.changelog || []) items.push({ g, c });
    items.sort((a, b) => String(b.c.date).localeCompare(String(a.c.date)));
    const shown = items.slice(0, state.notesShown);
    $("#timeline").replaceChildren(...(shown.length ? shown.map(({ g, c }) => {
      const S = st(c.status || g.status);
      return h("li", { style: `--c:${S.color}` },
        h("span", { class: "when", text: fmtDate(c.date) }), h("span", { class: "rail" }),
        h("div", { class: "what" },
          h("header", {}, h("h3", {}, h("button", { onclick: () => openDetail(g), text: g.title })), h("span", { class: "v", text: `${ver(c.version)} · ${S.label}` })),
          h("ul", {}, ...(c.notes || []).map((n) => h("li", { text: n })))));
    }) : [h("li", {}, h("span"), h("span"), h("div", { class: "what", text: "아직 기록이 없어요." }))]));
    const more = $("#moreNotes");
    more.hidden = items.length <= state.notesShown;
    more.onclick = () => { state.notesShown += 6; Sound.play("tick", 0.4); renderNotes(); };
    const last = items[0];
    $("#latestBuild").replaceChildren(
      h("dt", { text: "GAME" }), h("dd", { text: last ? last.g.title : "-" }),
      h("dt", { text: "BUILD" }), h("dd", { text: last ? ver(last.c.version) : "-" }),
      h("dt", { text: "DATE" }), h("dd", { text: last ? fmtDate(last.c.date) : "-" }),
      h("dt", { text: "LOGS" }), h("dd", { text: pad2(items.length) + " 건" }));
  }
  function renderStages() {
    $("#stageList").replaceChildren(...STAGE_ORDER.map((k, i) => {
      const S = STATUS[k], n = DATA.games.filter((g) => stKey(g.status) === k).length;
      return h("li", { class: "stage", style: `--c:${S.color}` },
        h("div", { class: "top" }, h("span", { class: "num" }), Sprites.canvas(S.sprite, "", i * 0.2)),
        h("h3", { text: S.label }), h("span", { class: "ko", text: S.ko }), h("p", { text: S.desc }),
        h("span", { class: "cnt" }, "이 단계 게임 ", h("b", { text: pad2(n) })));
    }));
  }

  // ---------------------------------------------------------------- detail dialog
  const dlg = $("#detail");
  let current = null;
  function openDetail(g, viaHash = false) {
    current = g;
    const S = st(g.status);
    dlg.style.setProperty("--c", g.color || S.hex);
    $("#dlgId").textContent = (g.id || "").toUpperCase();
    // screen
    const scr = $("#dlgScreen");
    Sprites.forget(scr);
    for (const n of [...scr.children]) if (!n.classList.contains("crt") && !n.classList.contains("crt-glass")) n.remove();
    scr.prepend(screenFor(g));
    // controls
    const K = g.controls || [];
    $("#dlgKeys").replaceChildren(...(K.length ? [h("h4", { text: "HOW TO PLAY" }), h("ul", {}, ...K.map(([k, v]) => h("li", {}, ...String(k).split(/\s+/).map((x) => h("kbd", { text: x })), v)))] : []));
    // right column
    $("#dlgStatus").replaceChildren(Sprites.canvas(S.sprite, ""), h("span", { class: "lbl", style: `--c:${S.color}` }, h("b", { text: S.label }), h("span", { text: `${S.ko} · ${g.status === "soon" && !g.version ? "버전 미정" : ver(g.version)}` })));
    $("#dlgStatus").style.setProperty("--c", S.color);
    $("#dlgTitle").textContent = g.title;
    $("#dlgSub").textContent = g.subtitle || "";
    $("#dlgDesc").textContent = g.description || "";
    const plats = (g.platforms || []).map((p) => PLATFORM[p] || p).join(" · ");
    $("#dlgSpec").replaceChildren(
      h("dt", { text: "GENRE" }), h("dd", { text: (g.genre || []).join(", ") || "-" }),
      h("dt", { text: "PLATFORM" }), h("dd", { text: plats || "-" }),
      h("dt", { text: "PLAYERS" }), h("dd", { text: g.players || "-" }),
      h("dt", { text: "RELEASED" }), h("dd", { text: g.released ? fmtDate(g.released) : "미출시" }),
      h("dt", { text: "UPDATED" }), h("dd", { text: fmtDate(g.updated) }));
    const L = g.links || {};
    const action = (key, label, primary) => {
      const u = safeUrl(L[key]);
      if (u) return h("a", { class: "btn" + (primary ? " primary" : ""), href: u, target: "_blank", rel: "noopener",
        onclick: (e) => { if (primary) { Fx.burst(PX.fx.pressStart, e.currentTarget); Sound.play("start", 0.5); } } }, label);
      return h("button", { class: "btn locked", "aria-disabled": "true", onclick: () => { Sound.play("denied", 0.5); toast("LOCKED", `${label.replace(/^\W+/, "")} 링크는 아직 준비 중이에요.`); } }, label);
    };
    $("#dlgActions").replaceChildren(action("play", "▶ PLAY", true), action("download", "DOWNLOAD"), action("source", "SOURCE"));
    const hist = g.changelog || [];
    $("#dlgHist").replaceChildren(...(hist.length ? hist.map((c) => {
      const CS = st(c.status || g.status);
      return h("li", { style: `--c:${CS.color}` }, h("span", { class: "v", text: `${ver(c.version)}` }), h("span", { class: "d", text: `${fmtDate(c.date)} ${CS.label}` }), h("span", { class: "n", text: (c.notes || []).join(" / ") }));
    }) : [h("li", { class: "hist-empty", style: "--c:var(--line-hi)" }, h("span", { text: "-" }), h("span"), h("span", { class: "n", text: "아직 공개된 빌드가 없어요." }))]));
    if (!dlg.open) dlg.showModal();
    Sound.duck(true);
    dlg.scrollTop = 0;
    Sound.play("open", 0.45);
    setTimeout(() => Sound.play("power", 0.3), 90);
    Fx.playCrt();
    if (!viaHash && g.id && /^[\w-]+$/.test(g.id)) history.replaceState(null, "", "#" + g.id);
  }
  function closeDetail() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("close", () => {
    Sound.play("close", 0.4);
    Sound.duck(false);
    if (current && location.hash === "#" + current.id) history.replaceState(null, "", location.pathname + location.search);
    current = null;
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDetail(); });
  $("#dlgClose").addEventListener("click", closeDetail);
  function fromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const g = DATA.games.find((x) => x.id === id);
    if (g) openDetail(g, true);
  }
  addEventListener("hashchange", fromHash);

  // ---------------------------------------------------------------- coin + start
  function setCredits(n) {
    state.credits = Math.max(0, Math.min(99, n));
    $("#creditNum").textContent = pad2(state.credits);
    const c = $("#credit"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    const call = $("#attractCall");
    call.textContent = state.credits ? "PRESS START" : "INSERT COIN";
    call.classList.toggle("ready", !!state.credits);
    $("#startBtn").classList.toggle("lit", !!state.credits);
  }
  function insertCoin() {
    Sound.play("coin", 0.55);
    setTimeout(() => Sound.play("credit", 0.35), 380);
    Fx.burst(PX.fx.insertCoin, $("#slotMouth"), { dy: 0 });
    setTimeout(() => setCredits(state.credits + 1), 420);
  }
  function pressStart() {
    if (!state.credits) { Sound.play("denied", 0.5); toast("INSERT COIN", "코인을 먼저 넣어주세요. 코인 슬롯을 누르거나 키보드 5"); return; }
    const list = featured();
    if (!list.length) { Sound.play("denied", 0.5); toast("NO GAME", "아직 플레이할 게임이 없어요. 곧 올라와요!"); return; }
    setCredits(state.credits - 1);
    Sound.play("boot", 0.45);
    Fx.burst(PX.fx.pressStart, $("#attractScreen"), {});
    setTimeout(() => openDetail(list[nsIdx % list.length]), 650);
  }
  $("#coinSlot").addEventListener("click", insertCoin);
  $("#startBtn").addEventListener("click", pressStart);
  for (const b of $$(".arc-btn")) b.addEventListener("click", () => { Sound.play("select", 0.4); document.querySelector(b.dataset.jump)?.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" }); });

  // ---------------------------------------------------------------- toggles
  let crtOn = store.get("crt", true);
  function syncToggles() {
    $("#sfxToggle").setAttribute("aria-pressed", String(Sound.on));
    $("#bgmToggle").setAttribute("aria-pressed", String(Sound.bgmOn));
    $("#crtToggle").setAttribute("aria-pressed", String(crtOn));
    document.body.classList.toggle("crt", crtOn);
  }
  $("#sfxToggle").addEventListener("click", () => { Sound.on = !Sound.on; store.set("sfx", Sound.on); syncToggles(); Sound.play("select", 0.4); });
  $("#bgmToggle").addEventListener("click", () => { Sound.toggleBgm(); syncToggles(); Sound.play("select", 0.35); });
  $("#crtToggle").addEventListener("click", () => { crtOn = !crtOn; store.set("crt", crtOn); syncToggles(); Sound.play("glitch", 0.4); });

  // ---------------------------------------------------------------- search + sort
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; renderGrid(); });
  $("#sort").value = state.sort;
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; store.set("sort", state.sort); Sound.play("tick", 0.4); renderGrid(); });

  // ---------------------------------------------------------------- keyboard: a joystick for the page
  const stick = $("#stick");
  let stickT = 0;
  function nudge(dir) { stick.dataset.dir = dir; clearTimeout(stickT); stickT = setTimeout(() => (stick.dataset.dir = ""), 160); }
  addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (dlg.open) return; // the dialog handles ESC itself
    if (e.key === "5") { insertCoin(); return; }
    if (e.key === "1") { pressStart(); return; }
    const dirs = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const d = dirs[e.key];
    if (!d) return;
    nudge(d);
    const inGrid = e.target.closest?.("#grid");
    if (!inGrid && state.sel < 0) return; // let the page scroll normally until a card is picked
    e.preventDefault();
    const cols = gridCols(), i = state.sel < 0 ? 0 : state.sel;
    const next = { left: i - 1, right: i + 1, up: i - cols, down: i + cols }[d];
    if (next >= 0 && next < $$("#grid .card").length) { select(next); Sound.play("hover", 0.3); }
  });

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    Fx.horizon?.(dt);
    if (Fx.layer) Fx.tickLayer(dt);
    Fx.crt?.(dt);
    Sprites.tick(now);
    requestAnimationFrame(loop);
  }
  addEventListener("resize", () => { if (Fx.layer) Fx.resize(); });

  // ---------------------------------------------------------------- boot
  async function load() {
    try {
      const r = await fetch("data/games.json", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (err) {
      // opened straight from disk (file://) or the file is missing
      if (window.ARCADE_FALLBACK) return window.ARCADE_FALLBACK;
      toast("LOAD ERROR", "data/games.json을 읽지 못했어요. 로컬에서는 간단한 서버로 열어주세요 (README 참고).");
      return { site: {}, games: [] };
    }
  }
  async function boot() {
    DATA = await load();
    DATA.games = (DATA.games || []).filter((g) => g && g.title);
    renderSite();
    renderBoard();
    renderTicker();
    renderNowShowing();
    renderChips();
    renderGrid();
    renderNotes();
    renderStages();
    syncToggles();
    setCredits(0);
    $("#credit").classList.remove("bump");
    Fx.initHorizon();
    if (PX) Fx.resize();
    requestAnimationFrame(loop);
    fromHash();
  }
  boot();
})();
