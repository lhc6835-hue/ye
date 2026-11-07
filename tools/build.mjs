// Bundles the game into one self-contained HTML file: dist/catchute.html.
// node tools/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const res = await build({ entryPoints: ["src/main.js"], bundle: true, minify: true, format: "iife", write: false, target: "es2020" });
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("index.html", "utf8").replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>${js}</script>`,
);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/catchute.html", html);
console.log(`dist/catchute.html  ${(html.length / 1024).toFixed(1)} KB`);
