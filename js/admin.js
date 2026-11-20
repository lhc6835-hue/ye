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
  let data = null, original = "", baseSha = "", sel = 0, view = "game";
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
  function guessRepo() {
    const host = location.hostname, parts = location.pathname.split("/").filter(Boolean);
    if (host.endsWith(".github.io")) {
      const owner = host.split(".")[0];
      return { owner, repo: parts.length && !parts[0].endsWith(".html") ? parts[0] : `${owner}.github.io` };
    }
    return null;
  }
  async function prefill() {
    let g = guessRepo();
    try {
      const d = await (await fetch(DATA_PATH, { cache: "no-store" })).json();
      const r = d?.site?.repo;
      if (r?.owner) g = { owner: r.owner, repo: r.name, branch: r.branch || "" };
    } catch { /* offline */ }
    const saved = ss.get("arcade-admin:repo");
    if (saved) try { g = { ...g, ...JSON.parse(saved) }; } catch { /* bad json */ }
    if (g) { $("#repoOwner").value = g.owner || ""; $("#repoName").value = g.repo || ""; if (g.branch) $("#repoBranch").value = g.branch; }
    const tok = ss.get("arcade-admin:token");
    if (tok && g?.owner && g?.repo) { $("#token").value = tok; login(); }
  }
  const log = (msg, err) => { const l = $("#loginLog"); l.append(h("div", { class: err ? "err" : "", text: msg })); };
  async function login(e) {
    e?.preventDefault();
    $("#loginLog").replaceChildren();
    gh.owner = $("#repoOwner").value.trim(); gh.repo = $("#repoName").value.trim(); gh.branch = $("#repoBranch").value.trim();
    gh.token = $("#token").value.trim();
    $("#loginBtn").disabled = true;
    try {
      log("> CHECKING TOKEN ...");
      const me = await gh.req("/user");
      log(`> HELLO ${me.login}`);
      log(`> CHECKING ACCESS TO ${gh.owner}/${gh.repo} ...`);
      const repo = await gh.req(`/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}`);
      if (!repo.permissions?.push) throw Object.assign(new Error("이 계정은 저장소에 쓰기 권한이 없어요."), { status: 403 });
      if (!gh.branch) { gh.branch = repo.default_branch; $("#repoBranch").value = gh.branch; }
      log("> WRITE ACCESS OK");
      log(`> LOADING ${DATA_PATH} ...`);
      const file = await gh.get(DATA_PATH);
      baseSha = file.sha;
      const loaded = JSON.parse(dec(file.content));
      loaded.site = loaded.site || {}; loaded.games = loaded.games || [];
      original = JSON.stringify(loaded);
      data = loaded;
      const remember = $("#remember").checked;
      ss.set("arcade-admin:token", gh.token, remember);
      ss.set("arcade-admin:repo", JSON.stringify({ owner: gh.owner, repo: gh.repo, branch: gh.branch }), true);
      $("#opLabel").replaceChildren("OPERATOR: ", h("b", { text: me.login }), ` · ${gh.owner}/${gh.repo}@${gh.branch}`);
      $("#loginView").hidden = true; $("#editView").hidden = false; $("#logoutBtn").hidden = false;
      offerDraft();
      renderList(); renderEditor(); markDirty();
    } catch (err) {
      const why = err.status === 401 ? "토큰이 올바르지 않거나 만료됐어요." : err.status === 404 ? "저장소나 data/games.json을 찾지 못했어요. 이름과 브랜치, 토큰의 저장소 선택을 확인하세요." : err.status === 403 ? err.message : `요청 실패: ${err.message}`;
      log("> ACCESS DENIED. " + why, true);
      ss.del("arcade-admin:token");
    } finally { $("#loginBtn").disabled = false; }
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
  $("#loginForm").addEventListener("submit", login);
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
  }
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
    const file = h("input", { type: "file", accept: "image/png,image/gif,image/jpeg,image/webp", onchange: (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 4 * 1024 * 1024) { toast("TOO BIG", "커버는 4MB 이하로 올려주세요."); e.target.value = ""; return; }
      const rd = new FileReader();
      rd.onload = () => { covers.set(g, { file: f, dataUrl: rd.result, ext: (f.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") }); renderEditor(); markDirty(); };
      rd.readAsDataURL(f);
    } });

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
    if (new Set(ids).size !== ids.length) { toast("ID 중복", "게임 ID가 겹쳐요. 서로 다르게 바꿔주세요."); btn.disabled = false; return; }
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
      toast("PUBLISHED", "저장 완료! GitHub Pages 반영까지 1~2분 걸려요.");
    } catch (err) {
      const why = err.status === 409 || err.status === 422 ? "그 사이 저장소의 데이터가 바뀌었어요. 새로고침해서 다시 불러온 뒤 수정해주세요 (작업 내용은 복구할 수 있어요)."
        : err.status === 403 || err.status === 404 ? "토큰에 Contents 쓰기 권한이 없거나 저장소 선택이 빠졌어요." : err.message;
      toast("FAILED", why);
      markDirty();
    }
  }
  $("#publishBtn").addEventListener("click", publish);
  addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s" && data) { e.preventDefault(); if (!$("#publishBtn").disabled) publish(); } });

  prefill();
})();
