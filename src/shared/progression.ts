import {
  DEFAULT_STAT_CAPS,
  STAT_KEYS,
  type StatAllocation,
  type StatKey,
  type TankClassDefinition,
  type UpgradeEdge,
} from './tankTypes';
import { getTankClass, TANK_CLASSES } from './tanks';

export const MAX_LEVEL = 45;

export const DEFAULT_STATS: StatAllocation = {
  healthRegen: 0,
  maxHealth: 0,
  bodyDamage: 0,
  bulletSpeed: 0,
  bulletPenetration: 0,
  bulletDamage: 0,
  reload: 0,
  movementSpeed: 0,
};

export const STAT_GAINS: Record<StatKey, number> = {
  healthRegen: 2.6,
  maxHealth: 24,
  bodyDamage: 10.5,
  bulletSpeed: 0.09,
  bulletPenetration: 0.14,
  bulletDamage: 0.13,
  reload: 0.13,
  movementSpeed: 18,
};

export const STAT_GAIN_LABELS: Record<StatKey, string> = {
  healthRegen: '+2.6/s',
  maxHealth: '+24 HP',
  bodyDamage: '+10.5 body',
  bulletSpeed: '+9% speed',
  bulletPenetration: '+14% pierce',
  bulletDamage: '+13% dmg',
  reload: '+13% fire',
  movementSpeed: '+18 move',
};

export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let current = 2; current <= level; current += 1) {
    total += Math.floor(32 + current * current * 7.5 + current * 18);
  }
  return total;
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function totalStatPointsForLevel(level: number): number {
  if (level < 2) return 0;
  if (level <= 28) return level - 1;
  if (level < 30) return 27;
  return Math.min(33, 27 + Math.floor((level - 30) / 3) + 1);
}

export function spentStatPoints(stats: StatAllocation): number {
  return STAT_KEYS.reduce((sum, key) => sum + stats[key], 0);
}

export function availableStatPoints(level: number, stats: StatAllocation): number {
  return Math.max(0, totalStatPointsForLevel(level) - spentStatPoints(stats));
}

export function statCapsForTank(tankId: string): Record<StatKey, number> {
  const tankClass = getTankClass(tankId);
  return {
    ...DEFAULT_STAT_CAPS,
    ...(tankClass.statCaps ?? {}),
  };
}

export function canAllocateStat(tankId: string, stats: StatAllocation, key: StatKey): boolean {
  const caps = statCapsForTank(tankId);
  return stats[key] < caps[key];
}

export function upgradeEdges(): UpgradeEdge[] {
  return TANK_CLASSES.flatMap((tankClass) =>
    tankClass.parents.map((parentId) => ({
      fromTankId: parentId,
      toTankId: tankClass.id,
      requiredLevel: tankClass.unlockLevel as 15 | 30 | 45,
      requiresSkippedUpgrade: tankClass.requiresSkippedUpgrade ?? false,
    })),
  );
}

export function upgradeOptions(currentTankId: string, level: number): TankClassDefinition[] {
  return TANK_CLASSES.filter((tankClass) => tankClass.parents.includes(currentTankId) && level >= tankClass.unlockLevel);
}

export function canUpgradeTank(currentTankId: string, targetTankId: string, level: number): boolean {
  return upgradeOptions(currentTankId, level).some((tankClass) => tankClass.id === targetTankId);
}

export interface DerivedTankStats {
  maxHealth: number;
  moveSpeed: number;
  bodyDamage: number;
  regenPerSecond: number;
  reloadMultiplier: number;
  bulletSpeedMultiplier: number;
  bulletDamageMultiplier: number;
  bulletPenetrationMultiplier: number;
  radius: number;
  fovMultiplier: number;
}

export function deriveTankStats(tankId: string, level: number, stats: StatAllocation): DerivedTankStats {
  const tankClass = getTankClass(tankId);
  const rammerBonus = tankClass.tags.includes('rammer') ? 1.35 : 1;
  const spikeBonus = tankId === 'spike' ? 1.35 : 1;
  return {
    maxHealth: 100 + level * 2.2 + stats.maxHealth * STAT_GAINS.maxHealth,
    moveSpeed:
      (220 + stats.movementSpeed * STAT_GAINS.movementSpeed - Math.max(0, level - 1) * 0.8) *
      (tankClass.tags.includes('heavy') ? 0.92 : 1),
    bodyDamage: (18 + stats.bodyDamage * STAT_GAINS.bodyDamage) * rammerBonus * spikeBonus,
    regenPerSecond: 1.8 + stats.healthRegen * STAT_GAINS.healthRegen,
    reloadMultiplier: 1 / (1 + stats.reload * STAT_GAINS.reload),
    bulletSpeedMultiplier: 1 + stats.bulletSpeed * STAT_GAINS.bulletSpeed,
    bulletDamageMultiplier: 1 + stats.bulletDamage * STAT_GAINS.bulletDamage,
    bulletPenetrationMultiplier: 1 + stats.bulletPenetration * STAT_GAINS.bulletPenetration,
    radius: tankClass.bodyRadius ?? 24 + Math.min(8, level * 0.15),
    fovMultiplier: tankClass.fovMultiplier ?? 1,
  };
}

export function normalizeStatsForTank(tankId: string, stats: StatAllocation): StatAllocation {
  const caps = statCapsForTank(tankId);
  const normalized = { ...stats };
  for (const key of STAT_KEYS) {
    normalized[key] = Math.min(normalized[key], caps[key]);
  }
  return normalized;
}
