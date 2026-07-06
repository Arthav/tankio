import { describe, expect, it } from 'vitest';
import { BASELINE_TANK_COUNT, TANK_CLASSES, TANK_CLASSES_BY_ID } from './tanks';
import { upgradeEdges } from './progression';

describe('baseline tank tree', () => {
  it('contains the current normal baseline tank count', () => {
    expect(TANK_CLASSES).toHaveLength(BASELINE_TANK_COUNT);
  });

  it('has valid parent references for every upgrade', () => {
    for (const tankClass of TANK_CLASSES) {
      for (const parent of tankClass.parents) {
        expect(TANK_CLASSES_BY_ID[parent], `${tankClass.id} parent ${parent}`).toBeDefined();
      }
    }
  });

  it('excludes removed, event, and special tanks from the baseline tree', () => {
    expect(TANK_CLASSES_BY_ID.mega_smasher).toBeUndefined();
    expect(TANK_CLASSES_BY_ID.arena_closer).toBeUndefined();
    expect(TANK_CLASSES_BY_ID.mothership).toBeUndefined();
    expect(TANK_CLASSES_BY_ID.dominator).toBeUndefined();
  });

  it('keeps skipped upgrade paths explicit', () => {
    const edges = upgradeEdges();
    expect(edges).toContainEqual({
      fromTankId: 'basic',
      toTankId: 'smasher',
      requiredLevel: 30,
      requiresSkippedUpgrade: true,
    });
    expect(edges).toContainEqual({
      fromTankId: 'basic',
      toTankId: 'auto_tank',
      requiredLevel: 45,
      requiresSkippedUpgrade: true,
    });
    expect(edges).toContainEqual({
      fromTankId: 'machine_gun',
      toTankId: 'sprayer',
      requiredLevel: 45,
      requiresSkippedUpgrade: true,
    });
  });
});
