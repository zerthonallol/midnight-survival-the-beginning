// Prologue level: the player's 7th-floor apartment on a stormy night. Plain three.js, browser-only.
import * as THREE from "three";
import { Sfx } from "./audio";
import { createRain, Lightning } from "./atmosphere";
import { APARTMENT, voiceUrl, type Lang } from "./story";
import parquetUrl from "@/assets/apartment/parquet.jpg";
import wallpaperUrl from "@/assets/apartment/wallpaper.jpg";
import tileUrl from "@/assets/apartment/tile.jpg";
import rugUrl from "@/assets/apartment/rug.jpg";
import viewUrl from "@/assets/apartment/window-view.jpg";
import photoUrl from "@/assets/apartment/photo.jpg";

export interface AptHud { prompt: string; objective: string; subtitle: string; paused: boolean; flashlight: boolean }
export interface AptCallbacks { onHud: (h: AptHud) => void; onProgress: (p: number) => void; onReady: () => void; onDone: () => void }

type Box = [number, number, number, number]; // minX, minZ, maxX, maxZ
interface Spot { id: string; pos: THREE.Vector3; label: () => string; ok: () => boolean; use: () => void }

const H = 2.7, T = 0.12, EYE = 1.65, R = 0.28;
const WALK = 1.9, RUN = 3.2;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const woodTex = (base: string, dark: string) => canvasTex(512, 512, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = dark; g.globalAlpha = 0.08 + Math.random() * 0.18; g.lineWidth = 1 + Math.random() * 3;
    const y = Math.random() * 512; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
});
const fabricTex = (base: string) => canvasTex(256, 256, (g) => {
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * 0.08})`;
    g.fillRect(x, y, 2, 2);
  }
  g.strokeStyle = "rgba(0,0,0,0.12)";
  for (let i = 0; i < 256; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
});
const plasterTex = () => canvasTex(256, 256, (g) => {
  g.fillStyle = "#d9d4c8"; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(80,70,50,${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
});
const linoTex = () => canvasTex(512, 512, (g) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? "#7b6a55" : "#a89478"; g.fillRect(x * 64, y * 64, 64, 64);
  }
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
});
const quiltTex = () => canvasTex(256, 512, (g) => {
  g.fillStyle = "#3a2018"; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = "#1c0f0b"; g.lineWidth = 3;
  for (let i = -512; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 512, 512); g.stroke(); g.beginPath(); g.moveTo(i + 512, 0); g.lineTo(i, 512); g.stroke(); }
  g.fillStyle = "#b08a4a";
  for (let y = 0; y < 512; y += 64) for (let x = 0; x < 256; x += 64) { g.beginPath(); g.arc(x + 32, y, 4, 0, 7); g.fill(); }
}, false);
const dropsTex = () => canvasTex(512, 512, (g) => {
  g.clearRect(0, 0, 512, 512);
  for (let i = 0; i < 380; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 1 + Math.random() * 3.5;
    g.fillStyle = `rgba(200,220,235,${0.15 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(x, y, r * 0.8, r, 0, 0, 7); g.fill();
    if (Math.random() < 0.15) { g.strokeStyle = "rgba(200,220,235,0.18)"; g.lineWidth = r * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.random() * 4 - 2, y + 30 + Math.random() * 80); g.stroke(); }
  }
});

export class Apartment {
  touch = { mx: 0, my: 0, lookX: 0, lookY: 0, sprint: false };
  readonly isTouch: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sfx = new Sfx();
  private timer = new THREE.Timer();
  private raf = 0;
  private keys = new Set<string>();
  private pos = new THREE.Vector3(2.2, 0, 4.4);
  private yaw = 0.3;
  private pitch = 0;
  private boxes: Box[] = [];
  private spots: Spot[] = [];
  private focus: Spot | null = null;
  private done = new Set<string>();
  private loader: THREE.TextureLoader;
  private lightning = new Lightning();
  private rain!: ReturnType<typeof createRain>;
  private view!: THREE.MeshBasicMaterial;
  private storm!: THREE.DirectionalLight;
  private lamps: { light: THREE.PointLight; bulb: THREE.MeshStandardMaterial; base: number }[] = [];
  private tvLight!: THREE.PointLight;
  private tvScreen!: THREE.CanvasTexture;
  private tvOn = false;
  private led!: THREE.MeshBasicMaterial;
  private flash!: THREE.SpotLight;
  private flashOn = false;
  private voice: HTMLAudioElement | null = null;
  private subtitle = "";
  private stepT = 0;
  private hudT = 0;
  private blackout = 0;
  private finished = false;
  private hand: { keys: THREE.Object3D; flash: THREE.Object3D } = { keys: new THREE.Object3D(), flash: new THREE.Object3D() };
  private door!: THREE.Group;
  private doorOpen = 0;

  constructor(private container: HTMLElement, private cb: AptCallbacks, private lang: Lang) {
    this.isTouch = window.matchMedia("(pointer: coarse)").matches;
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_u, l, t) => cb.onProgress(l / t);
    manager.onLoad = () => { this.renderer.compile(this.scene, this.camera); cb.onReady(); this.say("a_wake"); };
    this.loader = new THREE.TextureLoader(manager);

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.isTouch, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isTouch ? 1.25 : 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.03, 80);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.fog = new THREE.Fog("#0b0f14", 14, 40);
    this.scene.background = new THREE.Color("#05070a");

    this.build();
    this.bind();
    this.sfx.startRain(0.22);
    this.lightning.thunder = (d, v) => this.sfx.thunder(d, v);
    this.timer.connect(document);
    if (import.meta.env.DEV) (window as unknown as { __apt: Apartment }).__apt = this;
    this.loop();
  }

  // ---------- materials ----------
  private tex(url: string, rx = 1, ry = 1) {
    const t = this.loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }
  private mat(p: THREE.MeshStandardMaterialParameters) {
    return this.isTouch ? new THREE.MeshLambertMaterial({ map: p.map ?? null, color: p.color ?? "#ffffff", emissive: p.emissive ?? "#000000", emissiveIntensity: p.emissiveIntensity ?? 1, transparent: p.transparent, opacity: p.opacity ?? 1, side: p.side }) as unknown as THREE.MeshStandardMaterial
      : new THREE.MeshStandardMaterial({ roughness: 0.8, ...p });
  }
  private box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, collide = false, parent: THREE.Object3D = this.scene) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, z);
    parent.add(mesh);
    if (collide) this.boxes.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
    return mesh;
  }
  private cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16, parent: THREE.Object3D = this.scene) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    mesh.position.set(x, y + h / 2, z);
    parent.add(mesh);
    return mesh;
  }

  /** Wall segment along an axis with rectangular openings (doors/windows). */
  private wall(axis: "x" | "z", fixed: number, a: number, b: number, wallTex: string, holes: { a: number; b: number; y0: number; y1: number }[] = [], tiled = 1.1) {
    const pieces: [number, number, number, number][] = []; // from, to, y0, y1
    let cur = a;
    for (const h of [...holes].sort((p, q) => p.a - q.a)) {
      if (h.a > cur) pieces.push([cur, h.a, 0, H]);
      if (h.y0 > 0) pieces.push([h.a, h.b, 0, h.y0]);
      if (h.y1 < H) pieces.push([h.a, h.b, h.y1, H]);
      cur = h.b;
    }
    if (cur < b) pieces.push([cur, b, 0, H]);
    for (const [f, t, y0, y1] of pieces) {
      const len = t - f, hh = y1 - y0;
      const m = this.mat({ map: this.tex(wallTex, len / tiled, hh / tiled), roughness: 0.95 });
      const mid = (f + t) / 2;
      if (axis === "x") this.box(len, hh, T, m, mid, y0, fixed, y0 === 0);
      else this.box(T, hh, len, m, fixed, y0, mid, y0 === 0);
    }
    // skirting board
    const sk = this.mat({ map: woodTex("#5a3a22", "#2a180c"), roughness: 0.6 });
    for (const [f, t, y0] of pieces) if (y0 === 0 && !holes.some((h) => h.y0 === 0 && f >= h.a && t <= h.b)) {
      const len = t - f, mid = (f + t) / 2;
      if (axis === "x") { this.box(len, 0.08, 0.02, sk, mid, 0, fixed + T / 2 + 0.01); this.box(len, 0.08, 0.02, sk, mid, 0, fixed - T / 2 - 0.01); }
      else { this.box(0.02, 0.08, len, sk, fixed + T / 2 + 0.01, 0, mid); this.box(0.02, 0.08, len, sk, fixed - T / 2 - 0.01, 0, mid); }
    }
  }

  private window(x0: number, x1: number, drops: THREE.Texture) {
    const frameM = this.mat({ color: "#e8e2d4", roughness: 0.5 });
    const y0 = 0.9, y1 = 2.35, w = x1 - x0, cxw = (x0 + x1) / 2;
    this.box(w + 0.1, 0.06, 0.08, frameM, cxw, y0 - 0.03, 0);
    this.box(w + 0.1, 0.06, 0.08, frameM, cxw, y1 - 0.03, 0);
    this.box(0.06, y1 - y0, 0.08, frameM, x0, y0, 0);
    this.box(0.06, y1 - y0, 0.08, frameM, x1, y0, 0);
    this.box(0.05, y1 - y0, 0.07, frameM, cxw, y0, 0);
    this.box(w, 0.05, 0.07, frameM, cxw, y0 + 1.0, 0);
    // glass with running drops
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, y1 - y0), new THREE.MeshBasicMaterial({ map: drops, transparent: true, opacity: 0.9, depthWrite: false, color: "#a8c0d0" }));
    glass.position.set(cxw, (y0 + y1) / 2, 0.01);
    this.scene.add(glass);
    const tint = new THREE.Mesh(new THREE.PlaneGeometry(w, y1 - y0), new THREE.MeshBasicMaterial({ color: "#0d1820", transparent: true, opacity: 0.18, depthWrite: false }));
    tint.position.set(cxw, (y0 + y1) / 2, 0.0);
    this.scene.add(tint);
    // sill + radiator
    const sill = this.mat({ color: "#f0ece2", roughness: 0.35 });
    this.box(w + 0.3, 0.04, 0.3, sill, cxw, y0 - 0.04, 0.15);
    const rad = this.mat({ color: "#d8d2c4", roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < Math.floor(w / 0.09); i++) this.box(0.06, 0.55, 0.1, rad, x0 + 0.1 + i * 0.09, 0.18, 0.18);
    this.cyl(0.015, 0.015, 0.18, rad, x0 + 0.12, 0, 0.2, 8);
    // curtains: wavy heavy drapes + sheer tulle
    const curtain = (cx: number, width: number, m: THREE.Material) => {
      const g = new THREE.PlaneGeometry(width, 2.45, 24, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * 0.04);
      g.computeVertexNormals();
      const c = new THREE.Mesh(g, m);
      c.position.set(cx, 1.35, 0.3);
      this.scene.add(c);
    };
    const drape = this.mat({ map: fabricTex("#5a2a24"), side: THREE.DoubleSide, roughness: 1 });
    curtain(x0 - 0.2, 0.55, drape);
    curtain(x1 + 0.2, 0.55, drape);
    const tulle = new THREE.MeshStandardMaterial({ color: "#f4efe4", transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    curtain(cxw - w * 0.33, w * 0.3, tulle);
    this.box(w + 1.2, 0.03, 0.03, this.mat({ color: "#b89a60", metalness: 0.6, roughness: 0.4 }), cxw, 2.58, 0.3);
    return { y0, y1 };
  }

  private build() {
    const sc = this.scene;
    const hemi = new THREE.HemisphereLight("#7a8aa8", "#2a2018", 0.5);
    sc.add(hemi);
    this.storm = new THREE.DirectionalLight("#b8ccff", 0);
    this.storm.position.set(3, 6, -8);
    sc.add(this.storm);
    const amb = new THREE.AmbientLight("#ffe2c0", 0.14);
    sc.add(amb);

    // outside: city view + rain
    this.view = new THREE.MeshBasicMaterial({ map: this.tex(viewUrl), fog: false, color: "#9aa4b0" });
    const view = new THREE.Mesh(new THREE.PlaneGeometry(36, 24), this.view);
    view.position.set(4.5, 0.5, -15);
    sc.add(view);
    this.rain = createRain(this.isTouch ? 900 : 2200, 9, 10);
    this.rain.uniforms.uCenter.value.set(4.5, 2, -5);
    sc.add(this.rain.mesh);
    // facade outside the window ledge
    const facade = this.mat({ color: "#5b5852", roughness: 1 });
    this.box(12, 0.15, 0.6, facade, 4.5, 0.6, -0.4);

    // floors and ceiling
    const floor = (x0: number, z0: number, x1: number, z1: number, m: THREE.Material) => {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
      f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); sc.add(f);
    };
    floor(0, 0, 5, 6, this.mat({ map: this.tex(parquetUrl, 2.5, 3), roughness: 0.45 }));
    floor(5, 3, 9, 6, this.mat({ map: this.tex(parquetUrl, 2, 1.5), roughness: 0.45 }));
    const lino = linoTex(); lino.repeat.set(2, 1.5);
    floor(5, 0, 9, 3, this.mat({ map: lino, roughness: 0.5 }));
    const ceilT = plasterTex(); ceilT.repeat.set(4, 3);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), this.mat({ map: ceilT, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(4.5, H, 3); sc.add(ceil);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.75), this.mat({ map: this.tex(rugUrl), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(2.2, 0.005, 3.1); sc.add(rug);

    // walls
    const drops = dropsTex();
    this.drops = drops;
    this.wall("x", 0, 0, 5, wallpaperUrl, [{ a: 0.9, b: 2.3, y0: 0.9, y1: 2.35 }, { a: 2.8, b: 4.2, y0: 0.9, y1: 2.35 }]);
    this.wall("x", 0, 5, 9, tileUrl, [{ a: 6.3, b: 7.9, y0: 0.9, y1: 2.35 }], 0.9);
    this.wall("x", 6, 0, 9, wallpaperUrl);
    this.wall("z", 0, 0, 6, wallpaperUrl);
    this.wall("z", 9, 0, 3, tileUrl, [], 0.9);
    this.wall("z", 9, 3, 6, wallpaperUrl, [{ a: 4.0, b: 5.0, y0: 0, y1: 2.1 }]);
    this.wall("z", 5, 0, 6, wallpaperUrl, [{ a: 3.6, b: 4.6, y0: 0, y1: 2.15 }]);
    this.wall("x", 3, 5, 9, wallpaperUrl, [{ a: 6.4, b: 7.3, y0: 0, y1: 2.15 }]);
    this.window(0.9, 2.3, drops);
    this.window(2.8, 4.2, drops);
    this.window(6.3, 7.9, drops);
    // door frames
    const jamb = this.mat({ map: woodTex("#e6dfcf", "#b8ad98"), roughness: 0.5 });
    for (const [x, z, ax] of [[5, 4.1, "z"], [6.85, 3, "x"]] as const) {
      if (ax === "z") { this.box(0.18, 0.08, 1.1, jamb, x, 2.15, z); this.box(0.18, 2.15, 0.06, jamb, x, 0, z - 0.52); this.box(0.18, 2.15, 0.06, jamb, x, 0, z + 0.52); }
      else { this.box(1.0, 0.08, 0.18, jamb, x, 2.15, z); this.box(0.06, 2.15, 0.18, jamb, x - 0.47, 0, z); this.box(0.06, 2.15, 0.18, jamb, x + 0.47, 0, z); }
    }
    // outside: stairwell box beyond front door
    const stair = this.mat({ color: "#3e5a4e", roughness: 1 });
    this.box(0.1, H, 3, stair, 10.6, 0, 4.5);
    this.box(1.6, 0.02, 3, this.mat({ color: "#4a4640" }), 9.8, -0.01, 4.5);
    const stairLight = new THREE.PointLight("#b8ffcc", 0.6, 4, 2); stairLight.position.set(9.9, 2.4, 4.5); sc.add(stairLight);

    this.living();
    this.kitchen();
    this.hall();
    this.lightsSetup();

    // first-person flashlight
    this.flash = new THREE.SpotLight("#fff4dc", 0, 14, 0.5, 0.5, 1.5);
    this.flash.position.set(0.2, -0.15, 0);
    this.camera.add(this.flash);
    this.flash.target.position.set(0, -0.1, -1);
    this.camera.add(this.flash.target);
  }
  private drops!: THREE.Texture;

  private living() {
    const wood = this.mat({ map: woodTex("#6b4026", "#2b160a"), roughness: 0.55 });
    const darkWood = this.mat({ map: woodTex("#3d2516", "#180a04"), roughness: 0.45 });
    // "stenka" wall unit along the back wall (z=6)
    this.box(3.2, 2.3, 0.45, darkWood, 2.2, 0, 5.75, true);
    const glassM = new THREE.MeshStandardMaterial({ color: "#88a0a8", transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.4 });
    this.box(1.0, 0.9, 0.02, glassM, 1.4, 1.15, 5.51);
    const bookCols = ["#6b1e1e", "#1f3d5c", "#2e4a2a", "#7a6a3a", "#3a2a4a", "#8a4a20", "#20302e"];
    for (let shelf = 0; shelf < 2; shelf++) {
      let x = 2.35;
      while (x < 3.6) {
        const w = 0.03 + Math.random() * 0.04, h = 0.22 + Math.random() * 0.1;
        this.box(w, h, 0.18, this.mat({ color: bookCols[Math.floor(Math.random() * bookCols.length)], roughness: 0.9 }), x, 1.2 + shelf * 0.42, 5.5);
        x += w + 0.005;
      }
    }
    // crystal glasses behind glass
    const crystal = new THREE.MeshStandardMaterial({ color: "#d8f0ff", transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.2 });
    for (let i = 0; i < 6; i++) this.cyl(0.03, 0.025, 0.1, crystal, 1.05 + i * 0.13, 1.25, 5.62, 10);
    // the photo frame on the open shelf
    const frame = this.box(0.26, 0.22, 0.02, this.mat({ color: "#a8884a", metalness: 0.5, roughness: 0.4 }), 1.3, 0.78, 5.48);
    frame.rotation.x = -0.15;
    const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.18), this.mat({ map: this.tex(photoUrl), roughness: 0.6 }));
    ph.position.set(0, 0, -0.012); ph.rotation.y = Math.PI; frame.add(ph);
    this.spot("photo", new THREE.Vector3(1.3, 0.9, 5.45), () => this.l("Посмотреть фотографию", "Look at the photo"), () => true, () => { this.done.add("photo"); this.say("a_photo"); });

    // CRT TV on a stand by the left wall
    this.box(0.5, 0.55, 1.2, wood, 0.3, 0, 3.1, true);
    const tv = new THREE.Group(); tv.position.set(0.35, 0.55, 3.1); this.scene.add(tv);
    const plastic = this.mat({ color: "#2a2826", roughness: 0.5 });
    this.box(0.5, 0.48, 0.62, plastic, 0, 0, 0, false, tv);
    this.tvScreen = canvasTex(256, 192, (g) => { g.fillStyle = "#0a0c0c"; g.fillRect(0, 0, 256, 192); }, false);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.36), new THREE.MeshBasicMaterial({ map: this.tvScreen, toneMapped: false }));
    screen.position.set(0.255, 0.25, 0); screen.rotation.y = Math.PI / 2; tv.add(screen);
    this.cyl(0.004, 0.004, 0.45, this.mat({ color: "#aaa", metalness: 0.9 }), -0.05, 0.48, -0.08, 6, tv).rotation.z = 0.5;
    this.cyl(0.004, 0.004, 0.45, this.mat({ color: "#aaa", metalness: 0.9 }), -0.05, 0.48, 0.08, 6, tv).rotation.z = -0.5;
    this.spot("tv", new THREE.Vector3(0.6, 0.85, 3.1), () => this.tvOn ? this.l("Выключить телевизор", "Turn off the TV") : this.l("Включить телевизор", "Turn on the TV"), () => true, () => {
      this.tvOn = !this.tvOn; this.sfx.click();
      if (this.tvOn && !this.done.has("tv")) { this.done.add("tv"); this.say("a_tv"); }
    });

    // sofa facing the TV
    const fabric = this.mat({ map: fabricTex("#5d4a3a"), roughness: 1 });
    this.box(0.95, 0.42, 2.1, fabric, 3.6, 0, 3.1, true);
    this.box(0.25, 0.55, 2.1, fabric, 4.0, 0.42, 3.1);
    this.box(0.95, 0.25, 0.22, fabric, 3.6, 0.42, 2.0);
    this.box(0.95, 0.25, 0.22, fabric, 3.6, 0.42, 4.2);
    for (const z of [2.6, 3.6]) { const c = this.box(0.55, 0.14, 0.9, this.mat({ map: fabricTex("#6e5845") }), 3.45, 0.42, z); c.scale.set(1, 1, 0.98); }
    const pillow = this.box(0.12, 0.35, 0.35, this.mat({ map: fabricTex("#8a6a3a") }), 3.85, 0.56, 2.4); pillow.rotation.z = -0.3;
    const blanket = this.box(0.5, 0.05, 0.9, this.mat({ map: fabricTex("#3a4a5a") }), 3.5, 0.56, 3.9); blanket.rotation.y = 0.2;
    // coffee table with mug and newspaper
    this.box(0.6, 0.04, 1.0, wood, 2.2, 0.42, 3.1, true);
    for (const [dx, dz] of [[-0.25, -0.45], [0.25, -0.45], [-0.25, 0.45], [0.25, 0.45]]) this.box(0.04, 0.42, 0.04, wood, 2.2 + dx, 0, 3.1 + dz);
    this.cyl(0.04, 0.035, 0.09, this.mat({ color: "#e8e0d0", roughness: 0.3 }), 2.1, 0.46, 2.85, 14);
    const paper = this.box(0.3, 0.005, 0.4, this.mat({ color: "#d8d0bc" }), 2.25, 0.46, 3.3); paper.rotation.y = 0.4;
    // floor lamp
    const brass = this.mat({ color: "#a08040", metalness: 0.7, roughness: 0.35 });
    this.cyl(0.15, 0.18, 0.03, brass, 4.55, 0, 5.2);
    this.cyl(0.015, 0.015, 1.5, brass, 4.55, 0.03, 5.2, 8);
    this.cyl(0.14, 0.24, 0.3, this.mat({ color: "#e8c890", emissive: "#ffb060", emissiveIntensity: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }), 4.55, 1.45, 5.2, 18);
    // wall clock + carpet on the wall (very 80s)
    const clock = this.cyl(0.18, 0.18, 0.04, this.mat({ color: "#efe8d8" }), 0.07, 1.9, 1.4, 24); clock.rotation.z = Math.PI / 2;
    const wallRug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), this.mat({ map: this.tex(rugUrl), roughness: 1 }));
    wallRug.position.set(3.6 + 0.45, 1.55, 3.1); wallRug.rotation.y = -Math.PI / 2; wallRug.scale.set(1, 1, 1);
    wallRug.position.x = 4.93; this.scene.add(wallRug);
    // chandelier
    this.cyl(0.01, 0.01, 0.35, brass, 2.4, H - 0.35, 3.1, 6);
    this.cyl(0.25, 0.1, 0.12, this.mat({ color: "#f4ecd8", emissive: "#ffd8a0", emissiveIntensity: 0.8 }), 2.4, H - 0.47, 3.1, 20);
    // window spot
    this.spot("window", new THREE.Vector3(3.5, 1.5, 0.3), () => this.l("Выглянуть в окно", "Look out the window"), () => this.done.has("phone"), () => {
      this.done.add("window"); this.say("a_window"); this.lightning.update(99); this.sfx.thunder(0.3, 1);
    });
  }

  private kitchen() {
    const cab = this.mat({ map: woodTex("#c8b48a", "#8a7450"), roughness: 0.6 });
    const top = this.mat({ color: "#7a6e60", roughness: 0.4 });
    // counter along x=9
    this.box(0.6, 0.85, 2.6, cab, 8.65, 0, 1.6, true);
    this.box(0.64, 0.04, 2.6, top, 8.63, 0.85, 1.6);
    this.box(0.35, 0.7, 2.0, cab, 8.78, 1.5, 1.4);
    // sink + tap
    const steel = this.mat({ color: "#c0c4c8", metalness: 0.9, roughness: 0.25 });
    this.box(0.45, 0.02, 0.5, steel, 8.6, 0.885, 1.0);
    this.cyl(0.012, 0.012, 0.25, steel, 8.85, 0.89, 1.0, 8);
    // stove with kettle
    this.box(0.6, 0.86, 0.55, this.mat({ color: "#e8e4dc", roughness: 0.3 }), 8.65, 0, 3.0 - 0.3, true);
    for (const [dx, dz] of [[-0.12, -0.12], [0.12, 0.12], [-0.12, 0.12], [0.12, -0.12]]) this.cyl(0.07, 0.07, 0.01, this.mat({ color: "#222" }), 8.65 + dx, 0.86, 2.7 + dz, 14);
    this.cyl(0.06, 0.09, 0.16, this.mat({ color: "#2f5a8a", roughness: 0.3, metalness: 0.2 }), 8.53, 0.87, 2.58, 16);
    // rounded old fridge in the corner
    const fridge = this.mat({ color: "#eeeae0", roughness: 0.25 });
    this.box(0.65, 1.6, 0.65, fridge, 5.45, 0, 0.45, true);
    this.box(0.03, 0.25, 0.04, steel, 5.75, 1.0, 0.8);
    // table + stools + calendar
    const tw = this.mat({ map: woodTex("#a07850", "#5a3c20"), roughness: 0.5 });
    this.box(0.8, 0.04, 0.8, tw, 6.6, 0.72, 2.2, true);
    this.box(0.08, 0.72, 0.08, tw, 6.6, 0, 2.2);
    for (const [x, z] of [[6.0, 2.2], [7.2, 2.2]]) { this.box(0.36, 0.03, 0.36, tw, x, 0.45, z); this.box(0.05, 0.45, 0.05, tw, x, 0, z); }
    const kettleLight = new THREE.PointLight("#ffd8a8", 0, 1, 2); kettleLight.position.set(6.6, 1.0, 2.2); this.scene.add(kettleLight);
    const calendar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), this.mat({ map: canvasTex(128, 180, (g) => {
      g.fillStyle = "#efe6d0"; g.fillRect(0, 0, 128, 180); g.fillStyle = "#8a1a1a"; g.font = "bold 22px serif"; g.fillText("НОЯБРЬ", 16, 32);
      g.fillStyle = "#222"; g.font = "12px serif"; for (let d = 1; d <= 30; d++) g.fillText(String(d), 10 + ((d - 1) % 7) * 16, 56 + Math.floor((d - 1) / 7) * 22);
      g.strokeStyle = "#c00"; g.lineWidth = 2; g.beginPath(); g.arc(10 + 6 * 16 + 6, 56 + 1 * 22 - 4, 9, 0, 7); g.stroke();
    }, false) }));
    calendar.position.set(5.07, 1.6, 2.0); calendar.rotation.y = Math.PI / 2; this.scene.add(calendar);
  }

  private hall() {
    // padded front door at x=9 (z 4..5)
    this.door = new THREE.Group();
    this.door.position.set(8.97, 0, 4.03);
    this.scene.add(this.door);
    const pad = this.mat({ map: quiltTex(), roughness: 0.7 });
    const leaf = this.box(0.06, 2.08, 0.94, pad, 0, 0, 0.47, false, this.door);
    leaf.position.x = 0;
    const brass = this.mat({ color: "#c0a050", metalness: 0.8, roughness: 0.3 });
    this.box(0.06, 0.03, 0.14, brass, -0.05, 1.0, 0.82, false, this.door);
    this.cyl(0.015, 0.015, 0.03, brass, -0.04, 1.55, 0.47, 8, this.door).rotation.z = Math.PI / 2;
    this.boxes.push([8.85, 4.0, 9.1, 5.0]);
    // coat hooks, coat, shoe rack, mirror
    const wood = this.mat({ map: woodTex("#6b4026", "#2b160a"), roughness: 0.55 });
    this.box(1.0, 0.1, 0.04, wood, 7.4, 1.7, 5.92);
    const coat = this.box(0.5, 0.95, 0.18, this.mat({ map: fabricTex("#2f3a2e") }), 7.2, 0.85, 5.8);
    coat.rotation.z = 0.04;
    this.box(0.25, 0.25, 0.25, this.mat({ map: fabricTex("#3a2a20") }), 7.7, 1.45, 5.82);
    this.box(0.9, 0.3, 0.3, wood, 7.4, 0, 5.8, true);
    for (let i = 0; i < 3; i++) this.box(0.12, 0.1, 0.28, this.mat({ color: ["#1a1410", "#3a2416", "#502a1a"][i] }), 7.1 + i * 0.3, 0.3, 5.8);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), new THREE.MeshStandardMaterial({ color: "#9aa8b0", metalness: 1, roughness: 0.08 }));
    mirror.position.set(5.07, 1.4, 5.2); mirror.rotation.y = Math.PI / 2; this.scene.add(mirror);
    // console with landline phone + answering machine
    this.box(0.4, 0.8, 0.8, wood, 5.3, 0, 4.9, true);
    const phoneM = this.mat({ color: "#7a1a14", roughness: 0.35 });
    this.box(0.2, 0.08, 0.24, phoneM, 5.3, 0.8, 4.75);
    const handset = this.box(0.05, 0.05, 0.24, phoneM, 5.36, 0.88, 4.75); handset.rotation.x = 0.05;
    this.box(0.18, 0.06, 0.22, this.mat({ color: "#1a1a1c", roughness: 0.4 }), 5.3, 0.8, 5.1);
    this.led = new THREE.MeshBasicMaterial({ color: "#ff2010", toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), this.led); led.position.set(5.4, 0.87, 5.05); this.scene.add(led);
    this.spot("phone", new THREE.Vector3(5.35, 0.9, 4.95), () => this.l("Прослушать автоответчик (1 сообщение)", "Play the answering machine (1 message)"), () => !this.done.has("phone"), () => {
      this.done.add("phone"); this.sfx.click(); this.sfx.tape();
      this.say("a_phone", () => { this.blackout = 2.2; this.sfx.thunder(0, 1); });
    });
    // key rack with car keys + flashlight
    this.box(0.25, 0.18, 0.03, wood, 8.89, 1.35, 3.5).rotation.y = Math.PI / 2;
    const keys = new THREE.Group(); keys.position.set(8.85, 1.38, 3.5); this.scene.add(keys);
    this.cyl(0.018, 0.018, 0.005, brass, 0, 0, 0, 10, keys).rotation.z = Math.PI / 2;
    this.box(0.01, 0.06, 0.015, this.mat({ color: "#c8c8c8", metalness: 0.9 }), 0, -0.07, 0, false, keys);
    this.box(0.015, 0.05, 0.03, this.mat({ color: "#111" }), 0, -0.06, 0.03, false, keys);
    this.hand.keys = keys;
    const torch = this.cyl(0.025, 0.03, 0.2, this.mat({ color: "#2a2a2a", metalness: 0.4, roughness: 0.4 }), 8.75, 0.3, 5.6, 12);
    torch.rotation.z = Math.PI / 2; torch.position.y = 0.33;
    this.hand.flash = torch;
    this.spot("keys", new THREE.Vector3(8.8, 1.3, 3.5), () => this.l("Взять ключи от машины и фонарик", "Take the car keys and flashlight"), () => this.ready() && !this.done.has("keys"), () => {
      this.done.add("keys"); this.sfx.pickup(); keys.visible = false; torch.visible = false; this.flashOn = true; this.say("a_keys");
    });
    this.spot("door", new THREE.Vector3(8.9, 1.2, 4.5), () => this.l("Выйти в подъезд", "Step out into the stairwell"), () => this.done.has("keys") && !this.finished, () => {
      this.finished = true; this.sfx.door();
      this.boxes = this.boxes.filter((b) => !(b[0] === 8.85 && b[1] === 4.0));
      this.say("a_door", () => this.cb.onDone());
    });
  }

  private lightsSetup() {
    const add = (x: number, y: number, z: number, color: string, intensity: number, dist: number) => {
      const light = new THREE.PointLight(color, intensity, dist, 1.6);
      light.position.set(x, y, z);
      this.scene.add(light);
      const bulb = new THREE.MeshStandardMaterial({ color: "#fff2d8", emissive: color, emissiveIntensity: 2 });
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), bulb); m.position.copy(light.position); this.scene.add(m);
      this.lamps.push({ light, bulb, base: intensity });
    };
    add(2.4, H - 0.55, 3.1, "#ffcf90", 7, 9);   // chandelier
    add(4.55, 1.55, 5.2, "#ffb060", 3, 5);     // floor lamp
    add(6.8, H - 0.25, 1.5, "#fff0c8", this.isTouch ? 0 : 2.2, 5);   // kitchen (flickers)
    add(7.2, H - 0.25, 4.6, "#ffe0b0", 3, 5);  // hall
    this.tvLight = new THREE.PointLight("#9ab8ff", 0, 5, 2);
    this.tvLight.position.set(1.0, 0.9, 3.1);
    this.scene.add(this.tvLight);
  }

  // ---------- helpers ----------
  private l(ru: string, en: string) { return this.lang === "ru" ? ru : en; }
  private spot(id: string, pos: THREE.Vector3, label: () => string, ok: () => boolean, use: () => void) { this.spots.push({ id, pos, label, ok, use }); }
  private ready() { return ["tv", "phone", "photo", "window"].every((k) => this.done.has(k)); }
  private objective() {
    if (this.finished) return "";
    if (this.done.has("keys")) return this.l("Выйти из квартиры", "Leave the apartment");
    if (this.ready()) return this.l("Взять ключи у входной двери", "Take the keys by the front door");
    const todo: string[] = [];
    if (!this.done.has("tv")) todo.push(this.l("включить телевизор", "turn on the TV"));
    if (!this.done.has("phone")) todo.push(this.l("прослушать автоответчик в прихожей", "check the answering machine in the hall"));
    if (!this.done.has("photo")) todo.push(this.l("найти старую фотографию", "find the old photo"));
    if (this.done.has("phone") && !this.done.has("window")) todo.push(this.l("выглянуть в окно", "look out the window"));
    return todo.join(" · ");
  }
  private say(id: string, after?: () => void) {
    this.voice?.pause();
    const line = APARTMENT[id];
    this.subtitle = line.text[this.lang];
    const a = new Audio(voiceUrl(this.lang, id));
    a.volume = 1;
    this.voice = a;
    let fired = false;
    const end = () => { if (fired) return; fired = true; if (this.voice === a) this.subtitle = ""; after?.(); };
    a.onended = end;
    a.onerror = () => setTimeout(end, 5000);
    a.play().catch(() => setTimeout(end, Math.max(4000, this.subtitle.length * 70)));
  }

  // ---------- input ----------
  lock() { if (!this.isTouch) this.renderer.domElement.requestPointerLock?.(); void this.sfx.ctx.resume(); }
  toggleFlash() { if (this.done.has("keys")) { this.flashOn = !this.flashOn; this.sfx.click(); } }
  interact() { void this.sfx.ctx.resume(); if (this.focus) this.focus.use(); }
  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); if (e.code === "KeyE") this.interact(); if (e.code === "KeyF") this.toggleFlash(); };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => { if (document.pointerLockElement === this.renderer.domElement) this.look(e.movementX, e.movementY, 0.0022); };
  private onMouseDown = () => { if (this.isTouch) return; if (document.pointerLockElement !== this.renderer.domElement) this.lock(); else this.interact(); };
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };
  private bind() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("resize", this.onResize);
  }
  private look(dx: number, dy: number, k: number) {
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * k));
  }
  private blocked(x: number, z: number) {
    for (const [a, b, c, d] of this.boxes) if (x > a - R && x < c + R && z > b - R && z < d + R) return true;
    return false;
  }

  // ---------- loop ----------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    const paused = !this.isTouch && document.pointerLockElement !== this.renderer.domElement;
    if (dt > 0 && !paused) this.update(dt);
    this.updateFx(dt, t);
    this.renderer.render(this.scene, this.camera);
    if (!this.container.dataset.sceneReady) this.container.dataset.sceneReady = "1";
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.cb.onHud({ prompt: this.focus?.label() ?? "", objective: this.objective(), subtitle: this.subtitle, paused: paused && !this.finished, flashlight: this.flashOn });
    }
  };

  private update(dt: number) {
    if (this.touch.lookX || this.touch.lookY) { this.look(this.touch.lookX, this.touch.lookY, 0.006); this.touch.lookX = this.touch.lookY = 0; }
    const k = this.keys;
    let mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.touch.mx;
    let my = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.touch.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const sp = (k.has("ShiftLeft") || this.touch.sprint ? RUN : WALK) * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const nx = this.pos.x + (fx * my + rx * mx) * sp, nz = this.pos.z + (fz * my + rz * mx) * sp;
    if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
    const moving = len > 0.1;
    if (moving) {
      this.stepT -= dt * (sp / dt > WALK ? 1.5 : 1);
      if (this.stepT <= 0) { this.stepT = 0.5; this.sfx.step(0.5); if (Math.random() < 0.25) this.sfx.creak(0.06); }
    }
    const bob = moving ? Math.sin(performance.now() * 0.009) * 0.025 : 0;
    this.camera.position.set(this.pos.x, EYE + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // focus the nearest usable object in front of the camera
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.focus = null;
    let best = 0.86;
    for (const s of this.spots) {
      if (!s.ok()) continue;
      const to = s.pos.clone().sub(this.camera.position);
      const d = to.length();
      if (d > 2.2) continue;
      const dot = to.normalize().dot(fwd);
      if (dot > best) { best = dot; this.focus = s; }
    }
  }

  private updateFx(dt: number, t: number) {
    const fl = this.lightning.update(dt);
    this.storm.intensity = fl * 4;
    this.view.color.setRGB(0.6 + fl * 0.8, 0.64 + fl * 0.8, 0.7 + fl * 0.9);
    this.rain.uniforms.uTime.value = t;
    this.rain.uniforms.uFlash.value = fl * 0.4;
    this.drops.offset.y = (t * 0.015) % 1;
    // lamps; blackout after the call
    if (this.blackout > 0) this.blackout -= dt;
    const out = this.blackout > 0 && this.blackout < 1.9 ? (Math.random() < 0.15 ? 0.4 : 0) : this.blackout > 0 ? 0.2 : 1;
    this.lamps.forEach((l, i) => {
      let k = out;
      if (i === 2 && Math.random() < 0.03) k *= 0.2; // dying kitchen bulb
      l.light.intensity = l.base * k;
      l.bulb.emissiveIntensity = 2 * k;
    });
    // TV
    if (this.tvOn) {
      const g = (this.tvScreen.image as HTMLCanvasElement).getContext("2d")!;
      g.fillStyle = "#1a2a48"; g.fillRect(0, 0, 256, 192);
      g.fillStyle = "#2a3e68"; g.fillRect(0, 130, 256, 62);
      g.fillStyle = "#c9b089"; g.beginPath(); g.ellipse(128, 92, 30, 36, 0, 0, 7); g.fill();
      g.fillStyle = "#222"; g.fillRect(88, 120, 80, 50);
      g.fillStyle = "#fff"; g.font = "bold 16px sans-serif"; g.fillText(this.l("НОВОСТИ · 23:47", "NEWS · 11:47 PM"), 10, 150);
      g.font = "12px sans-serif"; g.fillText(this.l("ПАРК «ВЕСЁЛЫЕ ГОРКИ»", "HAPPY HILLS PARK"), 10, 170);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 192, 2, 1); }
      g.fillStyle = "rgba(0,0,0,0.15)"; for (let y = (t * 60) % 4; y < 192; y += 4) g.fillRect(0, y, 256, 1);
      this.tvScreen.needsUpdate = true;
      this.tvLight.intensity = 2.2 * (0.8 + Math.random() * 0.3);
    } else if (this.tvLight.intensity > 0) {
      const g = (this.tvScreen.image as HTMLCanvasElement).getContext("2d")!;
      g.fillStyle = "#0a0c0c"; g.fillRect(0, 0, 256, 192); this.tvScreen.needsUpdate = true; this.tvLight.intensity = 0;
    }
    this.led.color.set(!this.done.has("phone") && Math.sin(t * 6) > 0 ? "#ff2010" : "#300404");
    this.flash.intensity = this.flashOn ? 25 : 0;
    if (this.finished) {
      this.doorOpen = Math.min(1, this.doorOpen + dt * 0.8);
      this.door.rotation.y = -this.doorOpen * 1.6;
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.voice?.pause();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);
    if (document.pointerLockElement) document.exitPointerLock();
    this.sfx.dispose();
    this.timer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
