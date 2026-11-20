/* Service mode: edit data/games.json and upload covers straight to the GitHub repository.
   Who may publish is decided by GitHub itself: the token must belong to an account with write access
   to the repository, and it is only ever sent to api.github.com. */
(() => {
  "use strict";

  const STATUS = {
    release: { label: "RELEASE", hex: "#ffc626" }, beta: { label: "BETA", hex: "#4ce8d8" }, alpha: { label: "ALPHA", hex: "#f53cd1" },
    dev: { label: "DEV", hex: "#ffa026" }, soon: { label: "SOON", hex: "#8a78e0" },
  };
  const PLATFORMS = { web: "WEB", windows: "WIN", mac: "MAC", linux: "LINUX", android: "ANDROID", ios: "iOS", switch: "SWITCH" };
  const DATA_PATH = "data/games.json";
  const API = "https://api.github.com";

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "text") n.textContent = v;
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const enc = (str) => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const ss = {
    get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
    set(k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch { /* blocked */ } },
    del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* blocked */ } },
  };
  let toastT = 0;
  function toast(head, msg) {
    const t = $("#toast");
    t.replaceChildren(h("b", { text: head }), msg);
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------------------------------------------------------------- github
  const gh = {
    token: "", owner: "", repo: "", branch: "main",
    async req(path, opts = {}) {
      const r = await fetch(API + path, {
        ...opts,
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      });
      const body = r.status === 204 ? null : await r.json().catch(() => null);
      if (!r.ok) { const e = new Error(body?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
      return body;
    },
    path(p) { return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${p.split("/").map(encodeURIComponent).join("/")}`; },
    get(p) { return this.req(`${this.path(p)}?ref=${encodeURIComponent(this.branch)}`); },
    put(p, content64, message, sha) { return this.req(this.path(p), { method: "PUT", body: JSON.stringify({ message, content: content64, branch: this.branch, ...(sha ? { sha } : {}) }) }); },
  };

  // ---------------------------------------------------------------- state
  let data = null, original = "", baseSha = "", sel = 0, view = "quick";
  const covers = new Map(); // game index key -> { file, dataUrl, ext }
  const draftKey = () => `arcade-admin:draft:${gh.owner}/${gh.repo}`;
  const dirtyCount = () => {
    if (!data) return 0;
    const o = JSON.parse(original);
    let n = JSON.stringify(o.site) !== JSON.stringify(data.site) ? 1 : 0;
    const ids = new Set([...o.games.map((g) => g.id), ...data.games.map((g) => g.id)]);
    for (const id of ids) if (JSON.stringify(o.games.find((g) => g.id === id)) !== JSON.stringify(data.games.find((g) => g.id === id))) n++;
    if (o.games.map((g) => g.id).join() !== data.games.map((g) => g.id).join()) n = Math.max(n, 1);
    return n + covers.size;
  };
  function markDirty() {
    const n = dirtyCount();
    $("#dirty").hidden = !n;
    $("#dirty").textContent = `UNSAVED ${n}`;
    $("#publishBtn").disabled = !n;
    try { if (n) localStorage.setItem(draftKey(), JSON.stringify({ baseSha, data })); else localStorage.removeItem(draftKey()); } catch { /* blocked */ }
    renderList();
  }
  addEventListener("beforeunload", (e) => { if (dirtyCount()) { e.preventDefault(); e.returnValue = ""; } });

  // ---------------------------------------------------------------- login
  // Password login: the GitHub token is stored in data/auth.json encrypted with the operator's password
  // (PBKDF2-SHA256, 600k rounds -> AES-GCM 256). Only the ciphertext is public; the password never leaves the browser.
  const AUTH_PATH = "data/auth.json";
  const ITER = 600000, MIN_PW = 10;
  const b64e = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const b64d = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  async function deriveKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealToken(token, pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pw, salt, ITER);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
    return { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct), repo: { owner: gh.owner, name: gh.repo, branch: gh.branch }, updated: today() };
  }
  async function openToken(auth, pw) {
    const key = await deriveKey(pw, b64d(auth.salt), auth.iter || ITER);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(auth.iv) }, key, b64d(auth.ct));
    return new TextDecoder().decode(pt);
  }

  function guessRepo() {
    const host = location.hostname, parts = location.pathname.split("/").filter(Boolean);
    if (host.endsWith(".github.io")) {
      const owner = host.split(".")[0];
      return { owner, repo: parts.length && !parts[0].endsWith(".html") ? parts[0] : `${owner}.github.io` };
    }
    return null;
  }
  let AUTH = null;
  async function prefill() {
    let g = guessRepo();
    try {
      const d = await (await fetch(DATA_PATH, { cache: "no-store" })).json();
      const r = d?.site?.repo;
      if (r?.owner) g = { owner: r.owner, repo: r.name, branch: r.branch || "" };
    } catch { /* offline */ }
    try { const r = await fetch(AUTH_PATH, { cache: "no-store" }); if (r.ok) AUTH = await r.json(); } catch { /* not set up yet */ }
    if (AUTH?.repo?.owner) g = { owner: AUTH.repo.owner, repo: AUTH.repo.name, branch: AUTH.repo.branch || "" };
    if (g) { gh.owner = g.owner || ""; gh.repo = g.repo || ""; gh.branch = g.branch || ""; $("#repoOwner").value = gh.owner; $("#repoName").value = gh.repo; $("#repoBranch").value = gh.branch; }
    showForm(AUTH?.ct ? "pw" : "setup");
    const tok = ss.get("arcade-admin:token");
    if (tok && gh.owner && gh.repo) { gh.token = tok; try { openEditor(await verifyAndLoad(log)); } catch { ss.del("arcade-admin:token"); } }
  }
  function showForm(which) {
    $("#pwForm").hidden = which !== "pw";
    $("#setupForm").hidden = which !== "setup";
    $("#loginTitle").textContent = which === "pw" ? "OPERATOR LOGIN" : AUTH?.ct ? "RESET PASSWORD" : "FIRST-TIME SETUP";
    $("#loginLog").replaceChildren(); $("#setupLog").replaceChildren();
    (which === "pw" ? $("#pw") : $("#token")).focus();
  }
  const logTo = (id) => (msg, err) => $(id).append(h("div", { class: err ? "err" : "", text: msg }));
  const log = logTo("#loginLog");

  // check the token against GitHub and load the data file; no UI change
  async function verifyAndLoad(say) {
    say("> CHECKING ACCESS ...");
    const me = await gh.req("/user");
    const repo = await gh.req(`/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}`);
    if (!repo.permissions?.push) throw Object.assign(new Error("이 계정은 저장소에 쓰기 권한이 없어요."), { status: 403 });
    if (!gh.branch) gh.branch = repo.default_branch;
    say(`> HELLO ${me.login} · WRITE ACCESS OK`);
    const file = await gh.get(DATA_PATH);
    baseSha = file.sha;
    const loaded = JSON.parse(dec(file.content));
    loaded.site = loaded.site || {}; loaded.games = loaded.games || [];
    original = JSON.stringify(loaded);
    data = loaded;
    return me;
  }
  function openEditor(me) {
    ss.set("arcade-admin:token", gh.token, $("#remember").checked);
    $("#opLabel").replaceChildren("OPERATOR: ", h("b", { text: me.login }), ` · ${gh.owner}/${gh.repo}`);
    $("#loginView").hidden = true; $("#editView").hidden = false; $("#logoutBtn").hidden = false;
    offerDraft();
    renderList(); renderEditor(); markDirty();
  }
  const why = (err) => err.status === 401 ? "저장된 토큰이 만료됐거나 취소됐어요. '비밀번호 재설정'에서 새 토큰으로 다시 설정해주세요."
    : err.status === 404 ? "저장소나 data/games.json을 찾지 못했어요." : err.status === 403 ? err.message : `요청 실패: ${err.message}`;

  async function pwLogin(e) {
    e.preventDefault();
    $("#loginLog").replaceChildren();
    const btn = $("#pwBtn"); btn.disabled = true;
    try {
      log("> UNLOCKING ...");
      try { gh.token = await openToken(AUTH, $("#pw").value); }
      catch { await new Promise((r) => setTimeout(r, 700)); log("> 비밀번호가 틀렸어요.", true); $("#pw").select(); return; }
      openEditor(await verifyAndLoad(log));
    } catch (err) { log("> ACCESS DENIED. " + why(err), true); }
    finally { btn.disabled = false; }
  }
  async function setup(e) {
    e.preventDefault();
    const say = logTo("#setupLog");
    $("#setupLog").replaceChildren();
    const pw = $("#npw").value, pw2 = $("#npw2").value;
    if (pw.length < MIN_PW) { say(`> 비밀번호는 ${MIN_PW}자 이상으로 해주세요. 짧은 문장처럼 길게 만드는 게 가장 안전해요.`, true); return; }
    if (pw !== pw2) { say("> 두 비밀번호가 달라요.", true); return; }
    gh.owner = $("#repoOwner").value.trim(); gh.repo = $("#repoName").value.trim(); gh.branch = $("#repoBranch").value.trim();
    gh.token = $("#token").value.trim();
    const btn = $("#setupBtn"); btn.disabled = true;
    try {
      const me = await verifyAndLoad(say);
      say("> ENCRYPTING TOKEN ...");
      const sealed = await sealToken(gh.token, pw);
      let sha;
      try { sha = (await gh.get(AUTH_PATH)).sha; } catch { /* first time */ }
      await gh.put(AUTH_PATH, enc(JSON.stringify(sealed, null, 2) + "\n"), "arcade: set operator password", sha);
      AUTH = sealed;
      say("> PASSWORD SAVED. 다음부터는 비밀번호만 입력하면 돼요.");
      $("#token").value = ""; $("#npw").value = ""; $("#npw2").value = "";
      setTimeout(() => openEditor(me), 900);
    } catch (err) {
      const m = err.status === 401 ? "토큰이 올바르지 않거나 만료됐어요." : err.status === 403 || err.status === 404 ? "토큰에 이 저장소의 Contents 쓰기 권한이 있는지 확인해주세요." : err.message;
      say("> FAILED. " + m, true);
    } finally { btn.disabled = false; }
  }
  function offerDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch { /* none */ }
    if (!d?.data) return;
    const bar = h("div", { class: "svc-panel", style: "margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      h("span", { text: d.baseSha === baseSha ? "저장 안 한 작업이 남아 있어요." : "저장 안 한 작업이 있지만, 그 사이 저장소가 바뀌었어요. 복구하면 최신 변경을 덮어쓸 수 있어요." }),
      h("button", { class: "btn primary", text: "복구", onclick: () => { data = d.data; bar.remove(); renderEditor(); markDirty(); } }),
      h("button", { class: "btn", text: "버리기", onclick: () => { try { localStorage.removeItem(draftKey()); } catch { /* */ } bar.remove(); } }));
    $("#editor").before(bar);
  }
  $("#pwForm").addEventListener("submit", pwLogin);
  $("#setupForm").addEventListener("submit", setup);
  $("#toSetup").addEventListener("click", () => showForm("setup"));
  $("#toPw").addEventListener("click", () => showForm("pw"));
  $("#logoutBtn").addEventListener("click", () => { ss.del("arcade-admin:token"); location.reload(); });

  // ---------------------------------------------------------------- list
  function renderList() {
    if (!data) return;
    const o = JSON.parse(original);
    $("#gameList").replaceChildren(...data.games.map((g, i) => {
      const S = STATUS[g.status] || STATUS.dev, changed = JSON.stringify(o.games.find((x) => x.id === g.id)) !== JSON.stringify(g) || covers.has(g);
      return h("li", {}, h("button", { style: `--c:${S.hex}`, "aria-current": String(view === "game" && i === sel), onclick: () => { view = "game"; sel = i; renderList(); renderEditor(); } },
        h("i"), h("span", { class: "t" }, changed ? h("span", { class: "mark", text: "* " }) : null, g.title || "(제목 없음)"), h("span", { class: "s", text: S.label })));
    }));
    $("#siteBtn").setAttribute("aria-pressed", String(view === "site"));
    $("#quickBtn").setAttribute("aria-pressed", String(view === "quick"));
  }
  $("#quickBtn").addEventListener("click", () => { view = "quick"; renderList(); renderEditor(); });
  $("#newGame").addEventListener("click", () => {
    data.games.unshift({ id: `game-${stamp().slice(2, 12)}`, title: "NEW GAME", subtitle: "", status: "dev", version: "0.1.0", featured: false, color: "#f53cd1",
      genre: [], platforms: ["web"], players: "1P", released: "", updated: today(), cover: "", description: "", controls: [], links: { play: "", download: "", source: "" }, changelog: [] });
    view = "game"; sel = 0; renderEditor(); markDirty();
    $("#f-title")?.select();
  });
  $("#siteBtn").addEventListener("click", () => { view = "site"; renderList(); renderEditor(); });

  // ---------------------------------------------------------------- form helpers
  const field = (label, input, hint) => h("label", {}, label, input, hint ? h("span", { class: "hint", text: hint }) : null);
  const text = (id, obj, key, opts = {}) => h(opts.area ? "textarea" : "input", { id, value: obj[key] ?? "", placeholder: opts.ph || "", type: opts.type || null,
    oninput: (e) => { obj[key] = opts.num ? e.target.value.trim() : e.target.value; opts.after?.(e); markDirty(); } });
  const listText = (id, obj, key, ph) => h("input", { id, value: (obj[key] || []).join(", "), placeholder: ph,
    oninput: (e) => { obj[key] = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); markDirty(); } });

  // ---------------------------------------------------------------- editor: game
  function renderEditor() {
    const ed = $("#editor");
    if (view === "site") return renderSite(ed);
    if (view === "quick") return renderQuick(ed);
    const g = data.games[sel];
    if (!g) { ed.replaceChildren(h("p", { class: "svc-empty", text: "게임이 없어요. + NEW로 첫 게임을 추가하세요." })); return; }
    g.links = g.links || {}; g.controls = g.controls || []; g.changelog = g.changelog || []; g.platforms = g.platforms || []; g.genre = g.genre || [];
    const del = h("button", { class: "btn danger", text: "DELETE", onclick: (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "정말 삭제? 한 번 더"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "DELETE"; }, 2500); return; }
      covers.delete(g); data.games.splice(sel, 1); sel = Math.max(0, sel - 1); renderEditor(); markDirty();
    } });
    const move = (d) => { const j = sel + d; if (j < 0 || j >= data.games.length) return; [data.games[sel], data.games[j]] = [data.games[j], data.games[sel]]; sel = j; renderEditor(); markDirty(); };

    // cover
    const pending = covers.get(g);
    const prev = h("div", { class: "cover-prev" }, pending ? h("img", { src: pending.dataUrl, alt: "" }) : g.cover ? h("img", { src: g.cover, alt: "", onerror: (e) => e.target.replaceWith("이미지를 못 불러왔어요") }) : "NO SIGNAL");
    const file = h("input", { type: "file", accept: IMG_ACCEPT, onchange: (e) => readImage(e.target, (c) => { covers.set(g, c); renderEditor(); markDirty(); }) });

    // controls
    const ctl = h("div", { class: "rows" }, ...g.controls.map((c, i) => h("div", { class: "ctl-row" },
      h("input", { value: c[0] || "", placeholder: "키 (예: ← →)", "aria-label": "키", oninput: (e) => { c[0] = e.target.value; markDirty(); } }),
      h("input", { value: c[1] || "", placeholder: "동작 (예: 이동)", "aria-label": "동작", oninput: (e) => { c[1] = e.target.value; markDirty(); } }),
      h("button", { class: "btn icon-btn x-btn", type: "button", text: "✕", "aria-label": "삭제", onclick: () => { g.controls.splice(i, 1); renderEditor(); markDirty(); } }))));

    // changelog
    const logs = h("div", { class: "rows" }, ...g.changelog.map((c, i) => h("div", { class: "log-row", style: `--c:${(STATUS[c.status] || STATUS.dev).hex}` },
      h("div", { class: "row4" },
        field("VERSION", h("input", { value: c.version || "", oninput: (e) => { c.version = e.target.value.trim(); markDirty(); } })),
        field("DATE", h("input", { type: "date", value: c.date || "", oninput: (e) => { c.date = e.target.value; markDirty(); } })),
        field("STATUS", statusSelect(c.status, (v) => { c.status = v; renderEditor(); markDirty(); })),
        h("div", { class: "actions", style: "justify-content:flex-end" },
          h("button", { class: "btn icon-btn", type: "button", text: "▲", "aria-label": "위로", onclick: () => { if (i) { [g.changelog[i - 1], g.changelog[i]] = [g.changelog[i], g.changelog[i - 1]]; renderEditor(); markDirty(); } } }),
          h("button", { class: "btn icon-btn x-btn", type: "button", text: "✕", "aria-label": "삭제", onclick: () => { g.changelog.splice(i, 1); renderEditor(); markDirty(); } }))),
      field("NOTES · 한 줄에 하나", h("textarea", { value: (c.notes || []).join("\n"), oninput: (e) => { c.notes = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean); markDirty(); } })))));

    const S = STATUS[g.status] || STATUS.dev;
    ed.replaceChildren(
      h("div", { class: "ed-head" },
        h("h2", { style: `color:${S.hex}`, text: g.title || "(제목 없음)" }),
        h("div", { class: "actions" },
          h("button", { class: "btn icon-btn", text: "▲ UP", onclick: () => move(-1) }), h("button", { class: "btn icon-btn", text: "▼ DOWN", onclick: () => move(1) }), del)),
      h("form", { class: "svc-form", onsubmit: (e) => e.preventDefault() },
        h("fieldset", {}, h("legend", { text: "BASIC" }),
          h("div", { class: "row2" },
            field("TITLE", text("f-title", g, "title", { after: () => { $("#editor h2").textContent = g.title || "(제목 없음)"; } })),
            field("SUBTITLE", text("f-sub", g, "subtitle"))),
          h("div", { class: "row4" },
            field("STATUS", statusSelect(g.status, (v) => { g.status = v; g.color = g.color || STATUS[v].hex; renderEditor(); markDirty(); })),
            field("VERSION", text("f-ver", g, "version", { ph: "1.0.0", num: true })),
            field("PLAYERS", text("f-pl", g, "players", { ph: "1P" })),
            field("MARQUEE COLOR", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : S.hex, oninput: (e) => { g.color = e.target.value; markDirty(); } }))),
          h("div", { class: "row2" },
            field("ID (주소에 쓰임)", h("input", { value: g.id, pattern: "[a-z0-9-]+", oninput: (e) => { g.id = slug(e.target.value) || g.id; markDirty(); }, onblur: (e) => (e.target.value = g.id) }), "영문 소문자, 숫자, - 만. 사이트 주소 #id 로 바로 열려요"),
            field("GENRE", listText("f-genre", g, "genre", "액션, 퍼즐"), "쉼표로 구분")),
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: g.featured, onchange: (e) => { g.featured = e.target.checked; markDirty(); } }), "메인 화면 NOW SHOWING에 노출"),
          field("DESCRIPTION", text("f-desc", g, "description", { area: true })),
          h("div", {}, h("span", { class: "hint", text: "PLATFORM" }), h("div", { class: "plats" }, ...Object.entries(PLATFORMS).map(([k, v]) =>
            h("label", { class: "check" }, h("input", { type: "checkbox", checked: g.platforms.includes(k), onchange: (e) => { g.platforms = e.target.checked ? [...new Set([...g.platforms, k])] : g.platforms.filter((x) => x !== k); markDirty(); } }), v))))),
        h("fieldset", {}, h("legend", { text: "LINKS" }),
          field("PLAY (플레이 주소)", text("f-play", g.links, "play", { ph: "https://...", type: "url" })),
          h("div", { class: "row2" }, field("DOWNLOAD", text("f-dl", g.links, "download", { ph: "https://...", type: "url" })), field("SOURCE", text("f-src", g.links, "source", { ph: "https://github.com/...", type: "url" }))),
          h("span", { class: "hint", text: "비워두면 사이트에서 '준비 중' 버튼으로 표시돼요." })),
        h("fieldset", {}, h("legend", { text: "COVER" }),
          h("div", { class: "cover-box" }, prev, h("div", { class: "rows" },
            field("이미지 업로드", file, "PUBLISH할 때 저장소 assets/covers/ 에 올라가요. 16:10 비율 권장"),
            field("또는 이미지 주소", text("f-cover", g, "cover", { ph: "assets/covers/... 또는 https://...", after: () => covers.delete(g) })),
            pending ? h("button", { class: "btn", type: "button", text: "업로드 취소", onclick: () => { covers.delete(g); renderEditor(); markDirty(); } }) : null))),
        h("fieldset", {}, h("legend", { text: "DATES" }),
          h("div", { class: "row2" },
            field("RELEASED (정식 출시일)", text("f-rel", g, "released", { type: "date" })),
            field("UPDATED", text("f-upd", g, "updated", { type: "date" }), "바꾼 게임은 PUBLISH 때 오늘 날짜로 자동 갱신돼요"))),
        h("fieldset", {}, h("legend", { text: "HOW TO PLAY" }), ctl,
          h("div", { class: "actions" }, h("button", { class: "btn icon-btn", type: "button", text: "+ 조작키", onclick: () => { g.controls.push(["", ""]); renderEditor(); markDirty(); } }))),
        h("fieldset", {}, h("legend", { text: "VERSION HISTORY" }),
          h("div", { class: "actions" }, h("button", { class: "btn icon-btn", type: "button", text: `+ 현재 버전(${g.version || "?"}) 기록 추가`, onclick: () => {
            g.changelog.unshift({ version: g.version || "", date: today(), status: g.status, notes: [] }); renderEditor(); markDirty();
          } })),
          logs.childElementCount ? logs : h("span", { class: "hint", text: "기록이 없어요." }))));
  }
  function statusSelect(value, on) {
    return h("select", { onchange: (e) => on(e.target.value) }, ...Object.entries(STATUS).map(([k, v]) => h("option", { value: k, selected: k === value ? "" : null, text: v.label })));
  }

  // ---------------------------------------------------------------- thumbnails
  const IMG_ACCEPT = "image/gif,image/jpeg,image/png,image/webp,.gif,.jpg,.jpeg,.png,.webp";
  const IMG_EXT = { "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const MAX_IMG = 10 * 1024 * 1024;
  function readImage(input, done) {
    const f = input.files?.[0];
    if (!f) return;
    const ext = IMG_EXT[f.type] || { gif: "gif", jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" }[(f.name.split(".").pop() || "").toLowerCase()];
    if (!ext) { toast("FORMAT", "GIF, JPEG, PNG, WEBP 이미지만 올릴 수 있어요."); input.value = ""; return; }
    if (f.size > MAX_IMG) { toast("TOO BIG", "썸네일은 10MB 이하로 올려주세요. 큰 GIF는 길이나 크기를 줄여주세요."); input.value = ""; return; }
    const rd = new FileReader();
    rd.onload = () => done({ file: f, dataUrl: rd.result, ext });
    rd.readAsDataURL(f);
  }

  // ---------------------------------------------------------------- quick add: a playable GitHub address -> a post
  // Accepts https://github.com/<owner>/<repo>, https://<owner>.github.io/<repo>/ or any other playable https address.
  function parseGameUrl(raw) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return null; }
    const seg = u.pathname.split("/").filter(Boolean);
    if (u.hostname === "github.com" && seg.length >= 2) return { owner: seg[0], repo: seg[1].replace(/\.git$/, ""), play: "" };
    const m = u.hostname.match(/^([\w-]+)\.github\.io$/i);
    if (m) {
      const owner = m[1], repo = seg.length && !/\.\w+$/.test(seg[0]) ? seg[0] : `${owner}.github.io`;
      return { owner, repo, play: u.href };
    }
    return { owner: "", repo: "", play: u.href };
  }
  const niceTitle = (name) => String(name || "").replace(/\.github\.io$/i, "").replace(/[-_]+/g, " ").trim().toUpperCase();
  async function fetchGameMeta(raw) {
    const p = parseGameUrl(raw);
    if (!p) throw new Error("주소 형식이 이상해요. https://github.com/아이디/저장소 처럼 넣어주세요.");
    const meta = { title: "", description: "", version: "", play: p.play, source: "", genre: [], warn: "" };
    if (!p.owner) { meta.warn = "GitHub 주소가 아니라서 제목과 설명은 직접 적어주세요."; return meta; }
    let repo;
    try { repo = await gh.req(`/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`); }
    catch (e) {
      meta.warn = e.status === 404 ? "저장소 정보를 못 읽었어요 (비공개 저장소일 수 있어요). 제목과 설명은 직접 적어주세요." : `저장소 정보를 못 읽었어요: ${e.message}`;
      meta.title = niceTitle(p.repo);
      if (!meta.play) meta.play = `https://${p.owner}.github.io/${p.repo === p.owner + ".github.io" ? "" : p.repo + "/"}`;
      return meta;
    }
    meta.title = niceTitle(repo.name);
    meta.description = repo.description || "";
    meta.source = repo.private ? "" : repo.html_url;
    meta.genre = (repo.topics || []).filter((t) => !/^(game|games|html5|javascript|github-pages)$/i.test(t)).slice(0, 3);
    if (!meta.play) {
      if (/^https?:\/\//i.test(repo.homepage || "")) meta.play = repo.homepage;
      else if (repo.has_pages) {
        try { meta.play = (await gh.req(`/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/pages`)).html_url; }
        catch { meta.play = `https://${p.owner}.github.io/${repo.name === p.owner + ".github.io" ? "" : repo.name + "/"}`; }
      } else meta.warn = "이 저장소는 GitHub Pages가 꺼져 있어서 플레이 주소를 못 찾았어요. PLAY 주소를 직접 넣어주세요.";
    }
    try { const rel = await gh.req(`/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/releases/latest`); meta.version = String(rel.tag_name || "").replace(/^v/i, ""); } catch { /* no releases */ }
    return meta;
  }
  const quick = { url: "", title: "", description: "", status: "beta", version: "", play: "", source: "", genre: [], cover: null, loaded: false, busy: false };
  function renderQuick(ed) {
    const q = quick;
    const set = (k) => (e) => { q[k] = e.target.value; };
    const prev = h("div", { class: "cover-prev" }, q.cover ? h("img", { src: q.cover.dataUrl, alt: "" }) : "썸네일을 넣어주세요");
    const load = async () => {
      if (!q.url.trim()) { toast("URL", "게임 주소를 넣어주세요."); return; }
      q.busy = true; renderEditor();
      try {
        const m = await fetchGameMeta(q.url.trim());
        Object.assign(q, { title: m.title, description: m.description, version: m.version, play: m.play, source: m.source, genre: m.genre, loaded: true });
        if (m.version && q.status === "beta") q.status = "release";
        if (m.warn) toast("CHECK", m.warn); else toast("LOADED", "정보를 불러왔어요. 썸네일을 넣고 게시하세요.");
      } catch (e) { toast("FAILED", e.message); }
      q.busy = false; renderEditor();
    };
    const post = async () => {
      if (!q.title.trim()) { toast("TITLE", "제목을 적어주세요."); return; }
      if (!/^https?:\/\//i.test(q.play)) { toast("PLAY", "플레이 주소가 필요해요."); return; }
      if (!q.cover) { toast("THUMBNAIL", "썸네일을 넣어주세요 (GIF, JPEG, PNG, WEBP)."); return; }
      let id = slug(q.title) || `game-${stamp().slice(2, 12)}`;
      while (data.games.some((g) => g.id === id)) id += "-2";
      const g = { id, title: q.title.trim(), subtitle: "", status: q.status, version: q.version.trim(), featured: true, color: STATUS[q.status].hex,
        genre: q.genre, platforms: ["web"], players: "1P", released: q.status === "release" ? today() : "", updated: today(), cover: "",
        description: q.description.trim(), controls: [], links: { play: q.play.trim(), download: "", source: q.source.trim() },
        changelog: [{ version: q.version.trim(), date: today(), status: q.status, notes: ["첫 공개"] }] };
      data.games.unshift(g);
      covers.set(g, q.cover);
      q.busy = true; renderEditor(); markDirty();
      const ok = await publish();
      q.busy = false;
      if (ok) { Object.assign(quick, { url: "", title: "", description: "", status: "beta", version: "", play: "", source: "", genre: [], cover: null, loaded: false }); view = "game"; sel = 0; }
      renderList(); renderEditor();
    };
    ed.replaceChildren(
      h("div", { class: "ed-head" }, h("h2", { text: "NEW POST" })),
      h("p", { text: "플레이할 수 있는 GitHub 주소를 넣고 불러오기를 누르면 제목, 설명, 링크, 버전을 채워줘요. 썸네일만 넣고 게시하면 끝." }),
      h("form", { class: "svc-form", onsubmit: (e) => { e.preventDefault(); load(); } },
        h("fieldset", {}, h("legend", { text: "1. GAME ADDRESS" }),
          h("div", { class: "quick-url" },
            h("input", { id: "q-url", value: q.url, placeholder: "https://아이디.github.io/게임  또는  https://github.com/아이디/게임", oninput: set("url"), "aria-label": "게임 주소" }),
            h("button", { class: "btn", type: "submit", disabled: q.busy, text: q.busy && !q.loaded ? "불러오는 중..." : "불러오기" }))),
        h("fieldset", { disabled: !q.loaded || (q.busy && q.loaded) }, h("legend", { text: "2. CHECK" }),
          h("div", { class: "row2" },
            field("TITLE", h("input", { id: "q-title", value: q.title, oninput: set("title") })),
            field("STATUS", statusSelect(q.status, (v) => { q.status = v; }))),
          field("DESCRIPTION", h("textarea", { id: "q-desc", value: q.description, oninput: set("description") })),
          h("div", { class: "row3" },
            field("VERSION", h("input", { id: "q-ver", value: q.version, placeholder: "1.0.0", oninput: set("version") }), "릴리스가 있으면 자동"),
            field("PLAY", h("input", { id: "q-play", type: "url", value: q.play, oninput: set("play") })),
            field("SOURCE", h("input", { id: "q-src", type: "url", value: q.source, oninput: set("source") })))),
        h("fieldset", { disabled: !q.loaded || (q.busy && q.loaded) }, h("legend", { text: "3. THUMBNAIL" }),
          h("div", { class: "cover-box" }, prev, h("div", { class: "rows" },
            field("이미지 파일", h("input", { id: "q-cover", type: "file", accept: IMG_ACCEPT, onchange: (e) => readImage(e.target, (c) => { q.cover = c; renderEditor(); }) }), "GIF(움직이는 것도 OK), JPEG, PNG, WEBP · 10MB 이하 · 16:10 비율 권장")))),
        h("div", { class: "actions" },
          h("button", { class: "btn primary", type: "button", id: "q-post", disabled: !q.loaded || q.busy, text: q.busy && q.loaded ? "게시하는 중..." : "게시하기 ▶", onclick: post }))));
  }

  // ---------------------------------------------------------------- editor: site
  function renderSite(ed) {
    const s = data.site; s.links = s.links || {};
    ed.replaceChildren(h("div", { class: "ed-head" }, h("h2", { text: "SITE SETTINGS" })),
      h("form", { class: "svc-form", onsubmit: (e) => e.preventDefault() },
        h("fieldset", {}, h("legend", { text: "SITE" }),
          h("div", { class: "row2" }, field("SITE NAME", text("s-name", s, "name")), field("DEVELOPER", text("s-dev", s, "developer"))),
          field("TAGLINE", text("s-tag", s, "tagline")),
          field("BIO", text("s-bio", s, "bio", { area: true }))),
        h("fieldset", {}, h("legend", { text: "LINKS" }),
          h("div", { class: "row2" }, field("GITHUB", text("s-gh", s.links, "github", { ph: "https://github.com/...", type: "url" })), field("ITCH.IO", text("s-itch", s.links, "itch", { ph: "https://...itch.io", type: "url" }))),
          h("div", { class: "row2" }, field("BLOG", text("s-blog", s.links, "blog", { ph: "https://...", type: "url" })), field("EMAIL", text("s-mail", s.links, "email", { ph: "me@example.com" }), "화면에 글자로만 표시돼요"))),
        h("fieldset", {}, h("legend", { text: "SOUND" }),
          field("BGM 파일 경로", text("s-bgm", s, "bgm", { ph: "assets/bgm/attract.mp3" }), "루프용 mp3를 저장소에 넣고 경로를 적으면 BGM 버튼이 켜져요"))));
  }

  // ---------------------------------------------------------------- publish
  async function publish() {
    const btn = $("#publishBtn");
    btn.disabled = true;
    const ids = data.games.map((g) => g.id);
    if (new Set(ids).size !== ids.length) { toast("ID 중복", "게임 ID가 겹쳐요. 서로 다르게 바꿔주세요."); btn.disabled = false; return false; }
    try {
      toast("PUBLISH", "저장소에 올리는 중...");
      // 1. covers
      for (const [g, c] of covers) {
        const path = `assets/covers/${g.id}-${stamp()}.${c.ext || "png"}`;
        await gh.put(path, c.dataUrl.split(",")[1], `arcade: cover for ${g.title}`);
        g.cover = path;
      }
      covers.clear();
      // 2. stamp updated dates on games that changed
      const o = JSON.parse(original), t = today();
      for (const g of data.games) {
        const before = o.games.find((x) => x.id === g.id);
        const strip = (x) => JSON.stringify({ ...x, updated: undefined });
        if ((!before || strip(before) !== strip(g)) && (!before || before.updated === g.updated)) g.updated = t;
      }
      // 3. data file, guarded by the sha we loaded
      const changed = data.games.filter((g) => JSON.stringify(o.games.find((x) => x.id === g.id)) !== JSON.stringify(g)).map((g) => g.title);
      const msg = `arcade: update ${changed.slice(0, 3).join(", ") || "site settings"}${changed.length > 3 ? ` +${changed.length - 3}` : ""}`;
      const res = await gh.put(DATA_PATH, enc(JSON.stringify(data, null, 2) + "\n"), msg, baseSha);
      baseSha = res.content.sha;
      original = JSON.stringify(data);
      try { localStorage.removeItem(draftKey()); } catch { /* */ }
      renderEditor(); markDirty();
      toast("PUBLISHED", "게시 완료! 사이트 반영까지 1~2분 걸려요.");
      return true;
    } catch (err) {
      const why = err.status === 409 || err.status === 422 ? "그 사이 저장소의 데이터가 바뀌었어요. 새로고침해서 다시 불러온 뒤 수정해주세요 (작업 내용은 복구할 수 있어요)."
        : err.status === 403 || err.status === 404 ? "토큰에 Contents 쓰기 권한이 없거나 저장소 선택이 빠졌어요." : err.message;
      toast("FAILED", why);
      markDirty();
      return false;
    }
  }
  $("#publishBtn").addEventListener("click", publish);
  addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && data) { e.preventDefault(); if (!$("#publishBtn").disabled) publish(); } });

  prefill();
})();
