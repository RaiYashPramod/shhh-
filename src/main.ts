import './style.css';
import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { Sound } from './audio';
import { QUALITY, Quality } from './config';
import { Game, GameSetup, RoundResult } from './game';
import { Hud } from './hud';
import { Input } from './input';
import { Net } from './net/client';
import type { LobbyPlayer, ServerMsg } from './net/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const debug = new URLSearchParams(location.search).has('debug');

// ---------------- renderer + post ----------------
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance', antialias: false, stencil: false, depth: false });
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030205);
// pitch black manor: only lanterns and moonlit windows give light
scene.fog = new THREE.Fog(0x050308, 7, 26);
scene.add(new THREE.HemisphereLight(0x3a2a60, 0x0a0610, 0.12));

const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.05, 80);

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ luminanceThreshold: 0.85, luminanceSmoothing: 0.25, mipmapBlur: true, intensity: 1.3, radius: 0.75 });
const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.7 });
composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), vignette));
const smaaPass = new EffectPass(camera, new SMAAEffect());
composer.addPass(smaaPass);

let quality: Quality = (storeGet('quality') as Quality) || 'high';
let pixelRatio = 1;
function applyQuality(): void {
  const q = QUALITY[quality];
  pixelRatio = Math.min(devicePixelRatio, q.pixelRatio);
  renderer.setPixelRatio(pixelRatio);
  smaaPass.enabled = q.smaa;
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }
  resize();
}
function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------- state ----------------
type State = 'menu' | 'lobby' | 'playing' | 'paused' | 'ended';
const sound = new Sound();
const input = new Input(canvas);
const hud = new Hud();
const net = new Net();
let game: Game;
let state: State = 'menu';
let online = false;
let soloRole: 'hide' | 'seek' = 'hide';
let room: { code: string; you: string; hostId: string; players: LobbyPlayer[] } | null = null;

function shadows() {
  const q = QUALITY[quality];
  return { enabled: q.shadows, size: q.shadowSize };
}

function setGame(setup: GameSetup): void {
  if (game) game.dispose(scene);
  game = new Game(scene, camera, sound, input, hud, setup);
  game.onEnd = showEnd;
  if (debug) (window as unknown as { __game: Game }).__game = game;
}

function soloSetup(): GameSetup {
  const me = { id: 'me', name: myName(), color: 0xf28c1c };
  return {
    mode: 'solo',
    seed: (Math.random() * 1e9) | 0,
    myId: me.id,
    seekerId: soloRole === 'seek' ? me.id : 'ai',
    players: [me],
    bots: soloRole === 'seek' ? 4 : 3,
    shadows: shadows(),
    net: null,
  };
}

function showScreen(id: string | null): void {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
}

function enterPlay(): void {
  state = 'playing';
  showScreen(null);
  input.lock();
  // pointer lock needs a fresh click if the round started from a network message
  setTimeout(() => {
    if (state === 'playing' && !input.locked && !debug) {
      state = 'paused';
      $('pause-title').textContent = 'The round has started!';
      showScreen('pause');
    }
  }, 400);
}

function playSolo(role: 'hide' | 'seek'): void {
  sound.unlock();
  online = false;
  soloRole = role;
  applyQuality();
  setGame(soloSetup());
  game.start();
  enterPlay();
}

function showEnd(r: RoundResult): void {
  state = 'ended';
  input.unlock();
  hud.show(false);
  const won = r.amSeeker ? !r.hidersWin : r.hidersWin;
  $('end-title').textContent = won ? 'You win!' : r.hidersWin ? 'Hiders win' : 'The Seeker wins';
  $('end-sub').textContent = r.amSeeker
    ? r.hidersWin
      ? 'Some kids outlasted the clock. They are still in there… somewhere.'
      : 'You found every last one. The manor falls silent.'
    : r.hidersWin
      ? r.playerSurvived
        ? 'You outlasted the clock. The pumpkin goes home hungry.'
        : 'You were found, but your friends held out.'
      : 'Every kid was found. The manor falls silent…';
  const t = Math.max(0, Math.round(r.timeSurvived));
  $('end-stats').innerHTML = `
    <div><b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b><span>${r.amSeeker ? 'hunt time' : 'survived'}</span></div>
    <div><b>${r.roomsVisited}/6</b><span>rooms explored</span></div>
    <div><b>${r.found}/${r.total}</b><span>kids found</span></div>`;
  $('again').textContent = online ? 'Back to lobby' : 'Play again';
  $('to-menu').style.display = online ? 'none' : '';
  showScreen('end');
}

// ---------------- online ----------------
function renderLobby(): void {
  if (!room) return;
  $('lobby-code').textContent = room.code;
  const host = room.hostId === room.you;
  $('lobby-players').innerHTML = room.players
    .map(
      (p) =>
        `<li style="--c:#${p.color.toString(16).padStart(6, '0')}"><span class="dot"></span>${escapeHtml(p.name)}${p.id === room!.you ? ' <em>(you)</em>' : ''}${p.id === room!.hostId ? ' <small>host</small>' : ''}</li>`,
    )
    .join('');
  const start = $<HTMLButtonElement>('start');
  start.style.display = host ? '' : 'none';
  start.disabled = room.players.length < 2;
  $('lobby-wait').textContent = host
    ? room.players.length < 2
      ? 'Invite at least one friend to start.'
      : 'Everyone in? One random player becomes the Seeker.'
    : 'Waiting for the host to start…';
}

function onNet(m: ServerMsg): void {
  switch (m.t) {
    case 'error':
      $('menu-error').textContent = m.msg;
      break;
    case 'room':
      room = { code: m.code, you: m.you, hostId: m.hostId, players: m.players };
      history.replaceState(null, '', `?room=${m.code}`);
      renderLobby();
      if (state === 'menu') {
        state = 'lobby';
        showScreen('lobby');
      }
      break;
    case 'start':
      sound.unlock();
      online = true;
      applyQuality();
      setGame({ mode: 'online', seed: m.seed, myId: room!.you, seekerId: m.seekerId, players: m.players, bots: 0, shadows: shadows(), net });
      game.start();
      enterPlay();
      break;
    case 'snap':
      if (online) game.applySnapshot(m.p);
      break;
    case 'door':
      if (online) game.remoteDoor(m.id, m.open);
      break;
    case 'caught':
      if (online) game.remoteCaught(m.id);
      break;
    case 'checked':
      if (online) game.remoteChecked(m.found);
      break;
    case 'hunt':
      if (online) game.remoteHunt();
      break;
    case 'end':
      if (online) game.remoteEnd(m.hidersWin);
      break;
    case 'left':
      if (online) game.remoteLeft(m.id);
      break;
  }
}
net.on(onNet);
net.onClose = () => {
  if (state === 'menu') return;
  if (online || state === 'lobby') {
    online = false;
    room = null;
    input.unlock();
    hud.show(false);
    state = 'menu';
    $('menu-error').textContent = 'Disconnected from the server.';
    setGame(soloSetup());
    showScreen('menu');
  }
};

async function connectAnd(msg: () => void): Promise<void> {
  $('menu-error').textContent = '';
  sound.unlock();
  try {
    await net.connect();
    msg();
  } catch (e) {
    $('menu-error').textContent = (e as Error).message + ' Is it running? (npm run dev)';
  }
}

function myName(): string {
  return ($<HTMLInputElement>('name').value.trim() || 'Kid').slice(0, 14);
}

// ---------------- UI wiring ----------------
const nameEl = $<HTMLInputElement>('name');
nameEl.value = storeGet('name') ?? '';
nameEl.addEventListener('change', () => storeSet('name', nameEl.value.trim()));
const codeEl = $<HTMLInputElement>('code');
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) codeEl.value = urlRoom.toUpperCase();

$('solo-hide').addEventListener('click', () => playSolo('hide'));
$('solo-seek').addEventListener('click', () => playSolo('seek'));
$('create').addEventListener('click', () => connectAnd(() => net.send({ t: 'create', name: myName() })));
$('join').addEventListener('click', () => {
  const code = codeEl.value.trim().toUpperCase();
  if (code.length !== 4) {
    $('menu-error').textContent = 'Room codes are 4 letters.';
    return;
  }
  connectAnd(() => net.send({ t: 'join', code, name: myName() }));
});
codeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('join').click();
});
$('start').addEventListener('click', () => net.send({ t: 'start' }));
$('leave').addEventListener('click', () => {
  net.send({ t: 'leave' });
  room = null;
  state = 'menu';
  history.replaceState(null, '', location.pathname);
  showScreen('menu');
});
$('invite').addEventListener('click', async () => {
  if (!room) return;
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $('invite').textContent = 'Link copied!';
  } catch {
    $('invite').textContent = link;
  }
  setTimeout(() => ($('invite').textContent = 'Copy invite link'), 2000);
});
$('again').addEventListener('click', () => {
  if (online) {
    online = false;
    state = 'lobby';
    renderLobby();
    showScreen('lobby');
  } else playSolo(soloRole);
});
$('to-menu').addEventListener('click', () => {
  state = 'menu';
  setGame(soloSetup());
  showScreen('menu');
});
$('resume').addEventListener('click', () => {
  state = 'playing';
  showScreen(null);
  input.lock();
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !debug) {
    state = 'paused';
    $('pause-title').textContent = online ? 'Paused (the round goes on!)' : 'Paused';
    showScreen('pause');
  }
});
canvas.addEventListener('click', () => {
  if (state === 'playing') input.lock();
});

const qualitySel = $<HTMLSelectElement>('quality');
qualitySel.value = quality;
qualitySel.addEventListener('change', () => {
  quality = qualitySel.value as Quality;
  storeSet('quality', quality);
  applyQuality();
});
const volume = $<HTMLInputElement>('volume');
volume.addEventListener('input', () => sound.setVolume(Number(volume.value)));
const sens = $<HTMLInputElement>('sens');
sens.addEventListener('input', () => (input.sensitivity = Number(sens.value) * 0.0001));

// ---------------- loop ----------------
const statsEl = $('stats');
statsEl.style.display = debug ? 'block' : 'none';
let last = performance.now();
let slowT = 0;
let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw);

  // online rounds keep running while paused: the world does not wait for you
  const running = state === 'playing' || state === 'menu' || state === 'lobby' || state === 'ended' || (state === 'paused' && online);
  if (running) game.update(state === 'ended' ? dt * 0.3 : dt);
  input.endFrame();

  renderer.info.reset();
  composer.render(dt);

  if (state === 'playing') {
    slowT = raw > 0.022 ? slowT + raw : Math.max(0, slowT - raw * 0.5);
    if (slowT > 2 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
      slowT = 0;
    }
  }
  if (debug) {
    fpsAcc += raw;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      fpsShown = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    const i = renderer.info;
    statsEl.textContent = `${fpsShown.toFixed(0)} fps · ${i.render.calls} calls · ${(i.render.triangles / 1000).toFixed(0)}k tris · pr ${pixelRatio}`;
  }
}

function storeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// boot
applyQuality();
setGame(soloSetup());
$('loading').classList.add('done');
showScreen('menu');
if (urlRoom) codeEl.focus();
requestAnimationFrame(frame);
