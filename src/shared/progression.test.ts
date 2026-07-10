import { describe, expect, it } from 'vitest';
import {
  availableStatPoints,
  canUpgradeTank,
  DEFAULT_STATS,
  deriveTankStats,
  levelForXp,
  STAT_GAINS,
  statCapsForTank,
  totalStatPointsForLevel,
  xpRequiredForLevel,
} from './progression';

describe('progression', () => {
  it('unlocks class tiers at level 15, 30, and 45', () => {
    expect(canUpgradeTank('basic', 'twin', 14)).toBe(false);
    expect(canUpgradeTank('basic', 'twin', 15)).toBe(true);
    expect(canUpgradeTank('twin', 'triple_shot', 29)).toBe(false);
    expect(canUpgradeTank('twin', 'triple_shot', 30)).toBe(true);
    expect(canUpgradeTank('triple_shot', 'triplet', 44)).toBe(false);
    expect(canUpgradeTank('triple_shot', 'triplet', 45)).toBe(true);
  });

  it('supports skipped upgrade paths', () => {
    expect(canUpgradeTank('basic', 'smasher', 30)).toBe(true);
    expect(canUpgradeTank('basic', 'auto_tank', 45)).toBe(true);
    expect(canUpgradeTank('machine_gun', 'sprayer', 45)).toBe(true);
  });

  it('caps stat point cadence at 33 points', () => {
    expect(totalStatPointsForLevel(1)).toBe(0);
    expect(totalStatPointsForLevel(28)).toBe(27);
    expect(totalStatPointsForLevel(29)).toBe(27);
    expect(totalStatPointsForLevel(30)).toBe(28);
    expect(totalStatPointsForLevel(45)).toBe(33);
    expect(availableStatPoints(45, DEFAULT_STATS)).toBe(33);
  });

  it('maps XP into increasing levels', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpRequiredForLevel(15))).toBe(15);
    expect(levelForXp(xpRequiredForLevel(45) + 999999)).toBe(45);
  });

  it('keeps default derived stats sane for a new basic tank', () => {
    const derived = deriveTankStats('basic', 1, DEFAULT_STATS);

    expect(derived.maxHealth).toBeCloseTo(102.2, 5);
    expect(derived.moveSpeed).toBeCloseTo(220, 5);
    expect(derived.bodyDamage).toBeCloseTo(18, 5);
    expect(derived.regenPerSecond).toBeCloseTo(1.8, 5);
    expect(derived.reloadMultiplier).toBeCloseTo(1, 5);
    expect(derived.bulletSpeedMultiplier).toBeCloseTo(1, 5);
    expect(derived.bulletDamageMultiplier).toBeCloseTo(1, 5);
    expect(derived.bulletPenetrationMultiplier).toBeCloseTo(1, 5);
  });

  it('applies the exact noticeable gain for each first stat point', () => {
    const base = deriveTankStats('basic', 1, DEFAULT_STATS);

    expect(deriveTankStats('basic', 1, statsWith({ maxHealth: 1 })).maxHealth - base.maxHealth).toBeCloseTo(STAT_GAINS.maxHealth, 5);
    expect(deriveTankStats('basic', 1, statsWith({ movementSpeed: 1 })).moveSpeed - base.moveSpeed).toBeCloseTo(STAT_GAINS.movementSpeed, 5);
    expect(deriveTankStats('basic', 1, statsWith({ bodyDamage: 1 })).bodyDamage - base.bodyDamage).toBeCloseTo(STAT_GAINS.bodyDamage, 5);
    expect(deriveTankStats('basic', 1, statsWith({ healthRegen: 1 })).regenPerSecond - base.regenPerSecond).toBeCloseTo(STAT_GAINS.healthRegen, 5);
    expect(deriveTankStats('basic', 1, statsWith({ bulletSpeed: 1 })).bulletSpeedMultiplier - base.bulletSpeedMultiplier).toBeCloseTo(
      STAT_GAINS.bulletSpeed,
      5,
    );
    expect(deriveTankStats('basic', 1, statsWith({ bulletPenetration: 1 })).bulletPenetrationMultiplier - base.bulletPenetrationMultiplier).toBeCloseTo(
      STAT_GAINS.bulletPenetration,
      5,
    );
    expect(deriveTankStats('basic', 1, statsWith({ bulletDamage: 1 })).bulletDamageMultiplier - base.bulletDamageMultiplier).toBeCloseTo(
      STAT_GAINS.bulletDamage,
      5,
    );
    expect(1 / deriveTankStats('basic', 1, statsWith({ reload: 1 })).reloadMultiplier - 1).toBeCloseTo(STAT_GAINS.reload, 5);
  });

  it('keeps seven-point standard weapon investment strong but readable', () => {
    const derived = deriveTankStats(
      'basic',
      45,
      statsWith({
        bulletSpeed: 7,
        bulletPenetration: 7,
        bulletDamage: 7,
        reload: 7,
      }),
    );

    expect(derived.bulletSpeedMultiplier).toBeCloseTo(1 + STAT_GAINS.bulletSpeed * 7, 5);
    expect(derived.bulletPenetrationMultiplier).toBeCloseTo(1 + STAT_GAINS.bulletPenetration * 7, 5);
    expect(derived.bulletDamageMultiplier).toBeCloseTo(1 + STAT_GAINS.bulletDamage * 7, 5);
    expect(derived.reloadMultiplier).toBeCloseTo(1 / (1 + STAT_GAINS.reload * 7), 5);
    expect(derived.bulletDamageMultiplier).toBeLessThan(2);
    expect(derived.reloadMultiplier).toBeGreaterThan(0.5);
  });

  it('keeps ten-point special caps available for smasher and expanded-cap tanks', () => {
    const smasherCaps = statCapsForTank('smasher');
    const autoSmasherCaps = statCapsForTank('auto_smasher');
    const autoSmasher = deriveTankStats(
      'auto_smasher',
      45,
      statsWith({
        maxHealth: 10,
        bulletDamage: 10,
        reload: 10,
      }),
    );

    expect(smasherCaps.maxHealth).toBe(10);
    expect(smasherCaps.bodyDamage).toBe(10);
    expect(smasherCaps.bulletDamage).toBe(0);
    expect(autoSmasherCaps.bulletDamage).toBe(10);
    expect(autoSmasher.maxHealth).toBeCloseTo(100 + 45 * 2.2 + STAT_GAINS.maxHealth * 10, 5);
    expect(autoSmasher.bulletDamageMultiplier).toBeCloseTo(1 + STAT_GAINS.bulletDamage * 10, 5);
    expect(autoSmasher.reloadMultiplier).toBeCloseTo(1 / (1 + STAT_GAINS.reload * 10), 5);
  });
});

function statsWith(overrides: Partial<typeof DEFAULT_STATS>) {
  return {
    ...DEFAULT_STATS,
    ...overrides,
  };
}
