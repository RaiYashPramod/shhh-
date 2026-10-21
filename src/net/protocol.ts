// Messages shared by client and server. Kept tiny: JSON over one WebSocket.

export interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
}

// Per-player state, sent by each client ~20x/s and relayed in snapshots.
// h: hide spot id, -1 = not hidden, -2 = hidden (spot withheld from the seeker)
export type PlayerState = [x: number, z: number, yaw: number, sneak: 0 | 1, h: number, lantern: 0 | 1];

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'start' }
  | { t: 'leave' }
  | { t: 'st'; s: PlayerState }
  | { t: 'door'; id: number; open: boolean }
  | { t: 'tag'; id: string }
  | { t: 'check'; spot: number };

export type ServerMsg =
  | { t: 'error'; msg: string }
  | { t: 'room'; code: string; you: string; hostId: string; players: LobbyPlayer[]; inGame: boolean }
  | { t: 'start'; seed: number; seekerId: string; players: LobbyPlayer[]; countdown: number; round: number }
  | { t: 'snap'; p: Record<string, PlayerState> }
  | { t: 'door'; id: number; open: boolean }
  | { t: 'caught'; id: string }
  | { t: 'checked'; spot: number; found: boolean }
  | { t: 'hunt' }
  | { t: 'end'; hidersWin: boolean }
  | { t: 'left'; id: string };
