// Gameplay + world constants. Numbers come from pitch.md unless noted.

export const ROOM = 20;
export const COLS = 3;
export const ROWS = 2;
export const WORLD_W = ROOM * COLS; // 60
export const WORLD_D = ROOM * ROWS; // 40
export const WALL_T = 0.4;
export const WALL_H = 4.2;
export const DOOR_W = 2.4;
export const DOOR_H = 3.0;

export const HIDER_SPEED = 5;
export const SNEAK_SPEED = 2.5;
export const SEEKER_SPEED = 5.5;
export const SEEKER_WALK = 3.4;

export const KID_RADIUS = 0.35;
export const SEEKER_RADIUS = 0.45;

export const COUNTDOWN = 20;
export const ROUND_TIME = 300;
export const FOOTSTEP_RANGE = 12;
export const TAG_RANGE = 1.3;
export const BOT_HIDERS = 3;

export const CAM_DIST = 4;
export const CAM_HEIGHT = 2.5;

export const PAL = {
  wood: 0x5b3a29,
  purple: 0x4a2a6b,
  orange: 0xf28c1c,
  cream: 0xe8e0cf,
  night: 0x2b1d3a,
  green: 0x7ec850,
} as const;

export type RoomType = 'library' | 'kitchen' | 'ballroom' | 'nursery' | 'cellar' | 'greenhouse';

// grid[row][col]; row 0 spans z 0..20
export const ROOM_GRID: RoomType[][] = [
  ['library', 'kitchen', 'ballroom'],
  ['nursery', 'cellar', 'greenhouse'],
];

export const START_ROOM = 2; // ballroom

export type Quality = 'low' | 'medium' | 'high';

export const QUALITY: Record<Quality, { pixelRatio: number; shadows: boolean; shadowSize: number; bloom: boolean; smaa: boolean }> = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, bloom: true, smaa: false },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 512, bloom: true, smaa: true },
  high: { pixelRatio: 2, shadows: true, shadowSize: 1024, bloom: true, smaa: true },
};

// ---------- multiplayer ----------
export const MAX_PLAYERS = 8;
export const NET_HZ = 20;
export const HIDER_COLORS = [0xf28c1c, 0xe8e0cf, 0x9b7bc8, 0x7ec850, 0x5fb3d9, 0xe86a8a, 0xd9c45f, 0x8a6a4a];

// ---------- lanterns ----------
export const LANTERN_RANGE = 8; // hider lantern light reach
export const FLICKER_RANGE = 14; // lanterns start to flicker when the other side is this close
