import * as THREE from 'three';
import { LANTERN_RANGE, PAL } from './config';
import { add, faceShell, G, mesh, TEX, toon } from './materials';

// ---------- Costumed kid: bedsheet ghost, no skeleton, procedural motion ----------

const ghostGeo = (() => {
  const pts = [
    [0.001, 1.06], [0.14, 1.04], [0.26, 0.98], [0.33, 0.88], [0.36, 0.76], [0.37, 0.6],
    [0.4, 0.42], [0.46, 0.26], [0.53, 0.14], [0.56, 0.1],
  ]
    .reverse() // lathe profile must run bottom→top or faces point inward
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 28);
  // wavy hem
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.2) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, y + Math.sin(a * 7) * 0.035 * (1 - y / 0.2));
    }
  }
  g.computeVertexNormals();
  return g;
})();

export interface KidRig {
  root: THREE.Group;
  body: THREE.Group;
  feet: THREE.Mesh[];
  lantern: THREE.Group;
  lanternMat: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  phase: number;
}

export const LANTERN_COLOR = new THREE.Color(0xffb347);

// Small carried lantern. Material is per-lantern so it can flicker on its own.
function makeLantern(scale: number): { group: THREE.Group; mat: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const iron = toon(0x241e2a);
  const mat = new THREE.MeshBasicMaterial({ color: LANTERN_COLOR.clone().multiplyScalar(5) });
  const s = scale;
  add(g, G.torus(0.06 * s, 0.012 * s), iron, 0, 0.03 * s, 0, false);
  add(g, G.box(0.16 * s, 0.035 * s, 0.16 * s), iron, 0, -0.05 * s, 0);
  add(g, G.box(0.12 * s, 0.17 * s, 0.12 * s), mat, 0, -0.16 * s, 0, false);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(g, G.box(0.02 * s, 0.18 * s, 0.02 * s), iron, x * 0.065 * s, -0.16 * s, z * 0.065 * s, false);
  add(g, G.box(0.18 * s, 0.035 * s, 0.18 * s), iron, 0, -0.27 * s, 0);
  return { group: g, mat };
}

export function makeKid(color: number): KidRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(mesh(ghostGeo, toon(color)));
  const eye = toon(0x140a12);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(G.sphere(0.06, 10, 8), eye);
    e.scale.set(1, 1.35, 0.5);
    e.position.set(s * 0.12, 0.8, 0.325);
    e.rotation.y = s * 0.3;
    body.add(e);
  }
  const shoe = toon(0xf5f2ec);
  const feet: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const f = mesh(G.box(0.13, 0.1, 0.24), shoe);
    f.position.set(s * 0.13, 0.05, 0.05);
    add(f, G.box(0.135, 0.03, 0.25), toon(0xd8d2c8), 0, -0.035, 0, false);
    root.add(f);
    feet.push(f);
  }
  // little sheet-covered hand holding the lantern
  const hand = new THREE.Mesh(G.sphere(0.09, 10, 8), toon(color));
  hand.scale.set(0.8, 1.1, 0.8);
  hand.position.set(0.36, 0.56, 0.1);
  body.add(hand);
  const { group: lantern, mat: lanternMat } = makeLantern(1);
  lantern.position.set(0.4, 0.5, 0.14);
  body.add(lantern);
  const light = new THREE.PointLight(LANTERN_COLOR, 7, LANTERN_RANGE, 1.4);
  light.position.set(0.4, 0.42, 0.18);
  body.add(light);
  const shadow = blobShadow(0.55);
  root.add(shadow);
  return { root, body, feet, lantern, lanternMat, light, phase: 0 };
}

// speed01: 0 idle .. 1 full run
export function animateKid(k: KidRig, dt: number, speed: number, sneaking: boolean, t: number): void {
  const moving = speed > 0.2;
  k.phase += dt * (moving ? speed * 2.2 : 0);
  const s = Math.sin(k.phase * Math.PI);
  const bob = moving ? Math.abs(s) * (sneaking ? 0.03 : 0.07) : Math.sin(t * 2.4) * 0.025;
  k.body.position.y = bob + (sneaking ? -0.08 : 0);
  k.body.scale.set(1 + (sneaking ? 0.06 : 0), 1 - (sneaking ? 0.1 : 0) - bob * 0.3, 1 + (sneaking ? 0.06 : 0));
  k.body.rotation.x = moving ? (sneaking ? 0.12 : 0.18) : 0;
  k.body.rotation.z = moving ? s * 0.06 : Math.sin(t * 1.3) * 0.03;
  k.lantern.rotation.z = (moving ? s * 0.18 : Math.sin(t * 1.9) * 0.05) - k.body.rotation.z;
  k.lantern.rotation.x = -k.body.rotation.x * 1.4;
  k.feet[0].position.z = 0.05 + (moving ? s * 0.16 : 0);
  k.feet[1].position.z = 0.05 - (moving ? s * 0.16 : 0);
  k.feet[0].position.y = 0.05 + (moving ? Math.max(0, s) * 0.06 : 0);
  k.feet[1].position.y = 0.05 + (moving ? Math.max(0, -s) * 0.06 : 0);
}

// ---------- Pumpkin Seeker ----------

export interface SeekerRig {
  root: THREE.Group;
  torso: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  head: THREE.Group;
  lanternLight: THREE.SpotLight;
  glowLight: THREE.PointLight;
  lanternMat: THREE.MeshBasicMaterial;
  phase: number;
  swipe: number;
}

const coatGeo = (() => {
  const pts = [
    [0.44, 0.38], [0.4, 0.55], [0.34, 0.9], [0.3, 1.2], [0.31, 1.5], [0.33, 1.68], [0.24, 1.78], [0.12, 1.82], [0.001, 1.83],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 20);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.5) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, y + (Math.abs(Math.sin(a * 5)) - 0.5) * 0.12 * (1 - (y - 0.38) / 0.12));
    }
  }
  g.computeVertexNormals();
  g.scale(1, 1, 0.78);
  return g;
})();

export function makeSeeker(shadowSize: number, shadows: boolean): SeekerRig {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const coat = toon(PAL.purple);
  const coatDark = toon(0x33204d);
  const boot = toon(0x6b4423);
  const pants = toon(0x1f1626);

  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.15, 0.95, 0);
    add(leg, G.cyl(0.09, 0.08, 0.7, 8), pants, 0, -0.4, 0);
    add(leg, G.box(0.2, 0.3, 0.3), boot, 0, -0.8, 0.04);
    add(leg, G.box(0.22, 0.06, 0.32), toon(0x3a2418), 0, -0.93, 0.04, false);
    root.add(leg);
    legs.push(leg);
  }
  torso.add(mesh(coatGeo, coat));
  // vest + buttons
  add(torso, G.box(0.3, 0.55, 0.06), toon(0x5a3a2a), 0, 1.38, 0.24);
  for (let i = 0; i < 3; i++) add(torso, G.sphere(0.025, 6, 4), toon(0xd9a441), 0, 1.5 - i * 0.14, 0.28, false);
  // collar
  for (const s of [-1, 1]) {
    const c = add(torso, G.box(0.22, 0.32, 0.06), coatDark, s * 0.14, 1.82, 0.12);
    c.rotation.set(-0.35, s * 0.5, s * 0.25);
  }
  add(torso, G.cyl(0.1, 0.12, 0.12, 8), toon(0x2b1d3a), 0, 1.86, 0);

  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.38, 1.66, 0);
    add(arm, G.cyl(0.1, 0.12, 0.72, 8), coat, 0, -0.36, 0);
    add(arm, G.cyl(0.13, 0.13, 0.1, 8), coatDark, 0, -0.7, 0);
    add(arm, G.sphere(0.1, 10, 8), toon(0x3d2a5c), 0, -0.8, 0.02);
    torso.add(arm);
    arms.push(arm);
  }
  // lantern in right hand
  const { group: lantern, mat: lanternMat } = makeLantern(1.2);
  lantern.position.set(0, -0.92, 0.04);
  arms[1].add(lantern);

  const head = new THREE.Group();
  head.position.set(0, 1.9, 0.02);
  const pb = mesh(new THREE.SphereGeometry(0.3, 24, 14).scale(1, 0.85, 1), toon(PAL.orange));
  pb.position.y = 0.24;
  head.add(pb);
  const face = faceShell(0.302, 0.85, TEX.pumpkinFace(true), 4);
  face.position.y = 0.24;
  head.add(face);
  add(head, G.cyl(0.03, 0.05, 0.12, 6), toon(0x4f6b2a), 0.02, 0.52, 0).rotation.z = 0.3;
  torso.add(head);

  const lanternLight = new THREE.SpotLight(0xffa850, 40, 20, 0.62, 0.55, 1.3);
  lanternLight.position.set(0.4, 1.05, 0.35);
  lanternLight.target.position.set(0.1, 0, 6);
  lanternLight.castShadow = shadows;
  lanternLight.shadow.mapSize.set(shadowSize, shadowSize);
  lanternLight.shadow.bias = -0.002;
  lanternLight.shadow.camera.near = 0.3;
  lanternLight.shadow.camera.far = 20;
  root.add(lanternLight, lanternLight.target);
  const glowLight = new THREE.PointLight(0xff9a40, 3, 5, 1.5);
  glowLight.position.set(0.4, 0.8, 0.1);
  root.add(glowLight);
  root.add(blobShadow(0.8));
  return { root, torso, legs, arms, head, lanternLight, glowLight, lanternMat, phase: 0, swipe: 0 };
}

export function animateSeeker(s: SeekerRig, dt: number, speed: number, t: number, lookOffset: number): void {
  const moving = speed > 0.2;
  s.phase += dt * speed * 1.5;
  const sw = Math.sin(s.phase * Math.PI);
  const amp = moving ? Math.min(0.55, 0.15 + speed * 0.08) : 0;
  s.legs[0].rotation.x = sw * amp;
  s.legs[1].rotation.x = -sw * amp;
  s.arms[0].rotation.x = -sw * amp * 0.6;
  s.swipe = Math.max(0, s.swipe - dt * 3);
  s.arms[1].rotation.x = sw * amp * 0.35 + Math.sin(t * 2) * 0.05 - s.swipe * 1.8;
  s.arms[1].rotation.z = 0.1;
  s.arms[0].rotation.z = -0.1;
  s.torso.position.y = moving ? Math.abs(sw) * 0.05 : Math.sin(t * 1.6) * 0.015;
  s.torso.rotation.x = moving ? 0.06 : 0;
  s.head.rotation.y = lookOffset;
  s.head.rotation.z = Math.sin(t * 0.9) * 0.05;
}

let shadowTex: THREE.CanvasTexture | null = null;
function blobShadow(size: number): THREE.Mesh {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(10,4,16,0.55)');
    g.addColorStop(1, 'rgba(10,4,16,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  m.renderOrder = -1;
  return m;
}
