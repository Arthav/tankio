import type { StatAllocation, StatKey } from './tankTypes';

export interface ClientInputPayload {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  altFire: boolean;
  autoFire: boolean;
  autoSpin: boolean;
}

export type ClientMessage =
  | {
      type: 'join';
      token?: string;
      name: string;
      mode: 'online' | 'bots';
    }
  | {
      type: 'input';
      input: ClientInputPayload;
    }
  | {
      type: 'retry';
    }
  | {
      type: 'upgradeStat';
      stat: StatKey;
    }
  | {
      type: 'upgradeTank';
      tankId: string;
    };

export interface ProfileDto {
  id: string;
  displayName: string;
  profileXp: number;
  bodyColor: string;
  accentColor: string;
  achievements: string[];
  customBranchUnlocks: string[];
}

export interface SnapshotTank {
  id: string;
  name: string;
  tankId: string;
  bot: boolean;
  x: number;
  y: number;
  aim: number;
  radius: number;
  health: number;
  maxHealth: number;
  level: number;
  score: number;
  color: string;
  invisible: boolean;
  kills: number;
  deaths: number;
}

export interface SnapshotProjectile {
  id: string;
  ownerId: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

export interface SnapshotShape {
  id: string;
  shape: 'square' | 'triangle' | 'pentagon' | 'alpha_pentagon';
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  rotation: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  level: number;
  tankId: string;
  bot: boolean;
}

export interface PlayerSelfState {
  id: string;
  tankId: string;
  level: number;
  xp: number;
  score: number;
  stats: StatAllocation;
  availableStatPoints: number;
  upgradeOptions: string[];
  alive: boolean;
  respawnMs: number;
  sessionXp: number;
}

export interface GameSnapshot {
  type: 'snapshot';
  roomId: string;
  selfId: string;
  now: number;
  world: {
    width: number;
    height: number;
  };
  self: PlayerSelfState;
  players: SnapshotTank[];
  projectiles: SnapshotProjectile[];
  shapes: SnapshotShape[];
  leaderboard: LeaderboardEntry[];
}

export type ServerMessage =
  | {
      type: 'welcome';
      playerId: string;
      roomId: string;
      profile: ProfileDto;
      token: string;
    }
  | {
      type: 'profile';
      profile: ProfileDto;
      token: string;
    }
  | GameSnapshot
  | {
      type: 'error';
      message: string;
    };
