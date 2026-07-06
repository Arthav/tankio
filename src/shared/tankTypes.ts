export const STAT_KEYS = [
  'healthRegen',
  'maxHealth',
  'bodyDamage',
  'bulletSpeed',
  'bulletPenetration',
  'bulletDamage',
  'reload',
  'movementSpeed',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type ProjectileKind = 'bullet' | 'trap' | 'drone' | 'minion' | 'missile';

export type TankAbility =
  | 'auto-turret'
  | 'drone-control'
  | 'trap-launcher'
  | 'invisibility'
  | 'predator-focus'
  | 'rammer'
  | 'factory-minions'
  | 'burst-fire'
  | 'auto-spin-friendly';

export interface ProjectileProfile {
  kind: ProjectileKind;
  speed: number;
  damage: number;
  penetration: number;
  radius: number;
  lifetimeMs: number;
  turnRate?: number;
  dampingAfterMs?: number;
  splitCount?: number;
}

export interface WeaponMount {
  id: string;
  angleDeg: number;
  reloadMs: number;
  projectile: ProjectileProfile;
  length: number;
  width: number;
  offset: number;
  spreadDeg?: number;
  recoil?: number;
  damageScale?: number;
  speedScale?: number;
  sizeScale?: number;
  lifetimeScale?: number;
  autoAim?: boolean;
  altFire?: boolean;
  staggerMs?: number;
}

export interface TankClassDefinition {
  id: string;
  displayName: string;
  tier: 1 | 2 | 3 | 4;
  unlockLevel: 1 | 15 | 30 | 45;
  parents: string[];
  requiresSkippedUpgrade?: boolean;
  weaponLayout: WeaponMount[];
  abilities: TankAbility[];
  tags: string[];
  statCaps?: Partial<Record<StatKey, number>>;
  maxDrones?: number;
  fovMultiplier?: number;
  bodyRadius?: number;
  bodyShape?: 'circle' | 'square' | 'spiked' | 'hex';
}

export interface UpgradeEdge {
  fromTankId: string;
  toTankId: string;
  requiredLevel: 15 | 30 | 45;
  requiresSkippedUpgrade: boolean;
}

export type StatAllocation = Record<StatKey, number>;

export const DEFAULT_STAT_CAPS: Record<StatKey, number> = {
  healthRegen: 7,
  maxHealth: 7,
  bodyDamage: 7,
  bulletSpeed: 7,
  bulletPenetration: 7,
  bulletDamage: 7,
  reload: 7,
  movementSpeed: 7,
};

export const BODY_ONLY_SMASHER_CAPS: Partial<Record<StatKey, number>> = {
  healthRegen: 10,
  maxHealth: 10,
  bodyDamage: 10,
  bulletSpeed: 0,
  bulletPenetration: 0,
  bulletDamage: 0,
  reload: 0,
  movementSpeed: 10,
};

export const ALL_TEN_STAT_CAPS: Partial<Record<StatKey, number>> = {
  healthRegen: 10,
  maxHealth: 10,
  bodyDamage: 10,
  bulletSpeed: 10,
  bulletPenetration: 10,
  bulletDamage: 10,
  reload: 10,
  movementSpeed: 10,
};
