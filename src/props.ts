import * as THREE from 'three';
import { PAL } from './config';
import { add, faceShell, G, glow, mesh, Rand, TEX, toon } from './materials';

export type HideKind = 'wardrobe' | 'table' | 'chest' | 'curtain' | 'bed';

// Footprint is w (x) by d (z) before rotation; front faces local +z.
export interface PropDef {
  obj: THREE.Group;
  w: number;
  d: number;
  h: number;
  tall: boolean;
  hide?: HideKind;
}

const WOOD = PAL.wood;
const DARK_WOOD = 0x3a2418;
const BRASS = 0xd9a441;
const CREAM = PAL.cream;

export function candle(parent: THREE.Object3D, x: number, y: number, z: number, h = 0.3, r = 0.06): void {
  add(parent, G.cyl(r, r * 1.08, h, 10), toon(CREAM), x, y + h / 2, z);
  add(parent, G.sphere(r * 0.7, 8, 6), toon(0xf4ecd8), x + r * 0.6, y + h - 0.02, z, false);
  // unlit wick: the manor is pitch black
  add(parent, G.box(0.012, 0.05, 0.012), toon(0x111111), x, y + h + 0.025, z, false);
}

export function candleCluster(parent: THREE.Object3D, x: number, z: number, rand: Rand, y = 0): void {
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.16 + rand() * 0.08;
    candle(parent, x + Math.cos(a) * d, y, z + Math.sin(a) * d, 0.25 + rand() * 0.45, 0.06 + rand() * 0.04);
  }
}

// Ribbed jack-o-lantern. Returns group with base at y=0.
export function pumpkin(r: number, lit = true, mean = false): THREE.Group {
  const g = new THREE.Group();
  const key = Math.round(r * 100);
  const body = ribbedSphere(r, key);
  add(g, body, toon(PAL.orange), 0, r * 0.82, 0);
  const stem = add(g, G.cyl(r * 0.09, r * 0.14, r * 0.35, 6), toon(0x4f6b2a), 0, r * 1.68, 0);
  stem.rotation.z = 0.25;
  if (lit) {
    const face = faceShell(r * 1.005, 0.82, TEX.pumpkinFace(mean), 1.6);
    face.position.y = r * 0.82;
    g.add(face);
  }
  return g;
}

const ribCache = new Map<number, THREE.BufferGeometry>();
function ribbedSphere(r: number, key: number): THREE.BufferGeometry {
  let g = ribCache.get(key);
  if (g) return g;
  g = new THREE.SphereGeometry(r, 28, 16);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const phi = Math.atan2(z, x);
    const k = 1 - 0.07 * (0.5 - 0.5 * Math.cos(10 * phi));
    p.setXYZ(i, x * k, y * 0.82, z * k);
  }
  g.computeVertexNormals();
  ribCache.set(key, g);
  return g;
}

// ---------- furniture ----------

export function wardrobe(): PropDef {
  const g = new THREE.Group();
  const w = 1.7, d = 0.85, h = 2.45;
  const body = toon(0x6a2e22);
  const dark = toon(0x48201a);
  add(g, G.box(w, h - 0.2, d), body, 0, 0.12 + (h - 0.2) / 2, 0);
  add(g, G.box(w + 0.14, 0.14, d + 0.12), dark, 0, h - 0.07, 0);
  add(g, G.box(w + 0.06, 0.1, d + 0.04), dark, 0, 0.12, 0);
  for (const s of [-1, 1]) {
    add(g, G.box(0.12, 0.12, 0.12), dark, s * (w / 2 - 0.1), 0.06, d / 2 - 0.1);
    add(g, G.box(0.12, 0.12, 0.12), dark, s * (w / 2 - 0.1), 0.06, -d / 2 + 0.1);
    // door panels
    add(g, G.box(w / 2 - 0.16, 0.9, 0.04), dark, s * (w / 4), 1.75, d / 2 + 0.02);
    add(g, G.box(w / 2 - 0.16, 0.9, 0.04), dark, s * (w / 4), 0.72, d / 2 + 0.02);
    add(g, G.sphere(0.05, 8, 6), toon(BRASS), s * 0.1, 1.25, d / 2 + 0.06);
  }
  add(g, G.box(0.03, h - 0.4, 0.03), toon(0x1e0f0b), 0, 1.25, d / 2 + 0.01, false);
  return { obj: g, w, d, h, tall: true, hide: 'wardrobe' };
}

export function clothTable(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 2.6, d = 1.6, h = 0.95;
  const cloth = toon(rand() < 0.5 ? 0x5e2c4a : 0x3d2a5c);
  add(g, G.box(w + 0.1, 0.08, d + 0.1), toon(WOOD), 0, h, 0);
  add(g, G.box(w + 0.2, h - 0.04, d + 0.2), cloth, 0, (h - 0.04) / 2 + 0.03, 0);
  // lace trim
  add(g, G.box(w + 0.24, 0.08, d + 0.24), toon(CREAM), 0, 0.08, 0, false);
  candleCluster(g, -0.7, -0.2, rand, h + 0.04);
  const p = pumpkin(0.22, true);
  p.position.set(0.6, h + 0.04, 0.1);
  p.rotation.y = (rand() - 0.5) * 0.8;
  g.add(p);
  add(g, G.box(0.45, 0.08, 0.32), toon(0x6b2230), 0.05, h + 0.08, -0.35).rotation.y = 0.3;
  return { obj: g, w: w + 0.2, d: d + 0.2, h, tall: false, hide: 'table' };
}

const BOOK_COLORS = [0x6b2230, 0x2f4a3a, 0x3b2a5c, 0x7a4b25, 0x4a3a2a, 0x8a6a3a, 0x24304a];
export function bookshelf(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 3.0, d = 0.7, h = 3.2;
  const frame = toon(DARK_WOOD);
  add(g, G.box(w, h, 0.08), frame, 0, h / 2, -d / 2 + 0.04);
  for (const s of [-1, 1]) add(g, G.box(0.1, h, d), frame, s * (w / 2 - 0.05), h / 2, 0);
  const shelves = 5;
  for (let i = 0; i <= shelves; i++) {
    const y = 0.08 + (i * (h - 0.16)) / shelves;
    add(g, G.box(w, 0.08, d), frame, 0, y, 0);
    if (i === shelves) break;
    let x = -w / 2 + 0.15;
    while (x < w / 2 - 0.25) {
      const bw = 0.08 + rand() * 0.1;
      const bh = 0.32 + rand() * 0.18;
      if (rand() < 0.12) {
        x += 0.2;
        continue;
      }
      const b = add(g, G.box(bw, bh, d * 0.75), toon(BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)]), x + bw / 2, y + 0.04 + bh / 2, 0.02, false);
      if (rand() < 0.1) b.rotation.z = 0.25;
      x += bw + 0.01;
    }
  }
  candle(g, -w / 2 + 0.4, h, 0, 0.3);
  candle(g, -w / 2 + 0.6, h, 0.05, 0.18);
  if (rand() < 0.6) {
    const p = pumpkin(0.25);
    p.position.set(w / 2 - 0.45, h, 0);
    g.add(p);
  }
  return { obj: g, w, d, h, tall: true };
}

export function stove(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 2.6, d = 1.1;
  const brick = toon(0x6e3b2e);
  add(g, G.box(w, 1.2, d), brick, 0, 0.6, 0);
  add(g, G.box(w + 0.15, 0.12, d + 0.1), toon(DARK_WOOD), 0, 1.26, 0);
  add(g, G.box(w * 0.7, 0.9, 0.5), brick, 0, 1.75, -d / 2 + 0.25);
  // fire mouth
  add(g, G.box(1.1, 0.7, 0.06), toon(0x1a0c08), 0, 0.5, d / 2 + 0.01, false);
  add(g, G.box(0.9, 0.35, 0.05), glow(0xff5a10, 1.3), 0, 0.35, d / 2 + 0.03, false);
  // pot on top
  add(g, G.cyl(0.3, 0.25, 0.35, 12), toon(0x2a2a30), -0.6, 1.5, 0.1);
  add(g, G.cyl(0.22, 0.22, 0.18, 12), toon(0x2a2a30), 0.6, 1.41, 0.1);
  // hanging pans on rack
  add(g, G.box(w, 0.06, 0.06), toon(0x2a2a30), 0, 2.6, d / 2 - 0.1, false);
  for (let i = 0; i < 4; i++) {
    const x = -0.9 + i * 0.6;
    add(g, G.box(0.02, 0.3, 0.02), toon(0x2a2a30), x, 2.42, d / 2 - 0.1, false);
    const pan = add(g, G.cyl(0.14 + rand() * 0.06, 0.14, 0.05, 12), toon(0x2f2f38), x, 2.15, d / 2 - 0.1);
    pan.rotation.x = Math.PI / 2;
  }
  return { obj: g, w, d, h: 2.6, tall: true };
}

export function cauldron(): PropDef {
  const g = new THREE.Group();
  const pot = new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68);
  add(g, pot, toon(0x24222b), 0, 0.62, 0);
  add(g, G.torus(0.55, 0.06), toon(0x34313d), 0, 0.98, 0).rotation.x = Math.PI / 2;
  add(g, G.cyl(0.54, 0.54, 0.04, 18), glow(0x7ec850, 1.3), 0, 0.93, 0, false);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(g, G.box(0.08, 0.3, 0.08), toon(0x24222b), Math.cos(a) * 0.4, 0.15, Math.sin(a) * 0.4);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    add(g, G.cyl(0.05, 0.07, 0.12, 6), toon(0x3a2418), Math.cos(a) * 0.25, 0.05, Math.sin(a) * 0.25, false);
  }
  return { obj: g, w: 1.4, d: 1.4, h: 1.0, tall: false };
}

export function grandfatherClock(): PropDef {
  const g = new THREE.Group();
  const w = 0.95, d = 0.6, h = 2.9;
  const wood = toon(0x5a2c1e);
  add(g, G.box(w, 1.3, d), wood, 0, 0.65, 0);
  add(g, G.box(w * 0.8, 0.9, d * 0.9), wood, 0, 1.75, 0);
  add(g, G.box(w, 0.7, d), wood, 0, 2.55, 0);
  add(g, G.box(w + 0.1, 0.1, d + 0.08), toon(DARK_WOOD), 0, 2.95, 0);
  const face = add(g, G.cyl(0.3, 0.3, 0.04, 20), toon(CREAM), 0, 2.55, d / 2 + 0.02);
  face.rotation.x = Math.PI / 2;
  add(g, G.box(0.03, 0.22, 0.02), toon(0x111111), 0, 2.62, d / 2 + 0.05, false);
  add(g, G.box(0.16, 0.03, 0.02), toon(0x111111), 0.06, 2.55, d / 2 + 0.05, false);
  add(g, G.box(w * 0.5, 0.7, 0.02), toon(0x2a140e), 0, 1.75, d * 0.45 + 0.01, false);
  add(g, G.sphere(0.12, 12, 8), toon(BRASS), 0, 1.55, d * 0.45 + 0.04);
  return { obj: g, w, d, h, tall: true };
}

export function candelabra(): PropDef {
  const g = new THREE.Group();
  const iron = toon(0x2a2430);
  add(g, G.cyl(0.3, 0.38, 0.08, 12), iron, 0, 0.04, 0);
  add(g, G.cyl(0.05, 0.06, 1.5, 8), iron, 0, 0.8, 0);
  add(g, G.torus(0.42, 0.03), iron, 0, 1.55, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    candle(g, Math.cos(a) * 0.42, 1.56, Math.sin(a) * 0.42, 0.2 + (i % 2) * 0.1);
  }
  candle(g, 0, 1.55, 0, 0.35, 0.08);
  return { obj: g, w: 0.9, d: 0.9, h: 2.0, tall: false };
}

export function dresser(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 2.0, d = 0.8, h = 1.3;
  add(g, G.box(w, h, d), toon(0x7a4a6e), 0, h / 2, 0);
  for (let i = 0; i < 3; i++) {
    add(g, G.box(w - 0.2, 0.32, 0.04), toon(0x5e3655), 0, 0.25 + i * 0.4, d / 2 + 0.02);
    add(g, G.sphere(0.04, 8, 6), toon(BRASS), -0.35, 0.25 + i * 0.4, d / 2 + 0.06, false);
    add(g, G.sphere(0.04, 8, 6), toon(BRASS), 0.35, 0.25 + i * 0.4, d / 2 + 0.06, false);
  }
  // toy blocks + teddy
  const cols = [0xc94a4a, 0x4a7ac9, 0xe8c84a];
  for (let i = 0; i < 3; i++) add(g, G.box(0.2, 0.2, 0.2), toon(cols[i]), -0.6 + i * 0.22, h + 0.1, 0.05).rotation.y = rand();
  const bear = toon(0x8a5a3a);
  add(g, G.sphere(0.2, 12, 8), bear, 0.5, h + 0.2, 0);
  add(g, G.sphere(0.14, 12, 8), bear, 0.5, h + 0.48, 0.02);
  add(g, G.sphere(0.05, 6, 4), bear, 0.4, h + 0.6, 0.02);
  add(g, G.sphere(0.05, 6, 4), bear, 0.6, h + 0.6, 0.02);
  candle(g, 0.85, h, -0.15, 0.25);
  return { obj: g, w, d, h, tall: false };
}

export function crib(): PropDef {
  const g = new THREE.Group();
  const w = 2.2, d = 1.3, h = 1.15;
  const wood = toon(0xcfb79a);
  add(g, G.box(w, 0.12, d), wood, 0, 0.45, 0);
  add(g, G.box(w - 0.1, 0.15, d - 0.1), toon(0xd8c8e8), 0, 0.56, 0);
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box(0.1, h, 0.1), wood, (px * w) / 2, h / 2, (pz * d) / 2);
  for (const pz of [-1, 1]) {
    add(g, G.box(w, 0.07, 0.07), wood, 0, h - 0.05, (pz * d) / 2);
    for (let i = 1; i < 9; i++) add(g, G.box(0.04, 0.55, 0.04), wood, -w / 2 + (i * w) / 9, 0.82, (pz * d) / 2, false);
  }
  for (const px of [-1, 1]) {
    add(g, G.box(0.07, 0.07, d), wood, (px * w) / 2, h - 0.05, 0);
    for (let i = 1; i < 5; i++) add(g, G.box(0.04, 0.55, 0.04), wood, (px * w) / 2, 0.82, -d / 2 + (i * d) / 5, false);
  }
  return { obj: g, w, d, h, tall: false };
}

export function barrels(rand: Rand): PropDef {
  const g = new THREE.Group();
  const wood = toon(0x6b4128);
  const band = toon(0x2a2430);
  const spots: [number, number][] = [[-0.5, -0.4], [0.5, -0.35], [0, 0.5]];
  for (const [x, z] of spots) {
    const s = 0.9 + rand() * 0.2;
    add(g, G.cyl(0.42 * s, 0.38 * s, 1.15 * s, 14), wood, x, 0.575 * s, z);
    add(g, G.cyl(0.44 * s, 0.44 * s, 0.06, 14), band, x, 0.25 * s, z, false);
    add(g, G.cyl(0.44 * s, 0.44 * s, 0.06, 14), band, x, 0.9 * s, z, false);
  }
  candle(g, 0, 1.15, 0.5, 0.25);
  return { obj: g, w: 2.0, d: 2.0, h: 1.3, tall: false };
}

export function crates(rand: Rand): PropDef {
  const g = new THREE.Group();
  const wood = toon(0x7a5a38);
  const slat = toon(0x5b3a29);
  const place = (x: number, y: number, s: number) => {
    const c = add(g, G.box(s, s, s), wood, x, y + s / 2, 0);
    c.rotation.y = (rand() - 0.5) * 0.2;
    add(c, G.box(s + 0.02, 0.08, s + 0.02), slat, 0, s / 2 - 0.08, 0, false);
    add(c, G.box(s + 0.02, 0.08, s + 0.02), slat, 0, -s / 2 + 0.08, 0, false);
  };
  place(-0.65, 0, 1.0);
  place(0.55, 0, 1.0);
  place(-0.1, 1.0, 0.9);
  const p = pumpkin(0.22);
  p.position.set(0.6, 1.0, 0.1);
  g.add(p);
  return { obj: g, w: 2.4, d: 1.1, h: 2.0, tall: true };
}

function plant(parent: THREE.Object3D, x: number, y: number, z: number, s: number, rand: Rand) {
  add(parent, G.cyl(0.22 * s, 0.16 * s, 0.32 * s, 10), toon(0xb0603a), x, y + 0.16 * s, z);
  const leaf = toon(rand() < 0.5 ? PAL.green : 0x5a9a3a);
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2;
    add(parent, G.sphere(0.18 * s, 10, 8), leaf, x + Math.cos(a) * 0.1 * s, y + (0.42 + rand() * 0.25) * s, z + Math.sin(a) * 0.1 * s);
  }
}

export function plantTable(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 1.8, d = 1.4;
  add(g, G.box(w, 0.08, d), toon(WOOD), 0, 0.8, 0);
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box(0.08, 0.8, 0.08), toon(WOOD), (px * (w - 0.1)) / 2, 0.4, (pz * (d - 0.1)) / 2);
  plant(g, -0.45, 0.84, -0.2, 1.4, rand);
  plant(g, 0.5, 0.84, 0.25, 1.0, rand);
  const p = pumpkin(0.2, false);
  p.position.set(0.4, 0.84, -0.35);
  g.add(p);
  plant(g, 0, 0, 0, 1.6, rand);
  return { obj: g, w, d, h: 1.8, tall: false };
}

export function potShelf(rand: Rand): PropDef {
  const g = new THREE.Group();
  const w = 2.8, d = 0.7, h = 2.4;
  const frame = toon(0x4a5a3a);
  for (const s of [-1, 1]) add(g, G.box(0.08, h, d), frame, s * (w / 2 - 0.04), h / 2, 0);
  for (let i = 0; i < 3; i++) {
    const y = 0.4 + i * 0.85;
    add(g, G.box(w, 0.06, d), frame, 0, y, 0);
    for (let k = 0; k < 3; k++) if (rand() < 0.8) plant(g, -0.9 + k * 0.9, y + 0.03, 0, 0.8, rand);
  }
  return { obj: g, w, d, h, tall: true };
}

export function rug(w: number, d: number, color: number): THREE.Group {
  const g = new THREE.Group();
  add(g, G.box(w, 0.02, d), toon(color), 0, 0.01, 0, false);
  add(g, G.box(w - 0.6, 0.025, d - 0.6), toon(new THREE.Color(color).offsetHSL(0, 0, 0.08).getHex()), 0, 0.012, 0, false);
  return g;
}

export function chandelier(big: boolean): THREE.Group {
  const g = new THREE.Group();
  const iron = toon(0x241e2a);
  const r = big ? 1.1 : 0.7;
  add(g, G.cyl(0.02, 0.02, 0.9, 4), iron, 0, 0.45, 0, false);
  add(g, G.torus(r, 0.04), iron, 0, 0, 0).rotation.x = Math.PI / 2;
  const n = big ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    candle(g, Math.cos(a) * r, 0, Math.sin(a) * r, 0.18, 0.05);
  }
  return g;
}

export function windowFrame(): THREE.Group {
  const g = new THREE.Group();
  const w = 2.0, h = 1.7;
  const frame = toon(DARK_WOOD);
  const sky = skyMat ?? (skyMat = new THREE.MeshBasicMaterial({ map: TEX.sky(), color: new THREE.Color(0.55, 0.55, 0.65), fog: false }));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sky);
  glass.position.set(0, h / 2, 0);
  g.add(glass);
  // arched top
  const arch = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 20, 0, Math.PI), sky);
  arch.position.set(0, h, 0);
  g.add(arch);
  add(g, G.box(w + 0.3, 0.16, 0.25), frame, 0, -0.04, 0.08);
  for (const s of [-1, 1]) add(g, G.box(0.14, h, 0.16), frame, s * (w / 2 + 0.05), h / 2, 0.05);
  add(g, G.box(0.08, h + w / 2 - 0.1, 0.1), frame, 0, (h + w / 2) / 2, 0.04, false);
  for (const y of [h * 0.35, h * 0.72]) add(g, G.box(w, 0.08, 0.1), frame, 0, y, 0.04, false);
  const archRim = mesh(new THREE.TorusGeometry(w / 2 + 0.03, 0.07, 6, 20, Math.PI), frame);
  archRim.position.set(0, h, 0.05);
  g.add(archRim);
  return g;
}

export function cobweb(size: number): THREE.Mesh {
  const mat = cobwebMat ?? (cobwebMat = new THREE.MeshBasicMaterial({ map: TEX.cobweb(), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x9a8cb0 }));
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
}
let cobwebMat: THREE.MeshBasicMaterial | null = null;
let skyMat: THREE.MeshBasicMaterial | null = null;

// ---------- extra hiding spots ----------

export function chest(): PropDef {
  const g = new THREE.Group();
  const w = 1.5, d = 0.85, h = 0.85;
  const wood = toon(0x5e3a22);
  const iron = toon(0x2a2430);
  add(g, G.box(w, h * 0.65, d), wood, 0, (h * 0.65) / 2, 0);
  // rounded lid
  const lid = add(g, new THREE.CylinderGeometry(d / 2, d / 2, w, 14, 1, false, 0, Math.PI), wood, 0, h * 0.65, 0);
  lid.rotation.z = Math.PI / 2; // half-cylinder axis along x, bulging up
  lid.scale.set(0.55, 1, 1);
  for (const x of [-w / 2 + 0.18, w / 2 - 0.18]) {
    add(g, G.box(0.08, h * 0.66, d + 0.03), iron, x, (h * 0.66) / 2, 0, false);
  }
  add(g, G.box(0.18, 0.2, 0.05), toon(BRASS), 0, h * 0.58, d / 2 + 0.02);
  return { obj: g, w, d, h: h + 0.2, tall: false, hide: 'chest' };
}

// Heavy drapes on both sides of a window; a kid fits behind the left one.
export function curtains(): { obj: THREE.Group; drapeX: number } {
  const g = new THREE.Group();
  const cloth = toon(0x6b1f3a);
  const dark = toon(0x4a1328);
  const drapeX = 1.55;
  const drape = new THREE.CylinderGeometry(0.42, 0.55, 3.5, 12, 1);
  const p = drape.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + Math.sin(a * 6) * 0.08;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k * 0.6);
  }
  drape.computeVertexNormals();
  for (const s of [-1, 1]) {
    add(g, drape, s < 0 ? cloth : dark, s * drapeX, 1.75, 0.32);
    add(g, G.box(0.9, 0.12, 0.08), toon(BRASS), s * drapeX, 2.5, 0.62, false);
  }
  add(g, G.cyl(0.04, 0.04, 4.2, 6), toon(0x241e2a), 0, 3.6, 0.3, false).rotation.z = Math.PI / 2;
  return { obj: g, drapeX };
}

export function bed(): PropDef {
  const g = new THREE.Group();
  const w = 2.4, d = 1.7, h = 0.9;
  const wood = toon(0x5a3a5e);
  add(g, G.box(w, 0.25, d), wood, 0, 0.45, 0);
  // blanket drapes to the floor: hide underneath
  add(g, G.box(w + 0.08, 0.7, d + 0.1), toon(0x3d5a8a), 0, 0.4, 0);
  add(g, G.box(w + 0.1, 0.12, d + 0.12), toon(0x2e4470), 0, 0.78, 0);
  add(g, G.box(0.6, 0.18, d * 0.75), toon(CREAM), -w / 2 + 0.45, 0.92, 0);
  add(g, G.box(0.14, 1.5, d + 0.1), wood, -w / 2 - 0.07, 0.75, 0);
  add(g, G.box(0.14, 1.0, d + 0.1), wood, w / 2 + 0.07, 0.5, 0);
  const bear = toon(0x8a5a3a);
  add(g, G.sphere(0.16, 10, 8), bear, -w / 2 + 0.6, 1.05, 0.3);
  add(g, G.sphere(0.11, 10, 8), bear, -w / 2 + 0.6, 1.27, 0.3);
  return { obj: g, w: w + 0.3, d: d + 0.12, h, tall: false, hide: 'bed' };
}
