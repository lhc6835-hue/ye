// Bundles the game into one HTML file, dist/index.html, with sounds and textures beside it in dist/assets.
// node tools/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

// ARTIFACT=1 writes dist-artifact/: page content without the document wrapper, plain asset URLs
const artifact = !!process.env.ARTIFACT;
const version = artifact ? "" : Date.now().toString(36);
const res = await build({
  entryPoints: ["src/main.js"], bundle: true, minify: true, format: "iife", write: false, target: "es2020",
  define: { __VERSION__: JSON.stringify(version) }, legalComments: "none",
});
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("index.html", "utf8").replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>${js}</script>`,
);
const out = artifact ? "dist-artifact" : "dist";
let page = html;
if (artifact) {
  // the artifact host supplies <!doctype>, <html>, <head> and <body> itself
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, "").replace(/<meta name="viewport"[^>]*>\s*/, "");
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  // artifacts can't serve .hdr files, so the HDRI rides along inside the page
  const hdr = readFileSync("assets/tex/studio.hdr").toString("base64");
  page = head.replace("<title>Glass Fruit</title>", '<title>Glass Fruit</title>\n    <meta name="claude:viewport-fit-sides" content="cover" />') + body.replace("<script>", `<script>window.__HDR="${hdr}";</script>\n    <script>`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/index.html`, page);
cpSync("assets", `${out}/assets`, { recursive: true, filter: (f) => !(artifact && f.endsWith(".hdr")) });
console.log(`${out}/index.html  ${(page.length / 1024).toFixed(1)} KB, plus ${out}/assets`);
