import { describe, expect, it } from 'vitest';
import { availableStatPoints, canUpgradeTank, DEFAULT_STATS, levelForXp, totalStatPointsForLevel, xpRequiredForLevel } from './progression';

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
});
