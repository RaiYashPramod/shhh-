# Hollow Manor Hide & Seek — Build Plan

Source: `pitch.md` + concept art (manor interior, asset sheet: ghost kid, pumpkin seeker, floor, wall, wardrobe, pumpkin, door).
Goal: browser game, playable in < 3 s on mid laptop, 60 fps, toon low-poly look matching the art.

---

## 1. Tech stack (lightweight)

| Layer | Pick | Why / size (gzip) |
|---|---|---|
| Build | **Vite + TypeScript**, no UI framework | fast dev, tree-shaking, code-split. 0 KB runtime |
| Render | **Three.js** (tree-shaken imports only) | ~120–150 KB. Toon material, fog, instancing, glTF built in. Babylon/PlayCanvas 2–4× heavier |
| Toon look | `MeshToonMaterial` + 3-step gradient map + **inverted-hull outlines** | outlines without post-process pass (cheap, mobile-safe) |
| Models | glTF `.glb`, **meshopt** compressed + quantized via `gltf-transform` | meshopt decoder ~10 KB vs Draco ~300 KB wasm |
| Textures | one **palette atlas** (256×256 WebP) for most props + 2 tiling WebP (floor, wallpaper, 512²) | flat toon colors → UVs point at palette swatches, tiny |
| Physics | **none** — custom 2D circle-vs-AABB on XZ plane | no jump, flat floors. Rapier wasm ~1 MB not needed |
| Audio | **raw Web Audio API**, `PannerNode` (HRTF) + one audio sprite (`.webm` Opus, `.m4a` fallback) | footsteps are core mechanic → need precise spatial gain, no lib |
| UI/HUD | plain DOM + CSS overlay (timer, prompts, peek vignette, menus) | zero cost, crisp text |
| Netcode | **PartyKit / Cloudflare Durable Objects**, raw WebSocket, binary msgs | one room = one DO instance, global edge, no server ops. Alt: Colyseus on Fly.io |
| Bots | simple FSM AI (seeker + hiders) | solo play, fill empty lobbies, dev testing |
| Hosting | static on Cloudflare Pages (same platform as DO) | CDN, brotli, HTTP/2 |

**Load budget**
- JS (engine + game): ≤ 250 KB gz
- Models (all 7 assets + room dressing): ≤ 600 KB
- Textures: ≤ 300 KB
- Audio sprite: ≤ 400 KB (lazy-load after menu shows)
- Total first play ≤ ~1.5 MB. Menu interactive ≤ 1.5 s, game ready ≤ 3 s on 4G.

---

## 2. Rendering & "game feel" tricks (cheap but pretty)

- **Lighting**: no per-candle real lights (forward renderer dies with 40 point lights).
  - Bake candle/pumpkin warm glow into **vertex colors / lightmap** per room in Blender.
  - Only **2–4 real lights**: player lantern (PointLight), seeker lantern (SpotLight, swept), dim purple hemisphere, moonlight directional through windows.
  - Candle flames = additive billboard sprites w/ shader flicker. Fake bloom = soft glow sprite, no post-processing.
- **Fog**: `scene.fog = Fog(#2b1d3a, 15, 35)` → purple haze from 15 units (per pitch), also hides far geometry.
- **Shadows**: off. Blob shadow decal under characters/props (matches art sheet).
- **Room culling**: 3×2 grid → render only current room + rooms visible through open doors (simple portal check). Cuts draw calls ~60%.
- **Batching**: merge static geometry per room (1–3 draw calls/room), `InstancedMesh` for repeated props (candles, books, pumpkins, cobwebs).
- **Pixel ratio** capped at 1.5; dynamic resolution drop if frame time > 20 ms.
- **Animation**: ghost kid = **no skeleton**, procedural bob/squash/lean (cloth sheet sells it). Seeker = small rig, 4 clips (idle, walk, search-look, swipe).
- **Juice**: camera shake on tag, FOV push on run, door swing tween w/ overshoot, lantern sway, light flicker scaling with kids tagged, peek vignette (CSS mask) when hidden, heartbeat audio when seeker < 6 units.

---

## 3. Game architecture

```
src/
  main.ts            boot, loader, menu
  core/loop.ts       fixed 60 Hz sim + rAF render, interpolation
  core/input.ts      WASD, pointer lock mouse, Shift, E, click
  world/manor.ts     builds 3×2 room grid, doors, walls, props from level JSON
  world/collision.ts XZ circle-vs-AABB, door state aware
  world/culling.ts   room/portal visibility
  actors/hider.ts    move/sneak/hide/spectate
  actors/seeker.ts   move/lantern/tag
  actors/bot.ts      FSM AI (seeker patrol+investigate, hider flee+hide)
  audio/audio.ts     Web Audio graph, spatial footsteps, loudness rules
  net/client.ts      ws, snapshot buffer, interpolation
  ui/hud.ts          DOM overlay
  render/toon.ts     toon materials, outline hull, glow sprites
server/room.ts       PartyKit/DO: lobby, roles, timer, tag validation
public/assets/       .glb, .webp, audio sprite
level/manor.json     room types, door links, prop spawns, hide spots
```

Level data-driven (JSON) → reshuffle prop/hide-spot layouts per round for replay value.

### Core rules (from pitch)
- Speeds: hider 5, seeker 5.5, sneak 2.5 u/s. Third-person cam 4 back, 2.5 up, collision-pulled in tight rooms.
- Footstep loudness: run = loud (heard far), sneak = silent. Seeker steps audible ≤ 12 units, gain ramps with distance.
- Hide spots: wardrobe / under table → E to enter, camera to peek view, can't move; seeker E on spot = found.
- Tag: seeker click, range ~1.5 u, server-validated.
- Round: 20 s blind countdown → 5 min hunt → results. Tagged → spectator cam.

### Netcode
- Movement client-authoritative w/ server speed/position sanity clamp (casual game, simpler, zero input lag).
- Clients send state 20 Hz; server broadcasts snapshots 20 Hz; clients render 100 ms behind w/ interpolation.
- Server authoritative: roles, timer, tags, hide-spot occupancy, round end.
- Interest management: seeker client does **not** receive hider positions outside current/adjacent room or inside hide spots (stops wallhack-cheat).
- 2–8 players/lobby, room codes + quick-play. Bots fill to min 4.

---

## 4. Asset pipeline

- [ ] Model 7 hero assets (from art sheet) low-poly in Blender (or AI 3D gen → retopo/decimate), target tris: kid 1.5k, seeker 3k, props 200–800.
- [ ] UV everything onto shared palette atlas (palette from pitch: `#5b3a29 #4a2a6b #f28c1c #e8e0cf #2b1d3a #7ec850`).
- [ ] Room dressing kit: bookshelf, table, candle, cobweb card, pots, cauldron, window, plants (greenhouse), crates (cellar), crib (nursery).
- [ ] Bake per-room candle light → vertex colors.
- [ ] `gltf-transform optimize --compress meshopt --texture-compress webp` in npm script.
- [ ] Audio: footsteps (wood ×4 var, seeker heavy boots ×4), door creak, wardrobe close, tag sting, ambience loop, heartbeat, countdown. One sprite.

---

## 5. Milestones

### M0 — Skeleton (day 1)
- [ ] Vite + TS project, Three.js, fixed-step loop, pointer-lock input
- [ ] Graybox 3×2 manor from JSON, door gaps, collision
- [ ] Third-person camera w/ wall pull-in
- [ ] Perf HUD (fps, draw calls) dev-only

### M1 — Solo vertical slice vs bot seeker (week 1)
- [ ] Hider movement, sneak, door open/close, hide spots + peek view
- [ ] Bot seeker FSM: patrol rooms → hear loud steps → investigate → check hide spots
- [ ] Spatial footsteps + 12-unit warning ramp + heartbeat
- [ ] Round flow: countdown, timer, win/lose screens
- [ ] **Playtest: is tension fun with just audio?** (key risk — validate before art)

### M2 — Look & feel (week 2)
- [ ] Toon material + outlines, palette atlas, final hero models
- [ ] All 6 rooms dressed, baked glow, fog, sky/moon through windows
- [ ] Candle sprites, lantern lights, flicker escalation, juice list above
- [ ] Hit load + fps budgets (measure w/ Lighthouse + Chrome perf trace)

### M3 — Multiplayer (week 3)
- [ ] PartyKit/DO room: lobby, codes, role assignment, timer, tag validation
- [ ] Snapshot interpolation, interest management
- [ ] Spectator cam, bot backfill, reconnect
- [ ] Play as seeker (lantern sweep, swipe)

### M4 — Polish & ship (week 4)
- [ ] Mobile/touch fallback? (decide — pitch assumes mouse+keyboard)
- [ ] Settings (sensitivity, volume, quality), audio unlock on first click
- [ ] Error/disconnect states, loading screen w/ progress
- [ ] Deploy Cloudflare Pages + DO, cache headers, brotli

---

## 6. Open decisions (need user call)

1. **Multiplayer at launch or solo-vs-bot first?** Plan assumes solo slice first (M1), MP in M3.
2. **Backend**: PartyKit/Cloudflare (recommended) vs self-hosted Colyseus.
3. **3D assets source**: hand-model in Blender vs AI 3D gen + cleanup vs commissioned.
4. **Mobile support**: in scope or desktop-only?

---

## Progress — 2026-10-21 (session 1)

Visual upgrade adopted: `postprocessing` (bloom + ACES tone map + vignette + SMAA), seeker lantern real shadows, Low/Med/High quality, adaptive pixel ratio.

Built (code done, typecheck + prod build pass, **not yet verified in browser**):
- [x] Vite + TS + Three 0.186 + postprocessing 6.39 scaffold
- [x] Manor: 3×2 rooms from grid, walls w/ wainscot, 7 swing doors, windows w/ painted moon sky, chandeliers, cobwebs, themed furniture shuffled per round, static batching (1 draw call per material)
- [x] Procedural toon assets matching art sheet (ghost kid, pumpkin seeker, wardrobe, pumpkins, door, floor/wallpaper textures). Zero asset downloads
- [x] Inverted-hull outlines, instanced flickering candle flames, flicker escalates as kids found
- [x] Player: WASD/mouse/Shift sneak/E doors + hide (wardrobe/table peek view)
- [x] Seeker AI: blind countdown → patrol/search hide spots → hear noise → investigate → chase/tag
- [x] 3 bot hiders: scatter, hide, sneak near seeker, flee when chased
- [x] Synthesized spatial audio: heavy boots (12u range), creaks, sting, heartbeat, bell, ambience
- [x] HUD: clock, kid list, prompts, danger edge glow, peek overlay; menu/pause/end screens
- Bundle: 230 KB gzip JS total

## Progress — session 2: multiplayer + darkness

- [x] Node `ws` room server (`server/index.ts`): create/join by 4-letter code, invite link `?room=CODE`, host starts (≥2), random Seeker, server clock (20 s + 300 s), tag/search validation, door relay, 20 Hz snapshots, hidden spot withheld from Seeker (coarse position only). Also serves `dist/` → one-process deploy
- [x] Protocol test (2 scripted clients): all checks pass
- [x] Human Seeker: blind countdown screen, click = grab, E = search spot, doors
- [x] Solo modes: Hide vs AI Seeker, Seek vs 4 bots
- [x] Pitch-black manor: no room lights/candle flames; light = lanterns + dim moonlit windows + faint pumpkin faces
- [x] Every hider has a lantern (F toggles; off = stealthier but blind)
- [x] Flicker tell: hider lantern flickers as Seeker nears; Seeker lantern flickers when any hider (even hidden) is near; sputter sound
- [x] New hiding spots: chest + curtains every room, bed in nursery (12 → 25 spots)
- [x] Browser verification in Chrome (session 3):
  - fixed: ghost lathe wound inside-out (dark body, glowing rim) → profile now bottom→top
  - fixed: server accepted tag/search during blind countdown → `hunting` flag
  - verified: 55–60 fps @ 2× pixel ratio, ~150–330 draw calls; solo hide/chest peek; 25 spots; flicker scales with distance; 2-tab lobby → start → roles → same manor hash → hide → wrong/right search → end screens
  - `?debug` adds fps overlay, `window.__game`, and no pause when pointer lock is unavailable

Next:
- [ ] Browser verification + visual tuning (lantern brightness, darkness level, bloom)
- [ ] Playtest balance (seeker speed, sight cone, hearing radius)
- [ ] M3 multiplayer

## Review
_(fill after build)_
