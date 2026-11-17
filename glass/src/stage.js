// Renderer, camera, studio lighting, the white backdrop and the wooden cutting board.
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const V = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
const asset = (p) => `assets/${p}?v=${V}`;

export const BOARD = { w: 0.42, h: 0.022, d: 0.28 };
export const BOARD_TOP = BOARD.h;

export const QUALITY = {
  low: { ratio: 1, shadow: 1024, radius: 3, trans: 0.5 },
  medium: { ratio: 1.5, shadow: 1536, radius: 4, trans: 0.75 },
  high: { ratio: 2, shadow: 2048, radius: 5, trans: 1 },
};

export class Stage {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    r.setClearColor(0xffffff, 1);

    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color(0xffffff); // drawn as the clear colour: stays pure white

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.02, 10);
    this.target = new THREE.Vector3(0, 0.03, 0);

    // key light with soft shadows, plus a gentle fill
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 2.3));
    key.position.set(-0.32, 0.9, 0.28);
    key.castShadow = true;
    const sc = key.shadow.camera;
    sc.left = -0.42; sc.right = 0.42; sc.top = 0.42; sc.bottom = -0.42; sc.near = 0.2; sc.far = 2.0;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0012;
    s.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xfff6ee, 0.45);
    fill.position.set(0.6, 0.4, 0.5);
    s.add(fill);
    this.lightDir = key.position.clone().normalize();

    // white table that only shows the shadows that fall on it
    const table = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.16, color: 0x2a2018 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    s.add(table);
    // soft contact shadow under the board
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w * 1.35, BOARD.d * 1.5), new THREE.MeshBasicMaterial({ map: softBlob(), transparent: true, depthWrite: false, color: 0x3a2a1a, opacity: 0.32 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.0004;
    s.add(blob);

    this.quality = "high";
    this.resize();
  }

  async load(onProgress = () => {}) {
    const r = this.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    const tl = new THREE.TextureLoader();
    let done = 0;
    const tick = () => onProgress(++done / 4);
    const [hdr, diff, nor, rough] = await Promise.all([
      new HDRLoader().loadAsync(asset("tex/studio.hdr")).then((t) => (tick(), t)),
      tl.loadAsync(asset("tex/wood_diff.jpg")).then((t) => (tick(), t)),
      tl.loadAsync(asset("tex/wood_nor_gl.jpg")).then((t) => (tick(), t)),
      tl.loadAsync(asset("tex/wood_rough.jpg")).then((t) => (tick(), t)),
    ]);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.0;
    this.scene.environmentRotation.y = 0.6;

    diff.colorSpace = THREE.SRGBColorSpace;
    for (const t of [diff, nor, rough]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(0.75, 0.75);
      t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy());
    }
    this.woodTex = { diff, nor, rough };
    const board = new THREE.Mesh(
      new RoundedBoxGeometry(BOARD.w, BOARD.h, BOARD.d, 6, 0.007),
      new THREE.MeshPhysicalMaterial({
        map: diff, normalMap: nor, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: rough, roughness: 0.92,
        color: 0xfff4e8, clearcoat: 0.12, clearcoatRoughness: 0.4, sheen: 0.2, sheenRoughness: 0.8, sheenColor: 0xfff0dc,
      }),
    );
    board.position.y = BOARD.h / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    this.scene.add(board);
    this.board = board;
  }

  setQuality(name) {
    this.quality = name;
    const q = QUALITY[name];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    r.transmissionResolutionScale = q.trans;
    const sh = this.key.shadow;
    if (sh.mapSize.x !== q.shadow) {
      sh.mapSize.set(q.shadow, q.shadow);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    sh.radius = q.radius;
    sh.blurSamples = 12;
    this.resize();
  }

  /** Fits the board on screen; portrait screens look along the board's length. */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    const portrait = h > w * 1.05;
    this.portrait = portrait;
    cam.fov = portrait ? 38 : 30;
    const yaw = portrait ? Math.PI / 2 : 0;
    const elev = THREE.MathUtils.degToRad(portrait ? 52 : 42);
    this.forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // horizontal view direction
    this.right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
    const corners = [];
    const [hx, hz] = portrait ? [0.12, 0.08] : [0.165, 0.105];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 0.08]) corners.push(new THREE.Vector3(sx * hx, y, sz * hz));
    let lo = 0.2, hi = 4;
    const v = new THREE.Vector3();
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(this.target).addScaledVector(dir, mid);
      cam.lookAt(this.target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const fits = corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) < 0.94 && v.y > -0.9 && v.y < 0.7;
      });
      if (fits) hi = mid;
      else lo = mid;
    }
    cam.position.copy(this.target).addScaledVector(dir, hi);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/** A soft round blob, opaque in the middle and fading to nothing at the edge. */
export function softBlob(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    grad.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.2).toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** A focused-light glint: bright core with a bright rim, like light gathered by a glass ball. */
export function causticTexture(size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const s = size / 2;
  const grad = g.createRadialGradient(s, s, 0, s, s, s);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.12)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.3)");
  grad.addColorStop(0.86, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
