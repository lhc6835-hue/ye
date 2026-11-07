// Bundles the game's code into one HTML file, dist/index.html, with the audio beside it in dist/assets.
// node tools/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

const res = await build({ entryPoints: ["src/main.js"], bundle: true, minify: true, format: "iife", write: false, target: "es2020" });
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("index.html", "utf8").replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>${js}</script>`,
);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);
cpSync("assets", "dist/assets", { recursive: true });
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KB, plus dist/assets`);
