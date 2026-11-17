// The only interface: the number of fruits cut, and a settings sheet behind a gear button.
import { FRUITS } from "./fruits.js";

const KEY = "glassfruit.v1";
const DEFAULTS = { volume: 0.8, haptics: true, quality: "auto", fruits: FRUITS.map((f) => f.id), count: 0 };

export function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {}
  const out = { ...DEFAULTS, ...s };
  if (!Array.isArray(out.fruits) || !out.fruits.length) out.fruits = DEFAULTS.fruits.slice();
  return out;
}
export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

const SWATCH = {
  apple: "#e0283a", pear: "#c9d84a", orange: "#ff8a1a", lemon: "#ffd91a", lime: "#6cc23a", kiwi: "#7fb83a", strawberry: "#ff3048",
  peach: "#ff9a70", plum: "#7a2a7a", mango: "#ffb21a", watermelon: "#2f9a3a", banana: "#ffe04a", dragonfruit: "#ff3ea0",
};

const GEAR = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const MUTED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`;
const CLOSE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

export function buildUI(settings, { onChange, onReset, onOpen, canVibrate }) {
  const root = document.getElementById("ui");
  root.innerHTML = `
    <div id="count" aria-live="polite" aria-label="자른 과일 수">${settings.count}</div>
    <div class="corner">
      <button id="sound" class="round" aria-label="소리 켜기" hidden>${MUTED}</button>
      <button id="gear" class="round" aria-label="설정" aria-expanded="false">${GEAR}</button>
    </div>
    <div id="sheet" role="dialog" aria-modal="true" aria-label="설정" hidden>
      <div class="card">
        <header><h2>설정</h2><button id="close" class="round flat" aria-label="닫기">${CLOSE}</button></header>
        <label class="row"><span>효과음</span><input id="vol" type="range" min="0" max="100" step="1" value="${Math.round(settings.volume * 100)}"></label>
        ${canVibrate ? `<label class="row"><span>진동</span><input id="hap" type="checkbox" class="switch" ${settings.haptics ? "checked" : ""}></label>` : ""}
        <div class="row col"><span>그래픽</span>
          <div class="seg" role="radiogroup">
            ${[["auto", "자동"], ["low", "낮음"], ["medium", "보통"], ["high", "높음"]].map(([k, l]) => `<button role="radio" data-q="${k}" aria-checked="${settings.quality === k}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="row col"><span>나오는 과일 <button id="all" class="link">모두 선택</button></span>
          <div class="chips">
            ${FRUITS.map((f) => `<button class="chip" data-f="${f.id}" aria-pressed="${settings.fruits.includes(f.id)}"><i style="background:${SWATCH[f.id]}"></i>${f.name}</button>`).join("")}
          </div>
        </div>
        <button id="reset" class="danger">자른 과일 수 초기화</button>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const count = $("#count"), sheet = $("#sheet"), gear = $("#gear");
  const open = (v) => {
    sheet.hidden = !v;
    gear.setAttribute("aria-expanded", String(v));
    document.body.classList.toggle("sheet-open", v);
    onOpen(v);
  };
  gear.addEventListener("click", () => open(sheet.hidden));
  $("#close").addEventListener("click", () => open(false));
  sheet.addEventListener("pointerdown", (e) => {
    if (e.target === sheet) open(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) open(false);
  });
  $("#vol").addEventListener("input", (e) => {
    settings.volume = e.target.value / 100;
    onChange("volume");
  });
  $("#hap")?.addEventListener("change", (e) => {
    settings.haptics = e.target.checked;
    onChange("haptics");
  });
  root.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      settings.quality = b.dataset.q;
      root.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      onChange("quality");
    }),
  );
  const syncChips = () => root.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(settings.fruits.includes(c.dataset.f))));
  root.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      const id = c.dataset.f;
      const on = settings.fruits.includes(id);
      if (on && settings.fruits.length === 1) return; // keep at least one
      settings.fruits = on ? settings.fruits.filter((x) => x !== id) : [...settings.fruits, id];
      syncChips();
      onChange("fruits");
    }),
  );
  $("#all").addEventListener("click", () => {
    settings.fruits = FRUITS.map((f) => f.id);
    syncChips();
    onChange("fruits");
  });
  $("#reset").addEventListener("click", () => {
    settings.count = 0;
    count.textContent = "0";
    onReset();
  });
  return {
    setCount(n) {
      count.textContent = String(n);
      count.classList.remove("bump");
      void count.offsetWidth;
      count.classList.add("bump");
    },
    setMuted(m) {
      $("#sound").hidden = !m;
    },
  };
}
