import * as THREE from 'three';
import { Sound } from './audio';
import { animateKid, animateSeeker, KidRig, LANTERN_COLOR, makeKid, makeSeeker, SeekerRig } from './characters';
import {
  CAM_DIST, CAM_HEIGHT, COUNTDOWN, FLICKER_RANGE, FOOTSTEP_RANGE, HIDER_COLORS, HIDER_SPEED, KID_RADIUS, NET_HZ, ROUND_TIME,
  SEEKER_RADIUS, SEEKER_SPEED, SEEKER_WALK, SNEAK_SPEED, START_ROOM, TAG_RANGE, WALL_H,
} from './config';
import { Hud } from './hud';
import { Input } from './input';
import { Door, HideSpot, Manor, Pt } from './manor';
import { mulberry32, Rand } from './materials';
import type { Net } from './net/client';
import type { LobbyPlayer, PlayerState } from './net/protocol';

type Phase = 'menu' | 'countdown' | 'hunt' | 'end';
type Ctrl = 'local' | 'remote' | 'ai';
type KidMode = 'scatter' | 'hidden' | 'flee' | 'idle';
type SeekMode = 'blind' | 'patrol' | 'search' | 'check' | 'investigate' | 'look' | 'chase';

interface NetTarget {
  has: boolean;
  x: number;
  z: number;
  yaw: number;
}

interface Kid {
  id: string;
  name: string;
  color: number;
  ctrl: Ctrl;
  rig: KidRig;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hidden: HideSpot | null;
  hiddenUnknown: boolean; // seeker's view of a hidden remote kid: we know they hide, not where
  caught: boolean;
  caughtT: number;
  sneaking: boolean;
  lanternOn: boolean;
  stepAcc: number;
  seed: number;
  rooms: Set<number>;
  net: NetTarget;
  ai: { mode: KidMode; path: Pt[]; spot: HideSpot | null; timer: number; stuckT: number; last: THREE.Vector3 };
}

interface Seeker {
  id: string;
  name: string;
  ctrl: Ctrl;
  rig: SeekerRig;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  speed: number;
  net: NetTarget;
  // AI
  mode: SeekMode;
  path: Pt[];
  checks: HideSpot[];
  spot: HideSpot | null;
  timer: number;
  target: Kid | null;
  lastSeen: THREE.Vector3;
  lastSeenT: number;
  repathT: number;
  hearCd: number;
  doorWait: number;
  stepAcc: number;
  look: number;
  visited: number[];
  stuckT: number;
  last: THREE.Vector3;
  searched: number;
  // local player
  checking: number;
  checkSpot: HideSpot | null;
  swipeCd: number;
}

export interface GameSetup {
  mode: 'solo' | 'online';
  seed: number;
  myId: string;
  seekerId: string; // 'ai' = computer seeker
  players: LobbyPlayer[]; // humans
  bots: number; // computer hiders (solo only)
  shadows: { enabled: boolean; size: number };
  net: Net | null;
}

export interface RoundResult {
  hidersWin: boolean;
  amSeeker: boolean;
  playerSurvived: boolean;
  timeSurvived: number;
  roomsVisited: number;
  found: number;
  total: number;
}

const BOT_NAMES = ['Milo', 'Ivy', 'Pip', 'Wren', 'Otis'];
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const angleLerp = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// Lantern flicker: 1 = steady. p (0..1) = how close the other side is.
function flicker(t: number, seed: number, p: number): number {
  if (p <= 0) return 1;
  const wobble = 0.5 + 0.5 * Math.sin(t * 31 + seed) * Math.sin(t * 17.3 + seed * 2);
  const slot = Math.floor(t * 11 + seed);
  const gate = Math.abs(Math.sin(slot * 91.7 + seed) * 43758.5) % 1;
  if (gate < p * p * 0.6) return 0.06;
  return 1 - p * 0.45 * wobble;
}

export class Game {
  readonly manor: Manor;
  readonly root = new THREE.Group();
  phase: Phase = 'menu';
  private time = 0;
  private clock = COUNTDOWN;
  private huntTime = 0;
  private huntStart = 0;
  private endAt = -1;
  private kids: Kid[] = [];
  private seeker: Seeker;
  private me: Kid | Seeker;
  private amSeeker: boolean;
  private rand: Rand;
  private camYaw = 0;
  private camPitch = Math.atan2(CAM_HEIGHT - 1, CAM_DIST);
  private camDist = Math.hypot(CAM_DIST, CAM_HEIGHT - 1);
  private peekYaw = 0;
  private shake = 0;
  private noises: { x: number; z: number; r: number }[] = [];
  private heartT = 0;
  private sputterT = 0;
  private lastTick = -1;
  private sendT = 0;
  private online: boolean;
  private net: Net | null;
  onEnd: (r: RoundResult) => void = () => undefined;

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sound: Sound,
    private input: Input,
    private hud: Hud,
    setup: GameSetup,
  ) {
    this.rand = mulberry32(setup.seed);
    this.online = setup.mode === 'online';
    this.net = setup.net;
    this.manor = new Manor(this.rand);
    this.root.add(this.manor.root);
    scene.add(this.root);

    const start = this.manor.rooms[START_ROOM];
    const hiders: { id: string; name: string; color: number; ctrl: Ctrl }[] = setup.players
      .filter((p) => p.id !== setup.seekerId)
      .map((p) => ({ id: p.id, name: p.id === setup.myId ? 'You' : p.name, color: p.color, ctrl: p.id === setup.myId ? 'local' : 'remote' }));
    for (let i = 0; i < setup.bots; i++) {
      const used = new Set(hiders.map((h) => h.color));
      hiders.push({ id: `bot${i}`, name: BOT_NAMES[i % BOT_NAMES.length], color: HIDER_COLORS.find((c) => !used.has(c)) ?? HIDER_COLORS[i], ctrl: 'ai' });
    }
    hiders.forEach((h, i) => {
      const a = (i / hiders.length) * Math.PI * 2;
      const kid: Kid = {
        ...h,
        rig: makeKid(h.color),
        pos: new THREE.Vector3(start.cx + Math.cos(a) * 2.4, 0, start.cz + 2 + Math.sin(a) * 2.4),
        vel: new THREE.Vector3(),
        yaw: Math.PI,
        hidden: null,
        hiddenUnknown: false,
        caught: false,
        caughtT: 0,
        sneaking: false,
        lanternOn: true,
        stepAcc: 0,
        seed: i * 13.7,
        rooms: new Set([START_ROOM]),
        net: { has: false, x: 0, z: 0, yaw: 0 },
        ai: { mode: 'idle', path: [], spot: null, timer: 0, stuckT: 0, last: new THREE.Vector3() },
      };
      kid.rig.root.position.copy(kid.pos);
      this.root.add(kid.rig.root);
      this.kids.push(kid);
    });

    const seekerPlayer = setup.players.find((p) => p.id === setup.seekerId);
    const rig = makeSeeker(setup.shadows.size, setup.shadows.enabled);
    this.seeker = {
      id: setup.seekerId,
      name: seekerPlayer ? (seekerPlayer.id === setup.myId ? 'You' : seekerPlayer.name) : 'Pumpkin',
      ctrl: setup.seekerId === 'ai' ? 'ai' : setup.seekerId === setup.myId ? 'local' : 'remote',
      rig,
      pos: new THREE.Vector3(start.cx, 0, start.cz - 3),
      vel: new THREE.Vector3(),
      yaw: Math.PI,
      speed: 0,
      net: { has: false, x: 0, z: 0, yaw: 0 },
      mode: 'blind',
      path: [],
      checks: [],
      spot: null,
      timer: 0,
      target: null,
      lastSeen: new THREE.Vector3(),
      lastSeenT: -99,
      repathT: 0,
      hearCd: 0,
      doorWait: 0,
      stepAcc: 0,
      look: 0,
      visited: this.manor.rooms.map(() => -999),
      stuckT: 0,
      last: new THREE.Vector3(),
      searched: -1,
      checking: 0,
      checkSpot: null,
      swipeCd: 0,
    };
    rig.root.position.copy(this.seeker.pos);
    rig.root.rotation.y = Math.PI;
    this.root.add(rig.root);

    this.amSeeker = this.seeker.ctrl === 'local';
    this.me = this.amSeeker ? this.seeker : (this.kids.find((k) => k.ctrl === 'local') ?? this.kids[0]);
  }

  start(): void {
    this.phase = 'countdown';
    this.clock = COUNTDOWN;
    this.camYaw = this.me.yaw;
    this.hud.show(true);
    this.hud.setRole(this.amSeeker);
    if (this.amSeeker) this.hud.message('You are the Seeker. Count to 20…', 3, true);
    else this.hud.message('Hide! The Seeker opens their eyes soon…', 3, true);
    this.sound.startAmbience();
    for (const k of this.kids) if (k.ctrl === 'ai') this.botPickSpot(k, true);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    this.manor.dispose();
    this.sound.stopAmbience();
    this.hud.blind(null);
    this.hud.peek(null);
  }

  // ======================================================== network events
  applySnapshot(states: Record<string, PlayerState>): void {
    for (const k of this.kids) {
      if (k.ctrl !== 'remote') continue;
      const s = states[k.id];
      if (!s) continue;
      const [x, z, yaw, sneak, h, lantern] = s;
      if (!k.net.has) k.pos.set(x, 0, z);
      k.net = { has: true, x, z, yaw };
      k.sneaking = sneak === 1;
      k.lanternOn = lantern === 1;
      if (k.caught) continue;
      const spot = h >= 0 ? this.manor.spots[h] ?? null : null;
      if (k.hidden !== spot) {
        if (k.hidden && k.hidden.occupant === k) k.hidden.occupant = null;
        if (spot || k.hidden) this.sound.wardrobe({ x, y: 1, z });
        k.hidden = spot;
        if (spot) spot.occupant = k;
      }
      k.hiddenUnknown = h === -2;
    }
    const s = this.seeker;
    if (s.ctrl === 'remote') {
      const st = states[s.id];
      if (st) {
        if (!s.net.has) s.pos.set(st[0], 0, st[1]);
        s.net = { has: true, x: st[0], z: st[1], yaw: st[2] };
      }
    }
  }

  remoteDoor(id: number, open: boolean): void {
    const d = this.manor.doors[id];
    if (!d || d.open === open) return;
    this.manor.setDoor(d, open);
    this.sound.doorCreak({ x: d.x, y: 1.5, z: d.z }, open);
  }

  remoteCaught(id: string): void {
    const k = this.kids.find((x) => x.id === id);
    if (k) this.tag(k);
  }

  remoteChecked(found: boolean): void {
    if (!found) this.hud.message('Empty…', 1.2);
  }

  remoteHunt(): void {
    if (this.phase === 'countdown') this.beginHunt();
  }

  remoteEnd(hidersWin: boolean): void {
    this.finish(hidersWin);
  }

  remoteLeft(id: string): void {
    const i = this.kids.findIndex((k) => k.id === id);
    if (i < 0) return;
    const k = this.kids[i];
    if (k.hidden && k.hidden.occupant === k) k.hidden.occupant = null;
    this.root.remove(k.rig.root);
    this.kids.splice(i, 1);
    this.hud.message(`${k.name} left the manor`, 2);
  }

  // ======================================================== update
  update(dt: number): void {
    this.time += dt;
    this.manor.update(dt);
    this.hud.update(dt);

    if (this.phase === 'menu') {
      this.menuCamera();
      this.updateLanterns(dt);
      this.animateAll(dt);
      return;
    }

    if (this.phase === 'countdown') {
      this.clock -= dt;
      const sec = Math.ceil(this.clock);
      if (sec !== this.lastTick && sec <= 5 && sec > 0) this.sound.tick(sec <= 3);
      this.lastTick = sec;
      // online: server's 'hunt' message is authoritative; small grace before forcing it locally
      if (this.clock <= (this.online ? -1.5 : 0)) this.beginHunt();
    } else if (this.phase === 'hunt') {
      this.clock -= dt;
      this.huntTime += dt;
      if (!this.online) {
        if (this.clock <= 0) return this.finish(true);
        if (this.endAt > 0 && this.time >= this.endAt) return this.finish(false);
      }
    }

    this.noises.length = 0;
    if (this.phase !== 'end') {
      if (this.amSeeker) this.updateLocalSeeker(dt);
      else this.updateLocalHider(dt);
      for (const k of this.kids) {
        if (k.ctrl === 'ai') this.updateBot(k, dt);
        else if (k.ctrl === 'remote') this.updateRemoteKid(k, dt);
      }
      if (this.seeker.ctrl === 'ai') this.updateSeekerAI(dt);
      else if (this.seeker.ctrl === 'remote') this.updateRemoteSeeker(dt);
      this.sendState(dt);
    }
    this.updateLanterns(dt);
    this.animateAll(dt);
    this.updateCamera(dt);
    this.updateAudio(dt);

    const label = this.phase === 'countdown' ? (this.amSeeker ? 'Counting…' : 'Seeker counting') : this.phase === 'hunt' ? (this.amSeeker ? 'Find them' : 'Survive') : '';
    this.hud.setClock(this.clock, label, this.phase === 'hunt' && this.clock < 30);
    this.hud.setKids([
      { name: this.seeker.name, color: 0xf28c1c, caught: false, isPlayer: this.amSeeker, seeker: true },
      ...this.kids.map((k) => ({ name: k.name, color: k.color, caught: k.caught, isPlayer: k.ctrl === 'local', seeker: false })),
    ]);
  }

  private beginHunt(): void {
    this.phase = 'hunt';
    this.clock = ROUND_TIME;
    this.huntStart = this.time;
    if (this.seeker.ctrl === 'ai') this.seeker.mode = 'patrol';
    this.hud.blind(null);
    this.sound.bell();
    this.hud.message(this.amSeeker ? 'Go find them!' : 'Ready or not… here I come!', 2.6, true);
  }

  private sendState(dt: number): void {
    if (!this.net) return;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / NET_HZ;
    const r = (v: number) => Math.round(v * 100) / 100;
    if (this.amSeeker) {
      const s = this.seeker;
      this.net.send({ t: 'st', s: [r(s.pos.x), r(s.pos.z), r(s.yaw), 0, -1, 1] });
    } else {
      const k = this.me as Kid;
      if (k.caught) return;
      this.net.send({ t: 'st', s: [r(k.pos.x), r(k.pos.z), r(k.yaw), k.sneaking ? 1 : 0, k.hidden ? k.hidden.id : -1, k.lanternOn ? 1 : 0] });
    }
  }

  // ======================================================== local hider
  private updateLocalHider(dt: number): void {
    const p = this.me as Kid;
    const inp = this.input;
    const m = inp.mouse();

    if (p.caught) {
      this.camYaw -= m.dx;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + m.dy, -0.1, 0.9);
      this.hud.prompt(null);
      return;
    }

    if (inp.hit('KeyF') && !p.hidden) {
      p.lanternOn = !p.lanternOn;
      this.sound.tick(false);
      this.hud.lantern(p.lanternOn);
    }

    if (p.hidden) {
      this.peekYaw = THREE.MathUtils.clamp(this.peekYaw - m.dx, -0.9, 0.9);
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + m.dy, -0.45, 0.45);
      this.hud.prompt('E · Leave hiding spot');
      if (inp.hit('KeyE')) this.exitSpot(p);
      return;
    }

    this.camYaw -= m.dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + m.dy, -0.15, 0.8);

    const ax = inp.axis();
    p.sneaking = inp.held('ShiftLeft') || inp.held('ShiftRight');
    this.hud.sneak(p.sneaking);
    const want = this.wishDir(ax.x, ax.y).multiplyScalar(p.sneaking ? SNEAK_SPEED : HIDER_SPEED);
    p.vel.lerp(want, Math.min(1, dt * 12));
    this.moveKid(p, dt);

    const spot = this.nearestSpot(p.pos, 1.5);
    const door = this.manor.nearestDoor(p.pos.x, p.pos.z, 2.3);
    const spotD = spot ? spot.front.distanceTo(p.pos) : 99;
    const doorD = door ? Math.hypot(door.x - p.pos.x, door.z - p.pos.z) : 99;
    if (spot && spotD <= doorD) {
      this.hud.prompt(`E · Hide ${HIDE_LABEL[spot.kind]}`);
      if (inp.hit('KeyE')) {
        if (spot.occupant) {
          this.hud.message('Eek! Someone is already hiding here!', 1.8);
          this.sound.wardrobe(spot.pos);
        } else this.enterSpot(p, spot);
      }
    } else if (door) {
      this.hud.prompt(door.open ? 'E · Close door' : 'E · Open door');
      if (inp.hit('KeyE')) this.toggleDoor(door, p.pos);
    } else this.hud.prompt(null);
  }

  private wishDir(x: number, y: number): THREE.Vector3 {
    const f = tmp.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const r = tmp2.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const want = new THREE.Vector3().addScaledVector(f, y).addScaledVector(r, x);
    if (want.lengthSq() > 1) want.normalize();
    return want;
  }

  private moveKid(k: Kid, dt: number): void {
    const bx = k.pos.x, bz = k.pos.z;
    k.pos.addScaledVector(k.vel, dt);
    this.manor.resolve(k.pos, KID_RADIUS);
    const moved = Math.hypot(k.pos.x - bx, k.pos.z - bz);
    if (k.vel.lengthSq() > 0.3) k.yaw = angleLerp(k.yaw, Math.atan2(k.vel.x, k.vel.z), Math.min(1, dt * 14));
    this.kidSteps(k, moved, dt);
  }

  private kidSteps(k: Kid, moved: number, dt: number): void {
    k.rooms.add(this.manor.roomAt(k.pos.x, k.pos.z));
    k.stepAcc += moved;
    if (k.stepAcc > 0.85) {
      k.stepAcc = 0;
      if (!k.sneaking && moved / dt > 3) {
        if (k.ctrl === 'local') this.sound.footstep(null, false, 0.45);
        else this.sound.footstep({ x: k.pos.x, y: 0.2, z: k.pos.z }, false, 0.7, 10);
        this.noises.push({ x: k.pos.x, z: k.pos.z, r: 8 });
      }
    }
  }

  private nearestSpot(p: THREE.Vector3, maxDist: number): HideSpot | null {
    let best: HideSpot | null = null;
    let bd = maxDist;
    for (const s of this.manor.spots) {
      const d = s.front.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private toggleDoor(d: Door, by: THREE.Vector3): void {
    this.manor.setDoor(d, !d.open);
    this.sound.doorCreak({ x: d.x, y: 1.5, z: d.z }, d.open);
    this.noises.push({ x: by.x, z: by.z, r: 10 });
    this.net?.send({ t: 'door', id: d.id, open: d.open });
  }

  private enterSpot(k: Kid, s: HideSpot): void {
    k.hidden = s;
    s.occupant = k;
    if (s.reserved && s.reserved !== k) {
      const other = s.reserved as Kid;
      s.reserved = null;
      if (other.ai.spot === s) this.botPickSpot(other, false);
    }
    s.reserved = k;
    k.vel.set(0, 0, 0);
    k.pos.copy(s.pos);
    this.sound.wardrobe({ x: s.pos.x, y: 1, z: s.pos.z });
    if (k.ctrl === 'local') {
      this.peekYaw = 0;
      this.camPitch = 0;
      this.hud.peek(s.kind);
      this.hud.sneak(false);
    } else {
      k.ai.mode = 'hidden';
      k.ai.timer = 0;
    }
  }

  private exitSpot(k: Kid, quiet = false): void {
    const s = k.hidden;
    if (!s) return;
    if (s.occupant === k) s.occupant = null;
    if (s.reserved === k) s.reserved = null;
    k.hidden = null;
    k.pos.copy(s.front);
    k.yaw = s.lookYaw;
    if (!quiet) this.sound.wardrobe({ x: s.pos.x, y: 1, z: s.pos.z });
    if (k.ctrl === 'local') {
      this.camYaw = s.lookYaw;
      this.camPitch = 0.35;
      this.hud.peek(null);
    }
  }

  // ======================================================== local seeker
  private updateLocalSeeker(dt: number): void {
    const s = this.seeker;
    const inp = this.input;
    const m = inp.mouse();

    if (this.phase === 'countdown') {
      this.hud.blind(Math.ceil(this.clock));
      this.hud.prompt(null);
      s.speed = 0;
      return;
    }

    this.camYaw -= m.dx;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + m.dy, -0.15, 0.8);
    s.swipeCd -= dt;

    if (s.checking > 0) {
      s.checking -= dt;
      s.speed = 0;
      this.hud.prompt('Searching…');
      if (s.checking <= 0 && s.checkSpot) this.resolveCheck(s.checkSpot);
      return;
    }

    const ax = inp.axis();
    const walking = inp.held('ShiftLeft') || inp.held('ShiftRight');
    const want = this.wishDir(ax.x, ax.y).multiplyScalar(walking ? SEEKER_WALK : SEEKER_SPEED);
    s.vel.lerp(want, Math.min(1, dt * 10));
    const bx = s.pos.x, bz = s.pos.z;
    s.pos.addScaledVector(s.vel, dt);
    this.manor.resolve(s.pos, SEEKER_RADIUS);
    const moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
    s.speed = moved / Math.max(dt, 1e-4);
    // body (and lantern) turn with the mouse
    s.yaw = angleLerp(s.yaw, this.camYaw, Math.min(1, dt * 12));
    s.stepAcc += moved;
    if (s.stepAcc > 1.15) {
      s.stepAcc = 0;
      this.sound.footstep(null, true, 0.5);
    }

    if (inp.clicked && s.swipeCd <= 0) {
      s.swipeCd = 0.6;
      s.rig.swipe = 1;
      this.sound.footstep(null, true, 0.3);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      let best: Kid | null = null;
      let bd = TAG_RANGE + 0.35;
      for (const k of this.kids) {
        if (k.caught || k.hidden || k.hiddenUnknown) continue;
        const dx = k.pos.x - s.pos.x, dz = k.pos.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.2) {
          bd = d;
          best = k;
        }
      }
      if (best) {
        if (this.online) this.net?.send({ t: 'tag', id: best.id });
        else this.tag(best);
      }
    }

    const spot = this.nearestSpot(s.pos, 1.6);
    const door = this.manor.nearestDoor(s.pos.x, s.pos.z, 2.4);
    const spotD = spot ? spot.front.distanceTo(s.pos) : 99;
    const doorD = door ? Math.hypot(door.x - s.pos.x, door.z - s.pos.z) : 99;
    if (spot && spotD <= doorD) {
      this.hud.prompt(`E · Search ${SEARCH_LABEL[spot.kind]}`);
      if (inp.hit('KeyE')) {
        s.checking = 0.7;
        s.checkSpot = spot;
        s.vel.set(0, 0, 0);
        this.sound.wardrobe({ x: spot.pos.x, y: 1, z: spot.pos.z });
      }
    } else if (door) {
      this.hud.prompt(door.open ? 'E · Close door' : 'E · Open door');
      if (inp.hit('KeyE')) this.toggleDoor(door, s.pos);
    } else this.hud.prompt('Click · Grab');
  }

  private resolveCheck(spot: HideSpot): void {
    if (this.online) {
      this.net?.send({ t: 'check', spot: spot.id });
      return;
    }
    const occ = spot.occupant as Kid | null;
    if (occ) this.tag(occ);
    else this.hud.message('Empty…', 1.2);
  }

  // ======================================================== remote actors
  private updateRemoteKid(k: Kid, dt: number): void {
    if (!k.net.has || k.caught) return;
    const bx = k.pos.x, bz = k.pos.z;
    const a = Math.min(1, dt * 12);
    k.pos.x += (k.net.x - k.pos.x) * a;
    k.pos.z += (k.net.z - k.pos.z) * a;
    k.yaw = angleLerp(k.yaw, k.net.yaw, a);
    const moved = Math.hypot(k.pos.x - bx, k.pos.z - bz);
    k.vel.set((k.pos.x - bx) / dt, 0, (k.pos.z - bz) / dt);
    if (!k.hidden && !k.hiddenUnknown) this.kidSteps(k, moved, dt);
  }

  private updateRemoteSeeker(dt: number): void {
    const s = this.seeker;
    if (!s.net.has) return;
    const bx = s.pos.x, bz = s.pos.z;
    const a = Math.min(1, dt * 12);
    s.pos.x += (s.net.x - s.pos.x) * a;
    s.pos.z += (s.net.z - s.pos.z) * a;
    s.yaw = angleLerp(s.yaw, s.net.yaw, a);
    const moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
    s.speed = moved / Math.max(dt, 1e-4);
    s.stepAcc += moved;
    if (s.stepAcc > 1.15) {
      s.stepAcc = 0;
      this.sound.footstep({ x: s.pos.x, y: 0.1, z: s.pos.z }, true, 1, FOOTSTEP_RANGE);
    }
  }

  // ======================================================== bots (solo)
  private botPickSpot(k: Kid, avoidStart: boolean): void {
    if (k.ai.spot && k.ai.spot.reserved === k) k.ai.spot.reserved = null;
    const here = this.manor.roomAt(k.pos.x, k.pos.z);
    const sRoom = this.manor.roomAt(this.seeker.pos.x, this.seeker.pos.z);
    const free = this.manor.spots.filter((s) => !s.occupant && !s.reserved && !(avoidStart && s.room === START_ROOM) && s.room !== sRoom);
    if (!free.length) {
      k.ai.mode = 'idle';
      k.ai.timer = 2;
      return;
    }
    free.sort((a, b) => this.spotScore(a, here) - this.spotScore(b, here));
    const s = free[Math.min(free.length - 1, Math.floor(this.rand() * Math.min(3, free.length)))];
    s.reserved = k;
    k.ai.spot = s;
    k.ai.mode = k.ai.mode === 'flee' ? 'flee' : 'scatter';
    k.ai.path = this.manor.planPath(k.pos.x, k.pos.z, s.front.x, s.front.z, KID_RADIUS);
  }

  private spotScore(s: HideSpot, here: number): number {
    const a = this.manor.rooms[here];
    const b = this.manor.rooms[s.room];
    const hops = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    return Math.abs(hops - 1.3) + this.rand() * 1.5;
  }

  private updateBot(k: Kid, dt: number): void {
    if (k.caught) return;
    const ai = k.ai;
    const sk = this.seeker;
    const dSeeker = k.pos.distanceTo(sk.pos);

    if (k.hidden) {
      ai.timer += dt;
      const searchingNear = sk.ctrl === 'ai' ? sk.mode === 'check' && sk.spot !== k.hidden : sk.checking > 0 && sk.checkSpot !== k.hidden;
      if (this.phase === 'hunt' && searchingNear && dSeeker < 4 && ai.timer > 1) {
        ai.timer = 0;
        if (this.rand() < 0.12) {
          this.exitSpot(k);
          ai.mode = 'flee';
          this.botFlee(k);
        }
      }
      return;
    }

    const chased = this.phase === 'hunt' && (sk.ctrl === 'ai' ? sk.target === k && sk.mode === 'chase' : dSeeker < 7 && !this.manor.blocked(sk.pos.x, sk.pos.z, k.pos.x, k.pos.z, { tallOnly: true }));
    if (chased && ai.mode !== 'flee') {
      ai.mode = 'flee';
      this.botFlee(k);
    }
    if (ai.mode === 'idle') {
      ai.timer -= dt;
      if (ai.timer <= 0) this.botPickSpot(k, false);
    }

    const fleeing = ai.mode === 'flee' && chased;
    k.sneaking = this.phase === 'hunt' && !fleeing && dSeeker < 12;
    k.lanternOn = !(this.phase === 'hunt' && !fleeing && dSeeker < 14);
    const speed = k.sneaking ? SNEAK_SPEED : HIDER_SPEED * (fleeing ? 1 : 0.92);
    const want = new THREE.Vector3();
    const next = ai.path[0];
    if (next) {
      want.set(next.x - k.pos.x, 0, next.z - k.pos.z);
      const d = want.length();
      if (d < 0.35) ai.path.shift();
      else want.multiplyScalar(speed / d);
      this.openDoorAhead(k.pos, next, false);
    } else if (ai.spot) {
      if (ai.spot.occupant) this.botPickSpot(k, false);
      else this.enterSpot(k, ai.spot);
      return;
    } else if (ai.mode === 'flee') {
      ai.mode = 'idle';
      ai.timer = 1;
    }
    k.vel.lerp(want, Math.min(1, dt * 10));
    this.moveKid(k, dt);

    ai.stuckT += dt;
    if (ai.stuckT > 1) {
      if (ai.last.distanceTo(k.pos) < 0.3 && ai.spot) ai.path = this.manor.planPath(k.pos.x, k.pos.z, ai.spot.front.x, ai.spot.front.z, KID_RADIUS);
      ai.last.copy(k.pos);
      ai.stuckT = 0;
    }
  }

  private botFlee(k: Kid): void {
    const here = this.manor.roomAt(k.pos.x, k.pos.z);
    const options = this.manor.neighbors(here);
    let best = options[0];
    let bd = -1;
    for (const r of options) {
      const c = this.manor.center(r);
      const d = Math.hypot(c.x - this.seeker.pos.x, c.z - this.seeker.pos.z) + this.rand() * 4;
      if (d > bd) {
        bd = d;
        best = r;
      }
    }
    if (k.ai.spot && k.ai.spot.reserved === k) k.ai.spot.reserved = null;
    const spots = this.manor.spots.filter((s) => s.room === best && !s.occupant && !s.reserved);
    const s = spots[Math.floor(this.rand() * spots.length)] ?? null;
    k.ai.spot = s;
    if (s) s.reserved = k;
    const goal = s ? s.front : this.manor.center(best);
    k.ai.path = this.manor.planPath(k.pos.x, k.pos.z, goal.x, goal.z, KID_RADIUS);
  }

  private openDoorAhead(pos: THREE.Vector3, next: Pt, isSeeker: boolean): boolean {
    const d = this.manor.nearestDoor(pos.x, pos.z, 1.8);
    if (!d || d.open) return false;
    const c = d.collider;
    if (!segAabb(pos.x, pos.z, next.x, next.z, c.minX - 0.3, c.maxX + 0.3, c.minZ - 0.3, c.maxZ + 0.3)) return false;
    this.manor.setDoor(d, true);
    this.sound.doorCreak({ x: d.x, y: 1.5, z: d.z }, true);
    if (!isSeeker) this.noises.push({ x: pos.x, z: pos.z, r: 10 });
    return true;
  }

  // ======================================================== AI seeker (solo)
  private updateSeekerAI(dt: number): void {
    const s = this.seeker;
    s.hearCd -= dt;
    if (s.mode === 'blind') {
      s.speed = 0;
      return;
    }

    const now = this.time;
    const fwdX = Math.sin(s.yaw), fwdZ = Math.cos(s.yaw);
    let seen: Kid | null = null;
    let seenD = 99;
    for (const k of this.kids) {
      if (k.caught || k.hidden) continue;
      const dx = k.pos.x - s.pos.x, dz = k.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      // in the dark a lit lantern gives you away; a dark one hides you
      const range = (k.lanternOn ? 12 : 5) * (k.sneaking ? 0.75 : 1);
      if (d > range) continue;
      const cos = (dx * fwdX + dz * fwdZ) / (d || 1);
      if (d > 2.2 && cos < 0.6 && !(k.lanternOn && d < 7)) continue;
      if (this.manor.blocked(s.pos.x, s.pos.z, k.pos.x, k.pos.z, { tallOnly: true })) continue;
      if (d < seenD) {
        seenD = d;
        seen = k;
      }
    }
    if (seen) {
      if (s.mode !== 'chase') this.sound.footstep({ x: s.pos.x, y: 0.2, z: s.pos.z }, true, 1.2, FOOTSTEP_RANGE);
      s.mode = 'chase';
      s.target = seen;
      s.lastSeen.copy(seen.pos);
      s.lastSeenT = now;
    }

    if (!seen && s.mode !== 'chase' && s.hearCd <= 0) {
      const myRoom = this.manor.roomAt(s.pos.x, s.pos.z);
      for (const n of this.noises) {
        const d = Math.hypot(n.x - s.pos.x, n.z - s.pos.z);
        const r = this.manor.roomAt(n.x, n.z) === myRoom ? n.r : n.r * 0.6;
        if (d < r) {
          this.investigate(n.x, n.z);
          s.hearCd = 1.2;
          break;
        }
      }
    }

    let speed = 0;
    let face: number | null = null;
    switch (s.mode) {
      case 'chase': {
        const t = s.target!;
        if (t.caught) {
          s.mode = 'look';
          s.timer = 1.2;
          break;
        }
        if (t.hidden) {
          if (now - s.lastSeenT < 1.4) this.goCheck(t.hidden);
          else this.investigate(s.lastSeen.x, s.lastSeen.z);
          break;
        }
        if (now - s.lastSeenT > 2.2) {
          this.investigate(s.lastSeen.x, s.lastSeen.z);
          break;
        }
        const d = s.pos.distanceTo(t.pos);
        if (d < TAG_RANGE && seen === t) {
          this.tag(t);
          s.mode = 'look';
          s.timer = 1.4;
          break;
        }
        speed = SEEKER_SPEED;
        if (seen === t && !this.manor.blocked(s.pos.x, s.pos.z, t.pos.x, t.pos.z, { inflate: SEEKER_RADIUS * 0.8 })) {
          s.path = [{ x: t.pos.x, z: t.pos.z }];
        } else {
          s.repathT -= dt;
          if (s.repathT <= 0 || !s.path.length) {
            s.path = this.manor.planPath(s.pos.x, s.pos.z, s.lastSeen.x, s.lastSeen.z, SEEKER_RADIUS);
            s.repathT = 0.4;
          }
        }
        break;
      }
      case 'investigate':
        speed = 4.4;
        if (!s.path.length) {
          s.mode = 'look';
          s.timer = 1.3;
          const room = this.manor.roomAt(s.pos.x, s.pos.z);
          s.checks = this.manor.spots
            .filter((p) => p.room === room)
            .sort((a, b) => a.front.distanceTo(s.lastSeen) - b.front.distanceTo(s.lastSeen))
            .slice(0, 2);
        }
        break;
      case 'look':
        s.timer -= dt;
        s.look = Math.sin(this.time * 2.6) * 0.8;
        face = s.yaw + Math.sin(this.time * 1.3) * dt * 1.5;
        if (s.timer <= 0) {
          s.look = 0;
          if (s.checks.length) this.goCheck(s.checks.shift()!);
          else {
            s.mode = 'patrol';
            s.path = [];
          }
        }
        break;
      case 'search':
        speed = 3.2;
        if (!s.path.length) {
          s.mode = 'check';
          s.timer = 0.9;
        }
        break;
      case 'check': {
        const sp = s.spot!;
        face = Math.atan2(sp.pos.x - s.pos.x, sp.pos.z - s.pos.z);
        s.timer -= dt;
        if (s.timer <= 0) {
          const occ = sp.occupant as Kid | null;
          if (occ) this.tag(occ);
          if (s.checks.length) this.goCheck(s.checks.shift()!);
          else {
            s.mode = 'look';
            s.timer = occ ? 1.4 : 0.6;
          }
        }
        break;
      }
      case 'patrol':
        speed = SEEKER_WALK;
        if (!s.path.length) {
          const here = this.manor.roomAt(s.pos.x, s.pos.z);
          if (s.searched !== here) {
            s.searched = here;
            s.visited[here] = now;
            s.checks = this.manor.spots.filter((p) => p.room === here && this.rand() < 0.5);
            s.mode = 'look';
            s.timer = 1.1;
          } else {
            const dc = this.manor.center(this.pickPatrolRoom(here));
            s.path = this.manor.planPath(s.pos.x, s.pos.z, dc.x, dc.z, SEEKER_RADIUS);
          }
        }
        break;
    }

    s.doorWait -= dt;
    const next = s.path[0];
    let moved = 0;
    if (next && speed > 0 && s.doorWait <= 0) {
      if (this.openDoorAhead(s.pos, next, true)) s.doorWait = 0.45;
      else {
        const dx = next.x - s.pos.x, dz = next.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) s.path.shift();
        else {
          const step = Math.min(d, speed * dt);
          const bx = s.pos.x, bz = s.pos.z;
          s.pos.x += (dx / d) * step;
          s.pos.z += (dz / d) * step;
          this.manor.resolve(s.pos, SEEKER_RADIUS);
          moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
          face = Math.atan2(dx, dz);
        }
      }
      s.stuckT += dt;
      if (s.stuckT > 1.2) {
        if (s.last.distanceTo(s.pos) < 0.3) s.path.shift();
        s.last.copy(s.pos);
        s.stuckT = 0;
      }
    }
    s.speed = moved / Math.max(dt, 1e-4);
    if (face !== null) s.yaw = angleLerp(s.yaw, face, Math.min(1, dt * 8));
    s.stepAcc += moved;
    if (s.stepAcc > 1.15) {
      s.stepAcc = 0;
      this.sound.footstep({ x: s.pos.x, y: 0.1, z: s.pos.z }, true, 1, FOOTSTEP_RANGE);
    }
  }

  private pickPatrolRoom(here: number): number {
    const s = this.seeker;
    let best = here;
    let bs = -Infinity;
    for (const r of this.manor.rooms) {
      if (r.id === here) continue;
      const h = this.manor.rooms[here];
      const hops = Math.abs(r.col - h.col) + Math.abs(r.row - h.row);
      const score = Math.min(60, this.time - s.visited[r.id]) - hops * 6 + this.rand() * 25;
      if (score > bs) {
        bs = score;
        best = r.id;
      }
    }
    return best;
  }

  private investigate(x: number, z: number): void {
    const s = this.seeker;
    s.mode = 'investigate';
    s.lastSeen.set(x, 0, z);
    s.target = null;
    s.path = this.manor.planPath(s.pos.x, s.pos.z, x, z, SEEKER_RADIUS);
  }

  private goCheck(spot: HideSpot): void {
    const s = this.seeker;
    s.spot = spot;
    s.mode = 'search';
    s.path = this.manor.planPath(s.pos.x, s.pos.z, spot.front.x, spot.front.z, SEEKER_RADIUS);
  }

  // ======================================================== tagging / end
  private tag(k: Kid): void {
    if (k.caught) return;
    if (k.hidden) this.exitSpot(k, true);
    k.hiddenUnknown = false;
    k.caught = true;
    k.caughtT = this.time;
    k.vel.set(0, 0, 0);
    if (k.ai.spot && k.ai.spot.reserved === k) k.ai.spot.reserved = null;
    this.seeker.rig.swipe = 1;
    this.seeker.target = null;
    const mine = k.ctrl === 'local';
    const near = mine || this.amSeeker || k.pos.distanceTo((this.me as Kid).pos) < 14;
    this.sound.sting(near);
    if (mine) {
      this.shake = 0.6;
      this.hud.peek(null);
      this.hud.sneak(false);
      this.hud.message('You were found!', 2.5, true);
      this.camYaw = Math.atan2(this.seeker.pos.x - k.pos.x, this.seeker.pos.z - k.pos.z) + Math.PI;
    } else if (this.amSeeker) {
      this.shake = 0.25;
      this.hud.message(`Found ${k.name}!`, 2, true);
    } else this.hud.message(`${k.name} was found!`, 2);
    if (!this.online && this.kids.every((x) => x.caught)) this.endAt = this.time + 1.8;
  }

  private finish(hidersWin: boolean): void {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.sound.bell();
    this.hud.prompt(null);
    this.hud.peek(null);
    this.hud.blind(null);
    const meKid = this.amSeeker ? null : (this.me as Kid);
    this.onEnd({
      hidersWin,
      amSeeker: this.amSeeker,
      playerSurvived: meKid ? !meKid.caught : false,
      timeSurvived: meKid?.caught ? meKid.caughtT - this.huntStart : this.huntTime,
      roomsVisited: meKid ? meKid.rooms.size : this.seeker.visited.filter((v) => v > -999).length,
      found: this.kids.filter((k) => k.caught).length,
      total: this.kids.length,
    });
  }

  // ======================================================== presentation
  private updateLanterns(dt: number): void {
    const s = this.seeker;
    const hunting = this.phase === 'hunt';
    let nearest = 99;
    for (const k of this.kids) {
      const lit = k.lanternOn && !k.hidden && !k.hiddenUnknown && !k.caught;
      const d = Math.hypot(k.pos.x - s.pos.x, k.pos.z - s.pos.z);
      if (!k.caught) nearest = Math.min(nearest, d);
      const p = hunting ? clamp01(1 - (d - 2) / (FLICKER_RANGE - 2)) : 0;
      const f = lit ? flicker(this.time, k.seed, p) : 0;
      k.rig.light.intensity = 7 * f;
      k.rig.lanternMat.color.copy(LANTERN_COLOR).multiplyScalar(lit ? 0.3 + 4.7 * f : 0.12);
      if (k.ctrl === 'local' && lit) this.sputter(f, dt);
    }
    // the seeker's lantern shudders when a hider (even a hidden one) is close
    const p = hunting ? clamp01(1 - (nearest - 2) / (FLICKER_RANGE - 2)) : 0;
    const f = flicker(this.time, 77, p);
    const blind = this.phase === 'countdown' || this.phase === 'menu';
    s.rig.lanternLight.intensity = (blind ? 6 : 40) * f;
    s.rig.glowLight.intensity = (3 + Math.sin(this.time * 9) * 0.4) * f;
    s.rig.lanternMat.color.copy(LANTERN_COLOR).multiplyScalar(0.3 + 4.7 * f);
    if (this.amSeeker) this.sputter(f, dt);
  }

  private sputter(f: number, dt: number): void {
    this.sputterT -= dt;
    if (f < 0.2 && this.sputterT <= 0) {
      this.sound.sputter();
      this.sputterT = 0.35;
    }
  }

  private animateAll(dt: number): void {
    for (const k of this.kids) {
      const r = k.rig.root;
      if (k.caught) {
        const t = this.time - k.caughtT;
        const s = Math.max(0, 1 - Math.max(0, t - 0.6) * 2.5);
        r.visible = s > 0;
        r.scale.setScalar(s);
        r.position.set(k.pos.x, Math.min(0.6, t * 0.8), k.pos.z);
        r.rotation.y += dt * 10 * (1 - s);
        continue;
      }
      r.visible = !k.hidden && !k.hiddenUnknown;
      r.position.set(k.pos.x, 0, k.pos.z);
      r.rotation.y = k.yaw;
      animateKid(k.rig, dt, (Math.hypot(k.vel.x, k.vel.z) / HIDER_SPEED) * 2.2, k.sneaking, this.time + k.seed);
    }
    const s = this.seeker;
    s.rig.root.position.set(s.pos.x, 0, s.pos.z);
    s.rig.root.rotation.y = s.yaw;
    animateSeeker(s.rig, dt, s.speed, this.time, s.look);
    s.rig.lanternLight.target.position.set(Math.sin(this.time * 1.7) * 0.8, 0, 6);
    if (this.phase === 'countdown' || this.phase === 'menu') s.rig.arms[0].rotation.x = -2.3;
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const meKid = this.amSeeker ? null : (this.me as Kid);
    if (meKid?.hidden) {
      const s = meKid.hidden;
      const yaw = s.lookYaw + this.peekYaw;
      cam.position.lerp(s.peek, Math.min(1, dt * 10));
      tmp.set(cam.position.x + Math.sin(yaw) * Math.cos(this.camPitch), cam.position.y - Math.sin(this.camPitch), cam.position.z + Math.cos(yaw) * Math.cos(this.camPitch));
      cam.lookAt(tmp);
      cam.fov = THREE.MathUtils.lerp(cam.fov, 58, dt * 4);
      cam.updateProjectionMatrix();
      return;
    }
    let target: THREE.Vector3;
    let dist: number;
    if (meKid?.caught && this.time - meKid.caughtT > 1.5) {
      target = tmp2.set(this.seeker.pos.x, 1.6, this.seeker.pos.z);
      dist = 6;
    } else if (this.amSeeker) {
      target = tmp2.set(this.seeker.pos.x, 1.9, this.seeker.pos.z);
      dist = 4.6;
    } else {
      target = tmp2.set(meKid!.pos.x, 1.0, meKid!.pos.z);
      dist = Math.hypot(CAM_DIST, CAM_HEIGHT - 1);
    }
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dx = -Math.sin(this.camYaw) * cp, dy = sp, dz = -Math.cos(this.camYaw) * cp;
    let free = dist;
    for (let d = 0.3; d <= dist; d += 0.1) {
      const x = target.x + dx * d, y = target.y + dy * d, z = target.z + dz * d;
      if (y > WALL_H - 0.25 || this.manor.pointBlocked(x, z, 0.22)) {
        free = Math.max(0.3, d - 0.15);
        break;
      }
    }
    this.camDist = free < this.camDist ? free : THREE.MathUtils.lerp(this.camDist, free, Math.min(1, dt * 3));
    cam.position.set(target.x + dx * this.camDist, target.y + dy * this.camDist, target.z + dz * this.camDist);
    if (this.shake > 0) {
      this.shake -= dt;
      const a = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
    cam.lookAt(target.x, target.y + 0.25, target.z);
    const v = this.me.vel.length();
    const sneaking = meKid?.sneaking ?? false;
    cam.fov = THREE.MathUtils.lerp(cam.fov, !sneaking && v > 3.5 ? 68 : sneaking ? 60 : 64, dt * 4);
    cam.updateProjectionMatrix();
  }

  private menuCamera(): void {
    const c = this.manor.rooms[START_ROOM];
    const t = this.time * 0.08;
    this.camera.position.set(c.cx + Math.cos(t) * 5, 2.4, c.cz + 1 + Math.sin(t) * 5);
    this.camera.lookAt(c.cx, 1.0, c.cz + 1);
  }

  private updateAudio(dt: number): void {
    const cam = this.camera;
    const meKid = this.amSeeker ? null : (this.me as Kid);
    const listenerPos = !meKid || meKid.caught || meKid.hidden ? (this.amSeeker ? tmp.set(this.seeker.pos.x, 1.8, this.seeker.pos.z) : cam.position) : tmp.set(meKid.pos.x, 1, meKid.pos.z);
    cam.getWorldDirection(tmp2);
    this.sound.setListener(listenerPos, tmp2);

    if (!meKid || meKid.caught || this.phase !== 'hunt') {
      this.hud.danger(0);
      return;
    }
    const d = meKid.pos.distanceTo(this.seeker.pos);
    const danger = THREE.MathUtils.clamp((FOOTSTEP_RANGE - d) / FOOTSTEP_RANGE, 0, 1);
    this.hud.danger(danger * danger);
    if (d < 7) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.sound.heartbeat(1 - d / 7);
        this.heartT = 0.45 + (d / 7) * 0.6;
      }
    }
  }
}

const HIDE_LABEL: Record<HideSpot['kind'], string> = {
  wardrobe: 'in wardrobe',
  table: 'under table',
  chest: 'in chest',
  curtain: 'behind curtain',
  bed: 'under bed',
};
const SEARCH_LABEL: Record<HideSpot['kind'], string> = {
  wardrobe: 'wardrobe',
  table: 'under table',
  chest: 'chest',
  curtain: 'curtain',
  bed: 'under bed',
};

function segAabb(ax: number, az: number, bx: number, bz: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [a, d, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (a < lo || a > hi) return false;
    } else {
      let ta = (lo - a) / d, tb = (hi - a) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}
