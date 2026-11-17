// Plays a scripted cut through the real sound engine and records the output (tools/audio-demo.mjs drives it).
import * as sfx from "../src/audio.js";

const Orig = window.AudioContext;
window.AudioContext = class extends Orig {
  constructor(o) {
    super(o);
    this.__out = this.createMediaStreamDestination();
  }
  get destination() {
    return this.__out;
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

window.runDemo = async () => {
  sfx.unlock();
  while (sfx.loadedCount() < 23) await wait(50);
  const ctx = window.__ctx;
  void ctx;
  const stream = sfx.__stream();
  const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  await wait(300);
  // three cuts: slow, medium, quick; each: touch, catch, bite, slide with grit, out, pieces land
  for (const [speed, len] of [[0.12, 700], [0.25, 420], [0.5, 230]]) {
    sfx.impact("glass", 0.12, 1, 0);
    await wait(160);
    sfx.bite(1, 0);
    let acc = 0, next = 0.006, clickAcc = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < len) {
      const u = (performance.now() - t0) / len;
      const chord = Math.sin(Math.PI * u);
      const v = speed * (0.6 + 0.4 * chord);
      sfx.texture(Math.min(1, v / 0.2) * (0.35 + 0.65 * chord), Math.min(1, v / 0.45), 0);
      acc += v * 0.016;
      if (acc > next) {
        acc = 0;
        next = 0.003 + Math.random() * 0.005;
        sfx.grain(Math.min(1, v / 0.22) * (0.45 + 0.55 * chord), 1, 0);
      }
      const speedN = Math.min(1, v / 0.35);
      if (Math.random() < 0.016 * (3 + 11 * speedN) * (0.4 + 0.6 * chord)) sfx.tinkle(0.25 + 0.6 * speedN, 0);
      clickAcc += v * 0.016;
      if (clickAcc > 0.024) {
        clickAcc = 0;
        sfx.metalClick(0.25 + 0.4 * speedN, 0);
      }
      await wait(16);
    }
    sfx.textureStop();
    sfx.through(speed, 1, 0);
    sfx.knifeBoard(0.4, 0);
    await wait(220);
    sfx.impact("board", 0.9, 1, -0.3);
    await wait(130);
    sfx.impact("board", 0.6, 1, 0.3);
    await wait(90);
    sfx.impact("glass", 0.4, 1, 0);
    await wait(900);
  }
  rec.stop();
  await new Promise((r) => (rec.onstop = r));
  const blob = new Blob(chunks, { type: "audio/webm" });
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
