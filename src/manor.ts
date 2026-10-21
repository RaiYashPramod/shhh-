import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLS, DOOR_H, DOOR_W, PAL, ROOM, ROOM_GRID, ROWS, RoomType, WALL_H, WALL_T, WORLD_D, WORLD_W } from './config';
import { add, G, outlineMat, Rand, TEX, toon } from './materials';
import * as P from './props';

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  tall: boolean;
  enabled: boolean;
  isDoor?: boolean;
}

export interface Door {
  id: number;
  x: number;
  z: number;
  normal: 'x' | 'z';
  pivot: THREE.Group;
  closedAngle: number;
  openAngle: number;
  open: boolean;
  angle: number;
  collider: Collider;
  rooms: [number, number];
}

export interface HideSpot {
  id: number;
  kind: P.HideKind;
  room: number;
  pos: THREE.Vector3;
  front: THREE.Vector3;
  peek: THREE.Vector3;
  lookYaw: number;
  occupant: object | null;
  reserved: object | null;
}

export interface RoomInfo {
  id: number;
  col: number;
  row: number;
  type: RoomType;
  cx: number;
  cz: number;
}

export interface Pt {
  x: number;
  z: number;
}

const THEME: Record<RoomType, [(r: Rand) => P.PropDef, 'wall' | 'floor', (r: Rand) => P.PropDef, 'wall' | 'floor', number | null, 'wood' | 'stone' | 'tile']> = {
  library: [P.bookshelf, 'wall', P.bookshelf, 'wall', 0x5a2230, 'wood'],
  kitchen: [P.stove, 'wall', P.cauldron, 'floor', null, 'stone'],
  ballroom: [P.grandfatherClock, 'wall', P.candelabra, 'floor', 0x4a1f3a, 'wood'],
  nursery: [P.dresser, 'wall', P.bed, 'floor', 0x3d5a6b, 'wood'],
  cellar: [P.crates, 'wall', P.barrels, 'floor', null, 'stone'],
  greenhouse: [P.potShelf, 'wall', P.plantTable, 'floor', null, 'tile'],
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class Manor {
  readonly root = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly doors: Door[] = [];
  readonly rooms: RoomInfo[] = [];
  readonly spots: HideSpot[] = [];

  constructor(private rand: Rand) {
    const statics = new THREE.Group();
    this.buildWalls(statics);
    this.buildDoors();
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) this.buildRoom(statics, col, row);
    this.root.add(batchStatic(statics));
  }

  // ---------------- queries ----------------
  roomAt(x: number, z: number): number {
    const c = clamp(Math.floor(x / ROOM), 0, COLS - 1);
    const r = clamp(Math.floor(z / ROOM), 0, ROWS - 1);
    return r * COLS + c;
  }

  resolve(p: THREE.Vector3, r: number): void {
    for (let it = 0; it < 2; it++) {
      for (const c of this.colliders) {
        if (!c.enabled) continue;
        const nx = clamp(p.x, c.minX, c.maxX);
        const nz = clamp(p.z, c.minZ, c.maxZ);
        const dx = p.x - nx;
        const dz = p.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
        } else {
          const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) p.x = c.minX - r;
          else if (m === rr) p.x = c.maxX + r;
          else if (m === t) p.z = c.minZ - r;
          else p.z = c.maxZ + r;
        }
      }
    }
    p.x = clamp(p.x, WALL_T / 2 + r, WORLD_W - WALL_T / 2 - r);
    p.z = clamp(p.z, WALL_T / 2 + r, WORLD_D - WALL_T / 2 - r);
  }

  // Segment vs colliders (slab test). tallOnly = line-of-sight check.
  blocked(ax: number, az: number, bx: number, bz: number, opts: { tallOnly?: boolean; inflate?: number; ignoreDoors?: boolean } = {}): boolean {
    const inf = opts.inflate ?? 0;
    const dx = bx - ax;
    const dz = bz - az;
    for (const c of this.colliders) {
      if (!c.enabled) continue;
      if (opts.tallOnly && !c.tall) continue;
      if (opts.ignoreDoors && c.isDoor) continue;
      let t0 = 0, t1 = 1;
      const minX = c.minX - inf, maxX = c.maxX + inf, minZ = c.minZ - inf, maxZ = c.maxZ + inf;
      if (Math.abs(dx) < 1e-9) {
        if (ax < minX || ax > maxX) continue;
      } else {
        let ta = (minX - ax) / dx, tb = (maxX - ax) / dx;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) {
        if (az < minZ || az > maxZ) continue;
      } else {
        let ta = (minZ - az) / dz, tb = (maxZ - az) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) continue;
      }
      return true;
    }
    return false;
  }

  pointBlocked(x: number, z: number, pad: number): boolean {
    if (x < pad || x > WORLD_W - pad || z < pad || z > WORLD_D - pad) return true;
    for (const c of this.colliders) {
      if (!c.enabled || !c.tall) continue;
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  }

  center(room: number): Pt {
    return { x: this.rooms[room].cx, z: this.rooms[room].cz };
  }

  neighbors(room: number): number[] {
    const out: number[] = [];
    for (const d of this.doors) {
      if (d.rooms[0] === room) out.push(d.rooms[1]);
      else if (d.rooms[1] === room) out.push(d.rooms[0]);
    }
    return out;
  }

  doorBetween(a: number, b: number): Door | undefined {
    return this.doors.find((d) => (d.rooms[0] === a && d.rooms[1] === b) || (d.rooms[0] === b && d.rooms[1] === a));
  }

  nearestDoor(x: number, z: number, maxDist: number): Door | null {
    let best: Door | null = null;
    let bd = maxDist * maxDist;
    for (const d of this.doors) {
      const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  planPath(fx: number, fz: number, tx: number, tz: number, r: number): Pt[] {
    const a = this.roomAt(fx, fz);
    const b = this.roomAt(tx, tz);
    // BFS over room graph
    const prev = new Map<number, number>([[a, -1]]);
    const q = [a];
    while (q.length) {
      const cur = q.shift()!;
      if (cur === b) break;
      for (const n of this.neighbors(cur)) if (!prev.has(n)) {
        prev.set(n, cur);
        q.push(n);
      }
    }
    const chain: number[] = [];
    for (let c = b; c !== -1; c = prev.get(c) ?? -1) chain.unshift(c);

    const way: { p: Pt; room: number }[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      const d = this.doorBetween(chain[i], chain[i + 1])!;
      const from = this.rooms[chain[i]];
      const to = this.rooms[chain[i + 1]];
      if (d.normal === 'x') {
        const s = Math.sign(to.cx - from.cx);
        way.push({ p: { x: d.x - s * 1.4, z: d.z }, room: chain[i] }, { p: { x: d.x + s * 1.4, z: d.z }, room: chain[i + 1] });
      } else {
        const s = Math.sign(to.cz - from.cz);
        way.push({ p: { x: d.x, z: d.z - s * 1.4 }, room: chain[i] }, { p: { x: d.x, z: d.z + s * 1.4 }, room: chain[i + 1] });
      }
    }
    way.push({ p: { x: tx, z: tz }, room: b });

    const out: Pt[] = [];
    let cur: Pt = { x: fx, z: fz };
    let curRoom = a;
    for (let i = 0; i < way.length; i++) {
      const w = way[i];
      // door crossing segments (odd index within pair) never need a detour
      const crossing = i % 2 === 1 && i < way.length - 1;
      if (!crossing && this.blocked(cur.x, cur.z, w.p.x, w.p.z, { inflate: r * 0.9, ignoreDoors: true })) {
        const c = this.center(curRoom);
        if ((c.x - cur.x) ** 2 + (c.z - cur.z) ** 2 > 0.5) out.push(c);
      }
      out.push(w.p);
      cur = w.p;
      curRoom = w.room;
    }
    return out;
  }

  setDoor(d: Door, open: boolean): void {
    d.open = open;
  }

  update(dt: number): void {
    for (const d of this.doors) {
      const target = d.open ? d.openAngle : d.closedAngle;
      d.angle += (target - d.angle) * Math.min(1, dt * 7);
      d.pivot.rotation.y = d.angle;
      d.collider.enabled = Math.abs(d.angle - d.closedAngle) < 0.3;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.batched) m.geometry.dispose();
    });
  }

  // ---------------- construction ----------------
  private addCollider(c: Omit<Collider, 'enabled'> & { enabled?: boolean }): Collider {
    const full = { enabled: true, ...c };
    this.colliders.push(full);
    return full;
  }

  private wallMat(len: number): THREE.MeshToonMaterial {
    const key = Math.round(len * 10);
    let m = wallMatCache.get(key);
    if (!m) {
      const t = TEX.wallpaper().clone();
      t.repeat.set(len / 2.2, WALL_H / 2.2);
      t.needsUpdate = true;
      m = toon(0xffffff, t);
      wallMatCache.set(key, m);
    }
    return m;
  }

  private wallSegment(parent: THREE.Object3D, axis: 'x' | 'z', fixed: number, a: number, b: number): void {
    const len = b - a;
    if (len <= 0.01) return;
    const mid = (a + b) / 2;
    const g = new THREE.Group();
    if (axis === 'x') g.position.set(mid, 0, fixed);
    else {
      g.position.set(fixed, 0, mid);
      g.rotation.y = Math.PI / 2;
    }
    add(g, new THREE.BoxGeometry(len, WALL_H, WALL_T), this.wallMat(len), 0, WALL_H / 2, 0, false);
    const trim = toon(0x3a2418);
    add(g, G.box(len, 1.1, WALL_T + 0.1), trim, 0, 0.55, 0, false);
    add(g, G.box(len, 0.08, WALL_T + 0.18), toon(PAL.wood), 0, 1.12, 0, false);
    add(g, G.box(len, 0.2, WALL_T + 0.16), trim, 0, WALL_H - 0.1, 0, false);
    parent.add(g);
    if (axis === 'x') this.addCollider({ minX: a, maxX: b, minZ: fixed - WALL_T / 2, maxZ: fixed + WALL_T / 2, tall: true });
    else this.addCollider({ minX: fixed - WALL_T / 2, maxX: fixed + WALL_T / 2, minZ: a, maxZ: b, tall: true });
  }

  private wallLine(parent: THREE.Object3D, axis: 'x' | 'z', fixed: number, from: number, to: number, gaps: number[]): void {
    let cur = from;
    for (const g of gaps) {
      this.wallSegment(parent, axis, fixed, cur, g - DOOR_W / 2);
      // lintel + frame
      const lg = new THREE.Group();
      if (axis === 'x') lg.position.set(g, 0, fixed);
      else {
        lg.position.set(fixed, 0, g);
        lg.rotation.y = Math.PI / 2;
      }
      add(lg, G.box(DOOR_W, WALL_H - DOOR_H, WALL_T), this.wallMat(DOOR_W), 0, DOOR_H + (WALL_H - DOOR_H) / 2, 0, false);
      const frame = toon(0x2e1a12);
      for (const s of [-1, 1]) add(lg, G.box(0.16, DOOR_H, WALL_T + 0.16), frame, s * (DOOR_W / 2 + 0.02), DOOR_H / 2, 0);
      add(lg, G.box(DOOR_W + 0.36, 0.2, WALL_T + 0.16), frame, 0, DOOR_H + 0.08, 0);
      parent.add(lg);
      cur = g + DOOR_W / 2;
    }
    this.wallSegment(parent, axis, fixed, cur, to);
  }

  private buildWalls(parent: THREE.Object3D): void {
    this.wallLine(parent, 'x', 0, 0, WORLD_W, []);
    this.wallLine(parent, 'x', WORLD_D, 0, WORLD_W, []);
    this.wallLine(parent, 'z', 0, 0, WORLD_D, []);
    this.wallLine(parent, 'z', WORLD_W, 0, WORLD_D, []);
    for (let c = 1; c < COLS; c++) this.wallLine(parent, 'z', c * ROOM, 0, WORLD_D, Array.from({ length: ROWS }, (_, r) => r * ROOM + ROOM / 2));
    for (let r = 1; r < ROWS; r++) this.wallLine(parent, 'x', r * ROOM, 0, WORLD_W, Array.from({ length: COLS }, (_, c) => c * ROOM + ROOM / 2));
  }

  private buildDoors(): void {
    const leafW = DOOR_W - 0.1;
    const wood = toon(0x4f2e1f);
    const panel = toon(0x3a2117);
    const brass = toon(0xd9a441);
    const makeLeaf = (): THREE.Group => {
      const g = new THREE.Group();
      add(g, G.box(0.1, DOOR_H - 0.06, leafW), wood, 0, (DOOR_H - 0.06) / 2, leafW / 2);
      for (const s of [-1, 1])
        for (const [y, h] of [[0.85, 1.1], [2.15, 1.1]] as const)
          for (const z of [0.6, leafW - 0.6]) add(g, G.box(0.03, h, 0.75), panel, s * 0.06, y, z, false);
      for (const s of [-1, 1]) add(g, G.sphere(0.06, 8, 6), brass, s * 0.1, 1.4, leafW - 0.18);
      return g;
    };
    const mk = (x: number, z: number, normal: 'x' | 'z', ra: number, rb: number) => {
      const pivot = new THREE.Group();
      let closedAngle: number, openAngle: number, collider: Collider;
      if (normal === 'x') {
        pivot.position.set(x, 0, z - DOOR_W / 2 + 0.05);
        closedAngle = 0;
        openAngle = 1.65;
        collider = this.addCollider({ minX: x - WALL_T / 2, maxX: x + WALL_T / 2, minZ: z - DOOR_W / 2, maxZ: z + DOOR_W / 2, tall: true, isDoor: true });
      } else {
        pivot.position.set(x - DOOR_W / 2 + 0.05, 0, z);
        closedAngle = Math.PI / 2;
        openAngle = Math.PI / 2 - 1.65;
        collider = this.addCollider({ minX: x - DOOR_W / 2, maxX: x + DOOR_W / 2, minZ: z - WALL_T / 2, maxZ: z + WALL_T / 2, tall: true, isDoor: true });
      }
      pivot.add(makeLeaf());
      const open = this.rand() < 0.55;
      const d: Door = { id: this.doors.length, x, z, normal, pivot, closedAngle, openAngle, open, angle: open ? openAngle : closedAngle, collider, rooms: [ra, rb] };
      pivot.rotation.y = d.angle;
      collider.enabled = !open;
      this.doors.push(d);
      this.root.add(pivot);
    };
    for (let r = 0; r < ROWS; r++)
      for (let c = 1; c < COLS; c++) mk(c * ROOM, r * ROOM + ROOM / 2, 'x', r * COLS + c - 1, r * COLS + c);
    for (let r = 1; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) mk(c * ROOM + ROOM / 2, r * ROOM, 'z', (r - 1) * COLS + c, r * COLS + c);
  }

  private buildRoom(parent: THREE.Object3D, col: number, row: number): void {
    const rand = this.rand;
    const id = row * COLS + col;
    const type = ROOM_GRID[row][col];
    const ox = col * ROOM;
    const oz = row * ROOM;
    const cx = ox + ROOM / 2;
    const cz = oz + ROOM / 2;
    const [themeA, slotA, themeB, slotB, rugColor, floorKind] = THEME[type];
    const g = new THREE.Group();
    parent.add(g);

    // floor / ceiling / beams
    const ftex = floorKind === 'wood' ? TEX.floorWood() : floorKind === 'stone' ? TEX.floorStone() : TEX.floorTile();
    ftex.repeat.set(4, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), toon(0xffffff, ftex));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), toon(0x241620));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, WALL_H, cz);
    g.add(ceil);
    for (let i = 1; i < 4; i++) add(g, G.box(ROOM, 0.32, 0.4), toon(0x3a2418), cx, WALL_H - 0.16, oz + i * 5, false);
    if (rugColor !== null) {
      const rug = P.rug(7, 5, rugColor);
      rug.position.set(cx, 0, cz);
      g.add(rug);
    }

    // unlit chandelier: the manor is pitch black, only lanterns light it
    const chand = P.chandelier(type === 'ballroom');
    chand.position.set(cx, WALL_H - 1.0, cz);
    g.add(chand);
    this.rooms.push({ id, col, row, type, cx, cz });

    // quadrant furniture (shuffled per round)
    const items: { def: P.PropDef; slot: 'wall' | 'floor' }[] = [
      { def: P.wardrobe(), slot: 'wall' },
      { def: P.clothTable(rand), slot: 'floor' },
      { def: themeA(rand), slot: slotA },
      { def: themeB(rand), slot: slotB },
    ];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    const quads: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    items.forEach(({ def, slot }, i) => {
      const [qx, qz] = quads[i];
      let x: number, z: number, ry: number;
      if (slot === 'wall') {
        x = ox + (qx ? 15 : 5);
        ry = qz ? Math.PI : 0;
        z = qz ? oz + ROOM - WALL_T / 2 - def.d / 2 - 0.05 : oz + WALL_T / 2 + def.d / 2 + 0.05;
      } else {
        x = ox + (qx ? 14.5 : 5.5);
        z = oz + (qz ? 14.5 : 5.5);
        ry = def.hide ? 0 : rand() < 0.5 ? 0 : Math.PI / 2;
      }
      def.obj.position.set(x, 0, z);
      def.obj.rotation.y = ry;
      g.add(def.obj);
      const swap = Math.abs(Math.sin(ry)) > 0.5;
      const hw = (swap ? def.d : def.w) / 2;
      const hd = (swap ? def.w : def.d) / 2;
      this.addCollider({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, tall: def.tall });
      if (def.hide === 'wardrobe') this.addFacingSpot('wardrobe', id, x, z, ry, def.d / 2, 1.45);
      else if (def.hide) {
        // under table / bed: peek out toward the room centre
        const dir = new THREE.Vector3(cx - x, 0, cz - z).normalize();
        const edge = Math.min(hw / Math.abs(dir.x), hd / Math.abs(dir.z));
        const out = Math.min((hw + 0.6) / Math.abs(dir.x), (hd + 0.6) / Math.abs(dir.z));
        this.spots.push({
          id: this.spots.length,
          kind: def.hide,
          room: id,
          pos: new THREE.Vector3(x, 0, z),
          front: new THREE.Vector3(x, 0, z).addScaledVector(dir, out),
          peek: new THREE.Vector3(x, 0.42, z).addScaledVector(dir, edge + 0.14),
          lookYaw: Math.atan2(dir.x, dir.z),
          occupant: null,
          reserved: null,
        });
      }
    });

    // storage chest against the west or east wall, clear of the centred door/window
    {
      const c = P.chest();
      const west = rand() < 0.5;
      const z = oz + (rand() < 0.5 ? 6.5 : 13.5);
      const x = west ? ox + WALL_T / 2 + c.d / 2 + 0.05 : ox + ROOM - WALL_T / 2 - c.d / 2 - 0.05;
      const ry = west ? Math.PI / 2 : -Math.PI / 2;
      c.obj.position.set(x, 0, z);
      c.obj.rotation.y = ry;
      g.add(c.obj);
      this.addCollider({ minX: x - c.d / 2, maxX: x + c.d / 2, minZ: z - c.w / 2, maxZ: z + c.w / 2, tall: false });
      this.addFacingSpot('chest', id, x, z, ry, c.d / 2, 0.75);
    }

    // corner decor
    const corners: [number, number][] = [[ox + 1, oz + 1], [ox + ROOM - 1, oz + 1], [ox + 1, oz + ROOM - 1], [ox + ROOM - 1, oz + ROOM - 1]];
    for (const [x, z] of corners) {
      const k = rand();
      if (k < 0.4) {
        const p = P.pumpkin(0.32 + rand() * 0.14, true, rand() < 0.3);
        p.position.set(x, 0, z);
        p.rotation.y = Math.atan2(cx - x, cz - z) + (rand() - 0.5) * 0.6;
        g.add(p);
        if (rand() < 0.5) {
          const p2 = P.pumpkin(0.2, rand() < 0.5);
          p2.position.set(x + (cx > x ? 0.6 : -0.6), 0, z + (rand() - 0.5) * 0.4);
          p2.rotation.y = p.rotation.y + 0.4;
          g.add(p2);
        }
      } else if (k < 0.8) {
        P.candleCluster(g, x, z, rand);
      }
    }

    // cobwebs in upper corners of north/south walls
    for (const [x, z, flip, back] of [[ox + 0.2, oz + 0.21, false, false], [ox + ROOM - 0.2, oz + 0.21, true, false], [ox + 0.2, oz + ROOM - 0.21, false, true], [ox + ROOM - 0.2, oz + ROOM - 0.21, true, true]] as const) {
      if (rand() < 0.35) continue;
      const s = 1.4 + rand() * 0.8;
      const web = P.cobweb(s);
      web.rotation.y = back ? Math.PI : 0;
      web.rotation.z = flip !== back ? -Math.PI / 2 : 0;
      web.position.set(x + (flip ? -s / 2 : s / 2), WALL_H - 0.32 - s / 2, z + (back ? -0.01 : 0.01));
      g.add(web);
    }

    // windows on exterior walls; the first one gets heavy curtains to hide behind
    const windows: [number, number, number][] = [];
    if (row === 0) windows.push([cx, oz + WALL_T / 2 + 0.01, 0]);
    if (row === ROWS - 1) windows.push([cx, oz + ROOM - WALL_T / 2 - 0.01, Math.PI]);
    if (col === 0) windows.push([ox + WALL_T / 2 + 0.01, cz, Math.PI / 2]);
    if (col === COLS - 1) windows.push([ox + ROOM - WALL_T / 2 - 0.01, cz, -Math.PI / 2]);
    windows.forEach(([x, z, ry], i) => {
      const w = P.windowFrame();
      w.position.set(x, 1.2, z);
      w.rotation.y = ry;
      g.add(w);
      if (i > 0) return;
      const cur = P.curtains();
      cur.obj.position.set(x, 0, z);
      cur.obj.rotation.y = ry;
      g.add(cur.obj);
      const side = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
      const inward = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      for (const s of [-1, 1]) {
        const px = x + side.x * s * cur.drapeX + inward.x * 0.34;
        const pz = z + side.z * s * cur.drapeX + inward.z * 0.34;
        const hx = Math.abs(side.x) * 0.6 + Math.abs(inward.x) * 0.34;
        const hz = Math.abs(side.z) * 0.6 + Math.abs(inward.z) * 0.34;
        this.addCollider({ minX: px - hx, maxX: px + hx, minZ: pz - hz, maxZ: pz + hz, tall: true });
        if (s < 0) this.addFacingSpot('curtain', id, px, pz, ry, 0.34, 1.4);
      }
    });
  }

  // Spot in front of a wall-backed object facing yaw `ry`; halfDepth = distance from centre to front face.
  private addFacingSpot(kind: P.HideKind, room: number, x: number, z: number, ry: number, halfDepth: number, peekY: number): void {
    const f = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
    this.spots.push({
      id: this.spots.length,
      kind,
      room,
      pos: new THREE.Vector3(x, 0, z),
      front: new THREE.Vector3(x, 0, z).addScaledVector(f, halfDepth + 0.75),
      peek: new THREE.Vector3(x, peekY, z).addScaledVector(f, halfDepth + 0.12),
      lookYaw: ry,
      occupant: null,
      reserved: null,
    });
  }
}

const wallMatCache = new Map<number, THREE.MeshToonMaterial>();

// Merge all static meshes into one mesh per material: a few dozen draw calls for the whole manor.
function batchStatic(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.clearGroups();
    let list = buckets.get(mat);
    if (!list) buckets.set(mat, (list = []));
    list.push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    const lit = (mat as THREE.MeshToonMaterial).isMeshToonMaterial === true;
    mesh.castShadow = lit && mat !== outlineMat;
    mesh.receiveShadow = lit;
    mesh.userData.batched = true;
    out.add(mesh);
  }
  return out;
}
