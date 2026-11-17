// Procedural glass fruits: shape, skin colouring, glass material, cut-face (interior) shader and
// small attachments such as stems and leaves.
//
// Every fruit body is a surface of revolution (or a sweep along an arc for the banana) built as one
// closed, watertight mesh so the slicer can cut it again and again. The cut faces get a separate
// material whose shader paints the flesh, seeds, core and rind from object-space position, so any cut
// through any piece shows the right slice of the inside.
import * as THREE from "three";
import { NOISE, v3 } from "./glsl.js";

// ---------- small JS noise for shapes and skin colour ----------
const fr = (x) => x - Math.floor(x);
const h3 = (x, y, z) => fr(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const sm = (t) => t * t * (3 - 2 * t);
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), fx), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), fx), fy),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), fx), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz,
  );
}
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- geometry ----------
/** Profile from control points [r, y], bottom pole to top pole. */
function profile(points) {
  return new THREE.CatmullRomCurve3(points.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, "centripetal");
}

/** An ellipse profile with optional pointed tips (lemons, limes). */
function ellipseProfile(rr, ry, { tip = 0, tipW = 0.18, top = 0, n = 24 } = {}) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    let r = rr * Math.sin(a);
    let y = -ry * Math.cos(a);
    const e = Math.exp(-Math.pow(a / tipW, 2)) + Math.exp(-Math.pow((Math.PI - a) / tipW, 2));
    y += Math.sign(y) * tip * e;
    if (i === n) y -= top;
    pts.push([i === 0 || i === n ? 0 : r, y]);
  }
  return profile(pts);
}

/**
 * Builds a closed surface of revolution. `place(t, r, y, phi, m)` may bend it (banana);
 * `radial(t, phi)` scales the radius per direction; `color(t, phi, p)` returns a linear rgb.
 */
function revolve({ curve, rows = 56, cols = 72, radial = () => 1, place = null, color = () => [1, 1, 1] }) {
  const samples = curve.getSpacedPoints(rows);
  const pos = [], col = [], uv = [];
  const push = (p, t, phi) => {
    pos.push(p[0], p[1], p[2]);
    col.push(...color(t, phi, p));
    uv.push(0, t);
  };
  const at = (i, phi) => {
    const t = i / rows;
    const s = samples[i];
    const r = i === 0 || i === rows ? 0 : s.x;
    const m = radial(t, phi);
    if (place) return place(t, r, s.y, phi, m);
    return [r * m * Math.cos(phi), s.y, r * m * Math.sin(phi)];
  };
  push(at(0, 0), 0, 0);
  for (let i = 1; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const phi = (j / cols) * Math.PI * 2;
      push(at(i, phi), i / rows, phi);
    }
  push(at(rows, 0), 1, 0);
  const top = 1 + (rows - 1) * cols;
  const ring = (i, j) => 1 + (i - 1) * cols + (j % cols);
  const idx = [];
  for (let j = 0; j < cols; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < rows - 1; i++)
    for (let j = 0; j < cols; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  for (let j = 0; j < cols; j++) idx.push(top, ring(rows - 1, j), ring(rows - 1, j + 1));
  // make sure the triangles face outwards
  let vol = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  if (vol < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Signed distance to the skin in (radius, height) space, baked into a small texture so the cut-face
 * shader knows how deep below the skin each point is (rind, pith and peel bands follow the real shape).
 */
function sdfTexture(curve, { w = 48, h = 96, range = 0.05 } = {}) {
  const pts = curve.getSpacedPoints(240).map((p, i, a) => [i === 0 || i === a.length - 1 ? 0 : p.x, p.y]);
  let rmax = 0, y0 = Infinity, y1 = -Infinity;
  for (const [r, y] of pts) {
    rmax = Math.max(rmax, r);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  rmax *= 1.12;
  y0 -= 0.006;
  y1 += 0.006;
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const pr = ((i + 0.5) / w) * rmax, py = y0 + ((j + 0.5) / h) * (y1 - y0);
      let md = Infinity, inside = false;
      for (let k = 0; k < pts.length - 1; k++) {
        const [ar, ay] = pts[k], [br, by] = pts[k + 1];
        const dx = br - ar, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((pr - ar) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        md = Math.min(md, Math.hypot(pr - ar - dx * t, py - ay - dy * t));
        if (ay > py !== by > py && pr < ((br - ar) * (py - ay)) / (by - ay) + ar) inside = !inside;
      }
      const d = inside ? -md : md;
      const v = Math.round(Math.min(1, Math.max(0, 0.5 + d / range)) * 255);
      const o = (j * w + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, w, h);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, rs: 1 / rmax, y0, yinv: 1 / (y1 - y0), range };
}

// ---------- attachments ----------
function glassPart(color, atten, { rough = 0.08, side = THREE.FrontSide, dist = 0.02 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, transmission: 1, roughness: rough, thickness: 0.004, ior: 1.5, attenuationColor: atten,
    attenuationDistance: dist, specularIntensity: 1, side, dispersion: 0.2,
  });
}
function stem(points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, 16, radius, 8, false);
  // taper towards the tip and close the end with a small dome
  const p = g.attributes.position;
  const end = new THREE.SphereGeometry(radius * 0.8, 8, 6);
  end.translate(...points[points.length - 1]);
  const m = new THREE.Mesh(g, mat);
  m.add(new THREE.Mesh(end, mat));
  p.needsUpdate = true;
  return m;
}
/** A leaf: pointed oval, folded along its vein and arched. Length along +x from the origin. */
function leafGeometry(len, wid, { fold = 0.35, arch = 0.25, segs = 18 } = {}) {
  const g = new THREE.PlaneGeometry(len, wid, segs, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + len / 2, y = p.getY(i);
    const u = x / len;
    const halfW = (wid / 2) * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.9);
    const yy = (y / (wid / 2)) * halfW;
    const z = Math.abs(yy) * fold - arch * len * (u - 0.5) * (u - 0.5) * 1.5;
    p.setXYZ(i, x, yy, z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- materials ----------
const SHADER_KEY = (id, kind) => `glassfruit-${id}-${kind}`;

function injectCommon(shader, extra) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vObj;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position;");
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj;\n" + NOISE + extra);
}

function skinMaterial(def) {
  const g = def.glass;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, transmission: 1, roughness: g.rough ?? 0.05, ior: g.ior ?? 1.5,
    thickness: def.size * 1.7, attenuationColor: new THREE.Color(g.atten), attenuationDistance: (g.dist ?? 0.05) * 1.9,
    dispersion: g.dispersion ?? 0.35, specularIntensity: 1, envMapIntensity: 1.15,
    sheen: g.sheen ?? 0, sheenRoughness: 0.5, sheenColor: new THREE.Color(g.sheenColor ?? 0xffffff),
    clearcoat: g.clearcoat ?? 0, clearcoatRoughness: 0.08,
  });
  const skin = def.skin || "float skinH(vec3 p){ return 0.0; } vec3 skinCol(vec3 p){ return vec3(1.0); }";
  m.onBeforeCompile = (shader) => {
    injectCommon(shader, skin);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= skinCol(vObj);")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, skinH(vObj));");
  };
  m.customProgramCacheKey = () => SHADER_KEY(def.id, "skin");
  return m;
}

function capMaterial(def, clip) {
  const g = def.glass;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, transmission: 1, roughness: 0.14, ior: g.ior ?? 1.5,
    thickness: def.size * 1.5, attenuationColor: new THREE.Color(g.capAtten ?? g.atten), attenuationDistance: g.capDist ?? 0.09,
    dispersion: 0.25, specularIntensity: 0.35, envMapIntensity: 0.65,
  });
  if (clip) m.clippingPlanes = [new THREE.Plane()];
  const sdf = def.sdf;
  const f = (x) => x.toFixed(5);
  const lookup = /* glsl */ `
uniform sampler2D uSdf;
float depthAt(vec3 p){
  vec2 rh = toRest(p);
  float d = texture2D(uSdf, vec2(rh.x * ${f(sdf.rs)}, (rh.y - ${f(sdf.y0)}) * ${f(sdf.yinv)})).r;
  return -(d - 0.5) * ${f(sdf.range)};
}`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSdf = { value: sdf.tex };
    injectCommon(shader, def.rest + lookup + def.interior);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat iRough = 0.0; float iTrans = 1.0;\ndiffuseColor.rgb *= interior(vObj, iRough, iTrans);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + iRough, 0.02, 1.0);")
      .replace("#include <transmission_fragment>", THREE.ShaderChunk.transmission_fragment.replace("material.transmission = transmission;", "material.transmission = transmission * iTrans;"));
  };
  m.customProgramCacheKey = () => SHADER_KEY(def.id, clip ? "capclip" : "cap");
  return m;
}

// ---------- shared GLSL snippets ----------
const REVOLVE_REST = "vec2 toRest(vec3 p){ return vec2(length(p.xz), p.y); }";
const PORES = (scale, depth) => /* glsl */ `
float skinH(vec3 p){ vec3 c; vec2 v = cells(p * ${scale}, c); float k = 1.0 - smoothstep(0.0, 0.5, v.x); return -${depth} * 0.16 * k * k + 0.00005 * fbm(p * 260.0); }`;

function citrusInterior({ R, N, flesh, membrane, pith, peel, pithDepth, peelDepth, seeds = false }) {
  return /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 q = p / ${R.toFixed(4)};
  float rho = length(q.xz); float ang = atan(q.z, q.x);
  float seg = ang / 6.28318 * ${N.toFixed(1)};
  float fs = fract(seg + 0.06 * sin(rho * 9.0));
  float edgeDist = min(fs, 1.0 - fs) * 6.28318 / ${N.toFixed(1)} * rho;
  vec3 col = ${v3(flesh)};
  rough = 0.05; trans = 0.85;
  vec3 c; vec2 ves = cells(vec3(rho * 12.0, seg * 4.0, q.y * 34.0), c);
  float sac = smoothstep(0.75, 0.08, ves.x);
  col *= 0.82 + 0.3 * sac;
  rough += 0.14 * (1.0 - sac);
  float mem = smoothstep(0.016, 0.0, edgeDist) * smoothstep(0.08, 0.14, rho);
  col = mix(col, ${v3(membrane)}, mem * 0.9); rough += mem * 0.3;
  float core = smoothstep(0.13, 0.07, rho * (1.0 + 0.15 * sin(ang * ${N.toFixed(1)})));
  col = mix(col, ${v3(pith)}, core); rough += core * 0.3;
  ${seeds ? `
  for (int k = 0; k < 3; k++){
    float a = (floor(seg) + 0.5 + float(k) * 3.0) * 6.28318 / ${N.toFixed(1)};
    vec3 sc = vec3(cos(a) * 0.22, 0.05 * float(k) - 0.05, sin(a) * 0.22);
    vec3 d = q - sc; vec3 dir = normalize(vec3(cos(a), 0.0, sin(a)));
    float al = dot(d, dir); vec3 pe = d - al * dir;
    float s = smoothstep(1.0, 0.75, (al / 0.10) * (al / 0.10) + dot(pe, pe) / 0.0016);
    col = mix(col, vec3(0.95, 0.92, 0.75), s); rough = mix(rough, 0.25, s);
  }` : ""}
  float pi = smoothstep(${pithDepth.toFixed(4)}, ${(pithDepth * 0.7).toFixed(4)}, dep);
  col = mix(col, ${v3(pith)}, pi); rough += pi * 0.35;
  float pe = smoothstep(${peelDepth.toFixed(4)}, ${(peelDepth * 0.6).toFixed(4)}, dep);
  vec3 cc; vec2 oil = cells(p * 700.0, cc);
  col = mix(col, ${v3(peel)} * (0.85 + 0.3 * smoothstep(0.4, 0.0, oil.x)), pe);
  rough = mix(rough, 0.08, pe);
  return col;
}`;
}

function stoneInterior({ flesh, fleshIn, pit, pitR, pitCol, skin, skinDepth = 0.0014 }) {
  return /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 qp = p / vec3(${pitR.map((x) => x.toFixed(4)).join(",")});
  float pe = length(qp);
  vec3 col = mix(${v3(fleshIn)}, ${v3(flesh)}, smoothstep(1.0, 2.2, pe));
  col *= 0.9 + 0.16 * vnoise(normalize(p) * 26.0 + pe * 2.5);
  rough = 0.06 + 0.1 * fbm(p * 420.0); trans = 0.78;
  float g = fbm(p * 320.0);
  float pit = smoothstep(1.02, 0.96, pe + 0.12 * (g - 0.5));
  col = mix(col, ${v3(pitCol)} * (0.55 + 0.7 * g), pit);
  trans = mix(trans, ${pit.toFixed(2)}, pit); rough = mix(rough, 0.7, pit);
  float sk = smoothstep(${skinDepth.toFixed(4)}, ${(skinDepth * 0.4).toFixed(4)}, dep);
  col = mix(col, ${v3(skin)}, sk);
  return col;
}`;
}

function pomeInterior({ R, flesh, coreLine, chamber, seed, skin, coreY = 0, coreScale = 1, grit = 0 }) {
  return /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 q = (p - vec3(0.0, ${coreY.toFixed(4)}, 0.0)) / (${R.toFixed(4)} * ${coreScale.toFixed(3)});
  float rho = length(q.xz); float ang = atan(q.z, q.x);
  vec3 col = ${v3(flesh)};
  rough = 0.07 + 0.07 * fbm(p * 500.0); trans = 0.62;
  float shape = sqrt(max(0.0, 1.0 - q.y * q.y * 1.7));
  float ring = abs(rho - (0.42 + 0.045 * cos(5.0 * ang)) * shape);
  col = mix(col, ${v3(coreLine)}, smoothstep(0.035, 0.0, ring) * 0.85 * step(0.05, shape));
  float lobeR = (0.08 + 0.11 * pow(abs(cos(2.5 * ang)), 3.0)) * sqrt(max(0.0, 1.0 - pow(q.y / 0.45, 2.0)));
  float ch = smoothstep(0.015, -0.01, rho - lobeR);
  col = mix(col, ${v3(chamber)}, ch); rough += ch * 0.35;
  for (int k = 0; k < 5; k++){
    float a = 6.28318 * float(k) / 5.0;
    vec3 sc = vec3(cos(a) * 0.15, 0.03, sin(a) * 0.15);
    vec3 dir = normalize(vec3(cos(a), 0.45, sin(a)));
    vec3 d = q - sc; float al = dot(d, dir); vec3 pe = d - al * dir;
    float s = smoothstep(1.0, 0.75, (al / 0.12) * (al / 0.12) + dot(pe, pe) / 0.0026);
    col = mix(col, ${v3(seed)}, s); trans = mix(trans, 0.18, s); rough = mix(rough, 0.3, s);
  }
  ${grit ? `vec3 gc; vec2 gr = cells(p * 650.0, gc); float gs = smoothstep(0.22, 0.1, gr.x) * step(gr.y, ${grit.toFixed(2)});
  col = mix(col, vec3(1.0, 0.98, 0.9), gs * 0.7); rough += gs * 0.3;` : ""}
  col = mix(col, vec3(1.0, 0.95, 0.82), smoothstep(0.006, 0.002, dep) * 0.35);
  col = mix(col, ${v3(skin)}, smoothstep(0.0016, 0.0006, dep));
  return col;
}`;
}

// ---------- the fruits ----------
function blush(hiHex, loHex, dir = [0.6, 0.3, 0.75], k = 1.4, streaks = 0) {
  const hi = lin(hiHex), lo = lin(loHex);
  const l = Math.hypot(...dir);
  return (t, phi, p) => {
    const r = Math.hypot(p[0], p[1], p[2]) || 1;
    const d = (p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / (r * l);
    let b = smoothstep(-0.6, 0.9, d * k + (noise3(p[0] * 60, p[1] * 60, p[2] * 60) - 0.5) * 0.8);
    if (streaks) b *= 1 - streaks * smoothstep(0.55, 0.9, noise3(Math.cos(phi) * 3 + 9, t * 2.2, Math.sin(phi) * 3) * (0.6 + noise3(phi * 9, t * 40, 1)));
    return mix3(lo, hi, b);
  };
}

const DEFS = [];

// apple
{
  const curve = profile([[0, -0.026], [0.006, -0.0295], [0.015, -0.0335], [0.027, -0.0305], [0.0355, -0.017], [0.039, -0.001], [0.0383, 0.014], [0.0335, 0.0265], [0.023, 0.0325], [0.0125, 0.0305], [0.0055, 0.0235], [0, 0.0205]]);
  DEFS.push({
    id: "apple", name: "사과", size: 0.038, hardness: 1.0, curve,
    radial: (t, phi) => 1 + 0.028 * Math.cos(5 * phi) * smoothstep(0.45, 0.0, t) + 0.012 * (noise3(Math.cos(phi) * 2, t * 4, Math.sin(phi) * 2) - 0.5),
    color: blush(0xfff2b0, 0xff3b4a, [0.7, 0.2, 0.6], 1.1, 0.5),
    glass: { atten: 0xc8102e, dist: 0.05, capAtten: 0xfff4d6, capDist: 0.12 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.00008 * fbm(p * 300.0); }
vec3 skinCol(vec3 p){ vec3 c; vec2 v = cells(p * 520.0, c); return mix(vec3(1.0), vec3(1.25, 1.2, 0.95), smoothstep(0.16, 0.05, v.x) * step(v.y, 0.5)); }`,
    interior: pomeInterior({ R: 0.038, flesh: 0xfff3cf, coreLine: 0xe2f0a8, chamber: 0xfffbea, seed: 0x5a2e12, skin: 0xd81f2c }),
    orient: "upright",
    attach(add) {
      const brown = glassPart(0xffe7c2, 0x6b3a12, { dist: 0.006 });
      add(stem([[0, 0.019, 0], [0.0012, 0.03, 0.0005], [0.004, 0.038, 0.001]], 0.0017, brown), [0, 0.025, 0]);
      const leaf = new THREE.Mesh(leafGeometry(0.036, 0.016), glassPart(0xd9ffc4, 0x2f8a1e, { side: THREE.DoubleSide, dist: 0.01 }));
      leaf.position.set(0.0025, 0.032, 0.001);
      leaf.rotation.set(0.3, 0.4, 0.45);
      add(leaf, [0, 0.03, 0]);
    },
  });
}
// pear
{
  const curve = profile([[0, -0.044], [0.009, -0.0445], [0.022, -0.0405], [0.032, -0.03], [0.036, -0.016], [0.0335, -0.002], [0.026, 0.012], [0.0195, 0.026], [0.0165, 0.038], [0.0125, 0.048], [0.006, 0.0535], [0, 0.0525]]);
  DEFS.push({
    id: "pear", name: "배", size: 0.036, hardness: 0.9, curve,
    radial: (t, phi) => 1 + 0.015 * (noise3(Math.cos(phi) * 2, t * 3, Math.sin(phi) * 2) - 0.5),
    color: blush(0xffd6a0, 0xd8f070, [0.6, 0.1, 0.8], 0.9),
    glass: { atten: 0x9fb51c, dist: 0.06, capAtten: 0xfffbe0, capDist: 0.14 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.0001 * fbm(p * 320.0); }
vec3 skinCol(vec3 p){ vec3 c; vec2 v = cells(p * 380.0, c); return mix(vec3(1.0), vec3(0.75, 0.62, 0.45), smoothstep(0.17, 0.06, v.x) * step(v.y, 0.6)); }`,
    interior: pomeInterior({ R: 0.036, flesh: 0xfffae0, coreLine: 0xf0f2c8, chamber: 0xfffdf0, seed: 0x3d2210, skin: 0xb8c832, coreY: -0.012, coreScale: 0.95, grit: 0.35 }),
    orient: "upright",
    attach(add) {
      const brown = glassPart(0xffe2bd, 0x5a3010, { dist: 0.006 });
      add(stem([[0, 0.051, 0], [0.001, 0.06, 0], [0.004, 0.068, 0.001]], 0.0018, brown), [0, 0.05, 0]);
    },
  });
}
// orange
{
  const curve = ellipseProfile(0.037, 0.0345, { top: 0.002, n: 28 });
  DEFS.push({
    id: "orange", name: "오렌지", size: 0.037, hardness: 0.85, curve,
    radial: (t, phi) => 1 + 0.006 * (noise3(Math.cos(phi) * 3, t * 5, Math.sin(phi) * 3) - 0.5),
    color: blush(0xffd27a, 0xffa23a, [0.5, 0.8, 0.3], 0.8),
    glass: { atten: 0xff7a00, dist: 0.05, capAtten: 0xffb347, capDist: 0.07 },
    rest: REVOLVE_REST,
    skin: PORES("620.0", "0.00035") + "\nvec3 skinCol(vec3 p){ return vec3(1.0); }",
    interior: citrusInterior({ R: 0.037, N: 11, flesh: 0xffa53a, membrane: 0xfff1d6, pith: 0xfff6e6, peel: 0xff8a1a, pithDepth: 0.0042, peelDepth: 0.0013 }),
    orient: "upright",
    attach(add) {
      const g = new THREE.CylinderGeometry(0.0032, 0.0042, 0.0018, 5);
      const m = new THREE.Mesh(g, glassPart(0xe9ffd0, 0x4a7a1a, { dist: 0.006 }));
      m.position.set(0, 0.0333, 0);
      add(m, [0, 0.03, 0]);
    },
  });
}
// lemon
{
  const curve = ellipseProfile(0.0285, 0.039, { tip: 0.0065, tipW: 0.2, n: 30 });
  DEFS.push({
    id: "lemon", name: "레몬", size: 0.036, hardness: 0.9, curve,
    radial: (t, phi) => 1 + 0.01 * (noise3(Math.cos(phi) * 3, t * 5, Math.sin(phi) * 3) - 0.5),
    color: () => lin(0xfff36b),
    glass: { atten: 0xffd400, dist: 0.06, capAtten: 0xfff07a, capDist: 0.09 },
    rest: REVOLVE_REST,
    skin: PORES("700.0", "0.0003") + "\nvec3 skinCol(vec3 p){ return vec3(1.0); }",
    interior: citrusInterior({ R: 0.029, N: 9, flesh: 0xfff07a, membrane: 0xfffbe6, pith: 0xfffcf0, peel: 0xffe11a, pithDepth: 0.0034, peelDepth: 0.0011, seeds: true }),
    orient: "side",
  });
}
// lime
{
  const curve = ellipseProfile(0.0265, 0.028, { tip: 0.0025, tipW: 0.2, n: 26 });
  DEFS.push({
    id: "lime", name: "라임", size: 0.028, hardness: 0.9, curve,
    radial: () => 1,
    color: blush(0xd8ff8a, 0x9be04a, [0.4, 0.6, 0.7], 0.6),
    glass: { atten: 0x3d9a1a, dist: 0.04, capAtten: 0xc6f07a, capDist: 0.08 },
    rest: REVOLVE_REST,
    skin: PORES("760.0", "0.00028") + "\nvec3 skinCol(vec3 p){ return vec3(1.0); }",
    interior: citrusInterior({ R: 0.0265, N: 10, flesh: 0xc4f070, membrane: 0xf2ffe0, pith: 0xf6fff0, peel: 0x5dbb2a, pithDepth: 0.0018, peelDepth: 0.0009 }),
    orient: "side",
  });
}
// kiwi
{
  const curve = ellipseProfile(0.0262, 0.0355, { n: 28 });
  const flat = 0.9;
  DEFS.push({
    id: "kiwi", name: "키위", size: 0.033, hardness: 0.75, curve,
    radial: (t, phi) => 1 / Math.sqrt(Math.cos(phi) ** 2 + (Math.sin(phi) / flat) ** 2) * (1 + 0.012 * (noise3(Math.cos(phi) * 2, t * 4, Math.sin(phi) * 2) - 0.5)),
    color: blush(0xe8c890, 0xc8a26a, [0.3, 0.9, 0.3], 0.5),
    glass: { atten: 0x7a5a20, dist: 0.035, rough: 0.16, sheen: 0.8, sheenColor: 0xf0d8a0, capAtten: 0x8fd13f, capDist: 0.05 },
    rest: `vec2 toRest(vec3 p){ return vec2(length(vec2(p.x, p.z / ${flat.toFixed(2)})), p.y); }`,
    skin: `float skinH(vec3 p){ return 0.00012 * fbm(p * 900.0); } vec3 skinCol(vec3 p){ return vec3(0.92 + 0.16 * fbm(p * 400.0)); }`,
    interior: /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 q = vec3(p.x, p.y, p.z / ${flat.toFixed(2)}) / vec3(0.0262, 0.0355, 0.0262);
  float rho = length(q.xz); float ang = atan(q.z, q.x);
  float taper = sqrt(max(0.003, 1.0 - q.y * q.y));
  float r = rho / taper;
  vec3 col = ${v3(0x86cf2e)}; rough = 0.06; trans = 0.8;
  float streak = 0.5 + 0.5 * sin(ang * 64.0 + fbm(p * 300.0) * 7.0);
  col *= mix(0.86, 1.12, streak * smoothstep(0.25, 0.7, r));
  col = mix(col, ${v3(0xd6f07a)}, smoothstep(0.5, 0.26, r) * 0.75);
  float core = smoothstep(0.205, 0.17, r * (1.0 + 0.08 * sin(ang * 7.0)));
  col = mix(col, ${v3(0xf6f6d6)}, core); rough += core * 0.25;
  for (int row = 0; row < 2; row++){
    float n = 44.0;
    float a = ang / 6.28318 * n + float(row) * 0.5;
    float ci = floor(a); float fa = fract(a) - 0.5;
    float h = hash13(vec3(ci, float(row), 3.0));
    float rs = 0.29 + 0.065 * float(row) + 0.05 * (h - 0.5);
    float dr = (r - rs) / 0.05; float da = fa * 6.28318 / n * r / 0.017;
    float s = smoothstep(1.0, 0.55, dr * dr + da * da) * step(0.22, h);
    col = mix(col, ${v3(0x120a04)}, s); trans = mix(trans, 0.08, s); rough = mix(rough, 0.2, s);
  }
  col = mix(col, ${v3(0x7a5a2c)}, smoothstep(0.0016, 0.0006, dep));
  return col;
}`,
    orient: "side",
  });
}
// strawberry
{
  const curve = profile([[0, -0.0245], [0.0045, -0.0215], [0.011, -0.0125], [0.0175, -0.001], [0.0225, 0.0105], [0.0232, 0.0175], [0.0185, 0.0225], [0.009, 0.0245], [0, 0.0225]]);
  DEFS.push({
    id: "strawberry", name: "딸기", size: 0.024, hardness: 0.65, curve,
    radial: (t, phi) => 1 + 0.035 * (noise3(Math.cos(phi) * 1.6, t * 2.5, Math.sin(phi) * 1.6) - 0.5),
    color: (t) => mix3(lin(0xff7a7a), lin(0xff2a3c), smoothstep(0.0, 0.5, t)),
    glass: { atten: 0xd1001f, dist: 0.03, capAtten: 0xff6a7a, capDist: 0.05 },
    rest: REVOLVE_REST,
    skin: /* glsl */ `
float skinH(vec3 p){ vec3 c; vec2 v = cells(p * 230.0, c); float k = 1.0 - smoothstep(0.05, 0.36, v.x); return -0.00028 * k * k; }
vec3 skinCol(vec3 p){ vec3 c; vec2 v = cells(p * 230.0, c); return mix(vec3(1.0), vec3(2.4, 2.1, 0.55), smoothstep(0.12, 0.05, v.x)); }`,
    interior: /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 q = p / 0.024; float rho = length(q.xz); float ang = atan(q.z, q.x);
  float core = smoothstep(0.62, 0.3, rho / max(0.2, 1.0 - 0.55 * max(0.0, -q.y))) * smoothstep(-0.98, -0.5, q.y);
  vec3 col = mix(${v3(0xf0283c)}, ${v3(0xfff0f2)}, core);
  col = mix(col, ${v3(0xff8fa0)}, smoothstep(0.15, 0.0, abs(core - 0.5)) * 0.5);
  float fib = smoothstep(0.55, 1.0, sin(ang * 20.0 + fbm(p * 200.0) * 5.0)) * (1.0 - core) * smoothstep(0.0035, 0.008, dep);
  col = mix(col, ${v3(0xff9fb0)}, fib * 0.6);
  col = mix(col, ${v3(0xb8001a)}, smoothstep(0.005, 0.0012, dep));
  rough = 0.07 + fib * 0.15 + core * 0.22; trans = 0.8 - core * 0.35;
  return col;
}`,
    orient: "side",
    attach(add) {
      const green = glassPart(0xe2ffcc, 0x2e8a1c, { side: THREE.DoubleSide, dist: 0.008 });
      const n = 7;
      for (let i = 0; i < n; i++) {
        const l = new THREE.Mesh(leafGeometry(0.019, 0.0075, { fold: 0.25, arch: -0.5 }), green);
        const a = (i / n) * Math.PI * 2 + 0.2;
        l.position.set(0, 0.0235, 0);
        l.rotation.set(0, -a, 0);
        l.rotateZ(-0.35);
        l.rotateX(Math.PI / 2);
        add(l, [Math.cos(a) * 0.004, 0.022, Math.sin(a) * 0.004]);
      }
      add(stem([[0, 0.023, 0], [0.0008, 0.029, 0], [0.0025, 0.034, 0.0008]], 0.0013, green), [0, 0.022, 0]);
    },
  });
}
// peach
{
  const curve = profile([[0, -0.0335], [0.012, -0.033], [0.026, -0.026], [0.0355, -0.011], [0.037, 0.004], [0.0335, 0.019], [0.024, 0.0305], [0.011, 0.0345], [0.004, 0.0325], [0, 0.0305]]);
  DEFS.push({
    id: "peach", name: "복숭아", size: 0.036, hardness: 0.75, curve,
    radial: (t, phi) => {
      let a = phi;
      if (a > Math.PI) a -= Math.PI * 2;
      return (1 - 0.055 * Math.exp(-Math.pow(a / 0.2, 2)) * smoothstep(0.05, 0.35, t) * smoothstep(1.0, 0.75, t)) * (1 + 0.01 * (noise3(Math.cos(phi) * 2, t * 3, Math.sin(phi) * 2) - 0.5));
    },
    color: blush(0xff8f80, 0xffd28a, [0.2, 0.7, -0.7], 1.2),
    glass: { atten: 0xff6a3c, dist: 0.05, rough: 0.12, sheen: 0.9, sheenColor: 0xffe6d0, capAtten: 0xffc070, capDist: 0.08 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.00008 * fbm(p * 700.0); } vec3 skinCol(vec3 p){ return vec3(1.0); }`,
    interior: stoneInterior({ flesh: 0xffc56a, fleshIn: 0xff6a3e, pit: 0.22, pitR: [0.0125, 0.0155, 0.0105], pitCol: 0x8a4428, skin: 0xff5a40 }),
    orient: "upright",
  });
}
// plum
{
  const curve = ellipseProfile(0.026, 0.0295, { top: 0.002, n: 26 });
  DEFS.push({
    id: "plum", name: "자두", size: 0.028, hardness: 0.8, curve,
    radial: (t, phi) => {
      let a = phi;
      if (a > Math.PI) a -= Math.PI * 2;
      return 1 - 0.04 * Math.exp(-Math.pow(a / 0.22, 2)) * smoothstep(0.05, 0.4, t) * smoothstep(1.0, 0.7, t);
    },
    color: blush(0xd070c0, 0x8a2a8a, [0.4, 0.8, 0.3], 0.7),
    glass: { atten: 0x5a0a50, dist: 0.035, rough: 0.14, capAtten: 0xffd04a, capDist: 0.07 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.00006 * fbm(p * 500.0); } vec3 skinCol(vec3 p){ return vec3(0.95 + 0.12 * fbm(p * 180.0)); }`,
    interior: stoneInterior({ flesh: 0xffd34d, fleshIn: 0xff9a3a, pit: 0.25, pitR: [0.0085, 0.013, 0.0065], pitCol: 0x9a6a40, skin: 0x5a1240 }),
    orient: "upright",
    attach(add) {
      add(stem([[0, 0.027, 0], [0.0005, 0.033, 0], [0.002, 0.037, 0]], 0.0011, glassPart(0xe8ffd0, 0x5a6a20, { dist: 0.006 })), [0, 0.026, 0]);
    },
  });
}
// mango
{
  const curve = ellipseProfile(0.034, 0.05, { n: 30, tip: 0.002 });
  const flat = 0.82, bend = 0.008;
  DEFS.push({
    id: "mango", name: "망고", size: 0.045, hardness: 0.85, curve,
    radial: (t, phi) => 1 / Math.sqrt(Math.cos(phi) ** 2 + (Math.sin(phi) / flat) ** 2),
    place: (t, r, y, phi, m) => [r * m * Math.cos(phi) + bend * (1 - (y / 0.05) ** 2), y, r * m * Math.sin(phi)],
    color: (t, phi, p) => {
      const g = lin(0x9ad84a), y = lin(0xffd23a), rd = lin(0xff5a3a);
      const u = smoothstep(-0.05, 0.05, p[1] + 0.02 * p[0] / 0.034);
      return mix3(mix3(g, y, smoothstep(0, 0.6, u)), rd, smoothstep(0.55, 1, u) * smoothstep(-0.01, 0.03, p[0]));
    },
    glass: { atten: 0xff9a00, dist: 0.06, capAtten: 0xffb300, capDist: 0.06 },
    rest: `vec2 toRest(vec3 p){ float x = p.x - ${bend.toFixed(4)} * (1.0 - pow(p.y / 0.05, 2.0)); return vec2(length(vec2(x, p.z / ${flat.toFixed(2)})), p.y); }`,
    skin: `float skinH(vec3 p){ return 0.00007 * fbm(p * 300.0); } vec3 skinCol(vec3 p){ vec3 c; vec2 v = cells(p * 420.0, c); return mix(vec3(1.0), vec3(1.3, 1.25, 1.0), smoothstep(0.14, 0.05, v.x) * step(v.y, 0.4)); }`,
    interior: stoneInterior({ flesh: 0xffb30f, fleshIn: 0xffd040, pit: 0.35, pitR: [0.012, 0.036, 0.0055], pitCol: 0xf2e2b0, skin: 0x9acd32, skinDepth: 0.0012 }),
    orient: "flat",
  });
}
// watermelon
{
  const curve = ellipseProfile(0.05, 0.058, { n: 32 });
  DEFS.push({
    id: "watermelon", name: "수박", size: 0.055, hardness: 1.2, curve,
    radial: (t, phi) => 1 + 0.008 * (noise3(Math.cos(phi) * 2, t * 4, Math.sin(phi) * 2) - 0.5),
    color: (t, phi) => {
      const w = Math.sin(phi * 16 + 0.9 * Math.sin(t * 22 + phi * 3) + 2.5 * (noise3(Math.cos(phi) * 4, t * 9, Math.sin(phi) * 4) - 0.5));
      const stripe = smoothstep(0.1, 0.55, w);
      return mix3(lin(0xc9f58a), lin(0x2f9a3a), stripe);
    },
    glass: { atten: 0x1f7a2a, dist: 0.045, capAtten: 0xff4060, capDist: 0.08 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.00012 * fbm(p * 140.0); } vec3 skinCol(vec3 p){ return vec3(1.0); }`,
    interior: /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 col = ${v3(0xff3355)};
  vec3 c; vec2 g = cells(p * 170.0, c);
  col *= 0.88 + 0.24 * smoothstep(0.6, 0.0, g.x);
  rough = 0.05 + 0.12 * fbm(p * 350.0); trans = 0.8;
  vec3 cc; vec2 sd = cells(p * 92.0, cc); vec3 cp = cc / 92.0;
  float cdep = depthAt(cp);
  float band = step(0.015, cdep) * step(cdep, 0.03) * step(sd.y, 0.5);
  vec3 dv = p - cp; vec3 dir = normalize(cp * vec3(1.0, 0.55, 1.0) + 1e-5);
  float al = dot(dv, dir); vec3 pe = dv - al * dir;
  float s = band * smoothstep(1.0, 0.7, (al / 0.0045) * (al / 0.0045) + dot(pe, pe) / (0.0025 * 0.0025));
  col = mix(col, ${v3(0x160a06)}, s); trans = mix(trans, 0.06, s); rough = mix(rough, 0.18, s);
  col = mix(col, ${v3(0xf2f8d8)}, smoothstep(0.011, 0.0075, dep));
  col = mix(col, ${v3(0x9fd06a)}, smoothstep(0.0062, 0.0038, dep));
  col = mix(col, ${v3(0x1f6b2a)}, smoothstep(0.0026, 0.0012, dep));
  return col;
}`,
    orient: "side",
  });
}
// banana: swept along an arc
{
  const RA = 0.12, TH = 1.25, R0 = 0.0175;
  const rAt = (t) => R0 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.42) * (1 - 0.12 * smoothstep(0.5, 1, t));
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([i === 0 || i === 40 ? 0 : rAt(t), (t - 0.5) * RA * TH]);
  }
  const curve = profile(pts);
  DEFS.push({
    id: "banana", name: "바나나", size: 0.03, hardness: 0.6, curve,
    radial: (t, phi) => 1 + 0.07 * Math.pow(Math.abs(Math.cos(2.5 * phi)), 0.5) - 0.035,
    place: (t, r, y, phi, m) => {
      const th = (y / (RA * TH)) * TH;
      const cx = RA * Math.sin(th), cy = RA * Math.cos(th) - RA;
      const nx = Math.sin(th), ny = Math.cos(th); // outward normal of the arc
      const rr = r * m;
      return [cx + nx * rr * Math.cos(phi), cy + ny * rr * Math.cos(phi), rr * Math.sin(phi)];
    },
    color: (t) => {
      const end = Math.max(smoothstep(0.1, 0.0, t), smoothstep(0.88, 1.0, t));
      const green = Math.max(smoothstep(0.25, 0.05, t), smoothstep(0.75, 0.92, t)) * 0.6;
      return mix3(mix3(lin(0xfff07a), lin(0xd8f070), green), lin(0x6a4a20), end);
    },
    glass: { atten: 0xffcc00, dist: 0.06, capAtten: 0xfff2b8, capDist: 0.1 },
    rest: `vec2 toRest(vec3 p){ vec3 v = p + vec3(0.0, ${RA.toFixed(4)}, 0.0); float th = atan(v.x, v.y); return vec2(length(vec2(length(v.xy) - ${RA.toFixed(4)}, v.z)), th * ${RA.toFixed(4)}); }`,
    skin: `float skinH(vec3 p){ return 0.00006 * fbm(p * vec3(120.0, 120.0, 600.0)); } vec3 skinCol(vec3 p){ vec3 c; vec2 v = cells(p * 300.0, c); return mix(vec3(1.0), vec3(0.55, 0.42, 0.25), smoothstep(0.12, 0.04, v.x) * step(v.y, 0.12)); }`,
    interior: /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 v = p + vec3(0.0, ${RA.toFixed(4)}, 0.0);
  float rad = length(v.xy) - ${RA.toFixed(4)};
  float dr = length(vec2(rad, v.z));
  float ang = atan(v.z, rad);
  float rN = dr / max(dr + dep, 1e-4);
  vec3 col = ${v3(0xfff2bf)}; rough = 0.08 + 0.08 * fbm(p * 400.0); trans = 0.55;
  float tri = rN - 0.2 * (1.0 + 0.25 * cos(3.0 * ang));
  col = mix(col, ${v3(0xf3e3a2)}, smoothstep(0.05, -0.02, tri));
  col = mix(col, vec3(1.0, 0.97, 0.86), smoothstep(0.1, 0.0, abs(sin(1.5 * ang))) * smoothstep(0.65, 0.2, rN) * 0.45);
  vec3 c; vec2 s = cells(p * 900.0, c);
  float sd = smoothstep(0.26, 0.1, s.x) * step(s.y, 0.5) * smoothstep(0.22, 0.12, rN);
  col = mix(col, ${v3(0x3a2a14)}, sd); trans = mix(trans, 0.2, sd);
  col = mix(col, ${v3(0xffd21f)}, smoothstep(0.0024, 0.0012, dep));
  return col;
}`,
    orient: "banana",
    sdfOpts: { w: 32, h: 128 },
  });
}
// dragon fruit
{
  const curve = ellipseProfile(0.034, 0.047, { n: 30, tip: 0.003 });
  DEFS.push({
    id: "dragonfruit", name: "용과", size: 0.042, hardness: 0.7, curve,
    radial: (t, phi) => 1 + 0.02 * (noise3(Math.cos(phi) * 2.5, t * 5, Math.sin(phi) * 2.5) - 0.5),
    color: () => lin(0xff6ab8),
    glass: { atten: 0xe0007a, dist: 0.04, capAtten: 0xffffff, capDist: 0.3 },
    rest: REVOLVE_REST,
    skin: `float skinH(vec3 p){ return 0.0001 * fbm(p * 200.0); } vec3 skinCol(vec3 p){ return vec3(1.0); }`,
    interior: /* glsl */ `
vec3 interior(vec3 p, out float rough, out float trans){
  float dep = depthAt(p);
  vec3 col = ${v3(0xfdfaf6)};
  vec3 c; vec2 s = cells(p * 520.0, c);
  float sd = smoothstep(0.3, 0.17, s.x) * step(s.y, 0.55) * smoothstep(0.003, 0.006, dep);
  col = mix(col, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.3, s.x) * 0.35);
  col = mix(col, ${v3(0x050505)}, sd);
  trans = mix(0.45, 0.04, sd); rough = 0.07 + sd * 0.1 + 0.06 * fbm(p * 300.0);
  col = mix(col, ${v3(0xff2e93)}, smoothstep(0.0032, 0.0018, dep));
  return col;
}`,
    orient: "side",
    attach(add) {
      const mat = glassPart(0xffd0ea, 0x2a9a3a, { side: THREE.DoubleSide, dist: 0.012 });
      const n = 14;
      for (let i = 0; i < n; i++) {
        const t = 0.2 + 0.62 * ((i * 0.618) % 1);
        const phi = i * 2.4;
        const p = curve.getPointAt(t);
        const nrm = curve.getTangentAt(t);
        const leaf = new THREE.Mesh(leafGeometry(0.02, 0.009, { fold: 0.15, arch: 0.4 }), mat);
        leaf.position.set(p.x * 0.97 * Math.cos(phi), p.y, p.x * 0.97 * Math.sin(phi));
        leaf.rotation.set(0, -phi, 0);
        leaf.rotateZ(Math.atan2(nrm.y, nrm.x) - 0.25);
        leaf.rotateX(Math.PI / 2);
        add(leaf, [p.x * 0.9 * Math.cos(phi), p.y, p.x * 0.9 * Math.sin(phi)]);
      }
    },
  });
}

export const FRUITS = DEFS;
export const FRUIT_BY_ID = Object.fromEntries(DEFS.map((d) => [d.id, d]));

/** Builds the meshes, materials and baked data for a fruit type once. */
export function prepare(def) {
  if (def.ready) return def;
  def.sdf = sdfTexture(def.curve, def.sdfOpts);
  const geo = revolve({ curve: def.curve, rows: 64, cols: 80, radial: def.radial, place: def.place, color: def.color });
  def.geometry = geo;
  def.skinMat = skinMaterial(def);
  def.capMat = capMaterial(def, false);
  def.makeClipCap = () => capMaterial(def, true);
  def.ready = true;
  return def;
}

/** Fresh attachment meshes for one fruit: [{ mesh, anchor: Vector3 }]. */
export function makeAttachments(def) {
  const list = [];
  if (def.attach)
    def.attach((mesh, anchor) => {
      mesh.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
        }
      });
      list.push({ mesh, anchor: new THREE.Vector3(...anchor) });
    });
  return list;
}

/** Resting orientation for a freshly spawned fruit. */
export function restQuaternion(def, yaw) {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  if (def.orient === "side") e.set(0, yaw, Math.PI / 2 + (Math.random() - 0.5) * 0.3, "YXZ");
  else if (def.orient === "flat") e.set(Math.PI / 2, yaw, 0, "YXZ");
  else if (def.orient === "banana") e.set(-Math.PI / 2 + 0.15, yaw, 0, "YXZ");
  else e.set((Math.random() - 0.5) * 0.15, yaw, (Math.random() - 0.5) * 0.15, "YXZ");
  q.setFromEuler(e);
  return q;
}
