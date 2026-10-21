import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL } from './config';

// ---------- seeded random ----------
export type Rand = () => number;
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- toon materials ----------
let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([80, 160, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: THREE.ColorRepresentation, map?: THREE.Texture | null): THREE.MeshToonMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${map?.uuid ?? ''}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, map: map ?? null, gradientMap: gradientMap() });
    toonCache.set(key, m);
  }
  return m;
}

// Unlit, HDR-bright material: values > 1 feed the bloom pass.
const glowCache = new Map<string, THREE.MeshBasicMaterial>();
export function glow(color: THREE.ColorRepresentation, intensity = 3, fog = true): THREE.MeshBasicMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${intensity}|${fog}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), fog });
    glowCache.set(key, m);
  }
  return m;
}

// ---------- inverted-hull outlines ----------
export const outlineMat = new THREE.MeshBasicMaterial({ color: 0x160c1f, side: THREE.BackSide });
outlineMat.onBeforeCompile = (s) => {
  s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.022;');
};

const outlineGeoCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
// Welded copy with smooth normals so the pushed-out hull has no cracks at hard edges.
function outlineGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let o = outlineGeoCache.get(g);
  if (!o) {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', g.getAttribute('position').clone());
    if (g.index) c.setIndex(g.index.clone());
    o = mergeVertices(c, 1e-3);
    o.computeVertexNormals();
    outlineGeoCache.set(g, o);
  }
  return o;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) {
    const o = new THREE.Mesh(outlineGeometry(geo), outlineMat);
    o.userData.outline = true;
    m.add(o);
  }
  return m;
}

export function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  outline = true,
): THREE.Mesh {
  const m = mesh(geo, mat, outline);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ---------- shared geometry ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export const G = {
  box: (w: number, h: number, d: number) =>
    cached(`b${r2(w)},${r2(h)},${r2(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt: number, rb: number, h: number, seg = 12) =>
    cached(`c${r2(rt)},${r2(rb)},${r2(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  sphere: (r: number, ws = 16, hs = 12) => cached(`s${r2(r)},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  cone: (r: number, h: number, seg = 8) => cached(`k${r2(r)},${r2(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r: number, t: number) => cached(`t${r2(r)},${r2(t)}`, () => new THREE.TorusGeometry(r, t, 6, 16)),
};

// ---------- canvas textures (zero download) ----------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
function shade(base: string, f: number): string {
  const c = new THREE.Color(base);
  c.offsetHSL(0, 0, f);
  return '#' + c.getHexString();
}

const texCache = new Map<string, THREE.Texture>();
function once(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

export const TEX = {
  floorWood: () =>
    once('floorWood', () =>
      canvasTex(512, 512, (c) => {
        const rnd = mulberry32(7);
        const cols = 6;
        const pw = 512 / cols;
        for (let i = 0; i < cols; i++) {
          let y = -rnd() * 200;
          while (y < 512) {
            const len = 140 + rnd() * 220;
            c.fillStyle = shade('#7a5136', (rnd() - 0.5) * 0.08);
            c.fillRect(i * pw, y, pw, len);
            c.strokeStyle = 'rgba(40,22,12,0.25)';
            c.lineWidth = 1.5;
            for (let g = 0; g < 3; g++) {
              const gx = i * pw + 10 + rnd() * (pw - 20);
              c.beginPath();
              c.moveTo(gx, y + 8);
              c.bezierCurveTo(gx + 6, y + len * 0.3, gx - 6, y + len * 0.6, gx + 2, y + len - 8);
              c.stroke();
            }
            c.fillStyle = '#2a170d';
            c.fillRect(i * pw, y + len - 3, pw, 4);
            y += len;
          }
          c.fillStyle = '#2a170d';
          c.fillRect(i * pw, 0, 4, 512);
        }
      }),
    ),
  floorStone: () =>
    once('floorStone', () =>
      canvasTex(512, 512, (c) => {
        const rnd = mulberry32(11);
        c.fillStyle = '#1f1626';
        c.fillRect(0, 0, 512, 512);
        const s = 128;
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const off = y % 2 ? s / 2 : 0;
            c.fillStyle = shade('#4b4150', (rnd() - 0.5) * 0.1);
            c.fillRect(((x * s + off) % 512) + 4, y * s + 4, s - 8, s - 8);
            if (off) c.fillRect(-s / 2 + 4, y * s + 4, s - 8, s - 8);
          }
      }),
    ),
  floorTile: () =>
    once('floorTile', () =>
      canvasTex(256, 256, (c) => {
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            c.fillStyle = (x + y) % 2 ? '#3c4a3a' : '#5d6b4f';
            c.fillRect(x * 64, y * 64, 64, 64);
          }
        c.strokeStyle = '#1d241b';
        c.lineWidth = 3;
        for (let i = 0; i <= 4; i++) {
          c.beginPath();
          c.moveTo(i * 64, 0);
          c.lineTo(i * 64, 256);
          c.moveTo(0, i * 64);
          c.lineTo(256, i * 64);
          c.stroke();
        }
      }),
    ),
  wallpaper: () =>
    once('wallpaper', () =>
      canvasTex(256, 256, (c) => {
        const rnd = mulberry32(3);
        c.fillStyle = hex(PAL.purple);
        c.fillRect(0, 0, 256, 256);
        for (let x = 0; x < 256; x += 32) {
          c.fillStyle = '#583480';
          c.fillRect(x, 0, 14, 256);
          c.fillStyle = '#3b2157';
          c.fillRect(x + 22, 0, 3, 256);
        }
        for (let i = 0; i < 260; i++) {
          c.fillStyle = `rgba(20,8,30,${rnd() * 0.18})`;
          c.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 6, 2 + rnd() * 6);
        }
      }),
    ),
  sky: () =>
    once('sky', () =>
      canvasTex(
        256,
        512,
        (c) => {
          const g = c.createLinearGradient(0, 0, 0, 512);
          g.addColorStop(0, '#1e1230');
          g.addColorStop(0.55, '#5a3a86');
          g.addColorStop(0.85, '#b5607a');
          g.addColorStop(1, '#f2a04a');
          c.fillStyle = g;
          c.fillRect(0, 0, 256, 512);
          c.fillStyle = '#fff3d6';
          c.beginPath();
          c.arc(170, 140, 46, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = 'rgba(60,40,90,0.85)';
          c.fillRect(90, 175, 140, 8);
          c.fillRect(40, 110, 90, 6);
          // bare tree + hills silhouette
          c.fillStyle = '#160c22';
          c.beginPath();
          c.moveTo(0, 470);
          c.quadraticCurveTo(80, 420, 160, 455);
          c.quadraticCurveTo(220, 430, 256, 445);
          c.lineTo(256, 512);
          c.lineTo(0, 512);
          c.fill();
          c.strokeStyle = '#160c22';
          c.lineCap = 'round';
          const branch = (x: number, y: number, a: number, len: number, w: number) => {
            if (len < 6) return;
            const x2 = x + Math.cos(a) * len;
            const y2 = y + Math.sin(a) * len;
            c.lineWidth = w;
            c.beginPath();
            c.moveTo(x, y);
            c.lineTo(x2, y2);
            c.stroke();
            branch(x2, y2, a - 0.45, len * 0.7, w * 0.65);
            branch(x2, y2, a + 0.35, len * 0.66, w * 0.65);
          };
          branch(50, 470, -Math.PI / 2, 70, 9);
        },
        false,
      ),
    ),
  cobweb: () =>
    once('cobweb', () =>
      canvasTex(
        256,
        256,
        (c) => {
          c.strokeStyle = 'rgba(225,215,240,0.75)';
          c.lineWidth = 1.6;
          const spokes = 7;
          for (let i = 0; i <= spokes; i++) {
            const a = (i / spokes) * (Math.PI / 2);
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(Math.cos(a) * 250, Math.sin(a) * 250);
            c.stroke();
          }
          for (let r = 30; r < 240; r += 32) {
            c.beginPath();
            for (let i = 0; i <= spokes; i++) {
              const a = (i / spokes) * (Math.PI / 2);
              const sag = i > 0 && i < spokes ? 0.9 : 1;
              const x = Math.cos(a) * r * sag;
              const y = Math.sin(a) * r * sag;
              if (i === 0) c.moveTo(x, y);
              else c.lineTo(x, y);
            }
            c.stroke();
          }
        },
        false,
      ),
    ),
  // Carved jack-o-lantern face on transparent background.
  pumpkinFace: (mean: boolean) =>
    once('pface' + mean, () =>
      canvasTex(
        256,
        256,
        (c) => {
          c.fillStyle = '#ffd27a';
          const tri = (pts: number[]) => {
            c.beginPath();
            c.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
            c.closePath();
            c.fill();
          };
          if (mean) {
            tri([50, 70, 115, 105, 70, 130]);
            tri([206, 70, 141, 105, 186, 130]);
          } else {
            tri([80, 70, 112, 125, 50, 125]);
            tri([176, 70, 206, 125, 144, 125]);
          }
          tri([128, 130, 142, 152, 114, 152]);
          c.beginPath();
          c.moveTo(45, 165);
          c.quadraticCurveTo(128, 250, 211, 165);
          c.quadraticCurveTo(128, 205, 45, 165);
          c.fill();
          c.fillStyle = '#000';
          c.globalCompositeOperation = 'destination-out';
          c.fillRect(95, 168, 18, 16);
          c.fillRect(143, 168, 18, 16);
          c.fillRect(118, 200, 20, 18);
        },
        false,
      ),
    ),
};

// Partial ellipsoid shell over the front (+z) of a sphere, used for faces.
const faceMatCache = new Map<string, THREE.MeshBasicMaterial>();
export function faceShell(r: number, yScale: number, map: THREE.Texture, intensity: number): THREE.Mesh {
  const geo = cached(`f${r2(r)},${r2(yScale)}`, () => {
    const g = new THREE.SphereGeometry(r, 24, 12, Math.PI / 2 - 0.85, 1.7, Math.PI / 2 - 0.75, 1.5);
    g.scale(1, yScale, 1);
    return g;
  });
  const key = `${map.uuid}|${intensity}`;
  let mat = faceMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map,
      color: new THREE.Color(1, 0.62, 0.22).multiplyScalar(intensity),
      alphaTest: 0.5,
    });
    faceMatCache.set(key, mat);
  }
  return new THREE.Mesh(geo, mat);
}
