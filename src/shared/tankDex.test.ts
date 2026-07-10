import { describe, expect, it } from 'vitest';
import { TANK_DEX_ENTRIES, TANK_DEX_METADATA, getTankDexEntry, tankDexPowerKeys } from './tankDex';
import { BASELINE_TANK_COUNT, TANK_CLASSES } from './tanks';

describe('tank dex', () => {
  it('has one entry and authored metadata for every current tank class', () => {
    expect(TANK_DEX_ENTRIES).toHaveLength(BASELINE_TANK_COUNT);

    for (const tankClass of TANK_CLASSES) {
      const entry = getTankDexEntry(tankClass.id);
      expect(entry.tank.id).toBe(tankClass.id);
      expect(TANK_DEX_METADATA[tankClass.id], `${tankClass.id} metadata`).toBeDefined();
    }
  });

  it('keeps every authored role and description non-empty', () => {
    for (const entry of TANK_DEX_ENTRIES) {
      expect(entry.metadata.role.trim(), `${entry.tank.id} role`).not.toBe('');
      expect(entry.metadata.description.trim(), `${entry.tank.id} description`).not.toBe('');
      expect(entry.metadata.playstyle.trim(), `${entry.tank.id} playstyle`).not.toBe('');
    }
  });

  it('derives finite 0-100 power bars for every tank', () => {
    const powerKeys = tankDexPowerKeys();
    expect(powerKeys).toEqual(['damage', 'fireRate', 'range', 'mobility', 'survivability', 'utility']);

    for (const entry of TANK_DEX_ENTRIES) {
      for (const key of powerKeys) {
        expect(Number.isFinite(entry.power[key]), `${entry.tank.id} ${key}`).toBe(true);
        expect(entry.power[key], `${entry.tank.id} ${key}`).toBeGreaterThanOrEqual(0);
        expect(entry.power[key], `${entry.tank.id} ${key}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('derives every full upgrade path into multi-parent tanks', () => {
    const battleshipPaths = getTankDexEntry('battleship').paths.map((path) => path.tankIds.join('>'));
    expect(battleshipPaths).toEqual(
      expect.arrayContaining(['basic>twin>twin_flank>battleship', 'basic>flank_guard>twin_flank>battleship', 'basic>sniper>overseer>battleship']),
    );

    const autoFivePaths = getTankDexEntry('auto_5').paths.map((path) => path.tankIds.join('>'));
    expect(autoFivePaths).toEqual(expect.arrayContaining(['basic>twin>quad_tank>auto_5', 'basic>flank_guard>quad_tank>auto_5', 'basic>flank_guard>auto_3>auto_5']));
  });

  it('keeps skipped upgrade requirements explicit', () => {
    const smasher = getTankDexEntry('smasher');
    expect(smasher.paths).toHaveLength(1);
    expect(smasher.paths[0].segments).toContainEqual(
      expect.objectContaining({
        fromTankId: 'basic',
        toTankId: 'smasher',
        requiredLevel: 30,
        requiresSkippedUpgrade: true,
      }),
    );

    const autoTank = getTankDexEntry('auto_tank');
    expect(autoTank.paths[0].segments).toContainEqual(
      expect.objectContaining({
        fromTankId: 'basic',
        toTankId: 'auto_tank',
        requiredLevel: 45,
        requiresSkippedUpgrade: true,
      }),
    );
  });
});
