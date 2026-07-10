import { describe, expect, it } from 'vitest';
import { validateClientMessage } from './protocolValidation';

describe('protocol validation', () => {
  it('accepts a complete gameplay input message', () => {
    const result = validateClientMessage({
      type: 'input',
      input: {
        moveX: 1,
        moveY: -1,
        aimX: 500,
        aimY: 250,
        fire: true,
        altFire: false,
        autoFire: true,
        autoSpin: false,
      },
    });

    expect(result.message).toEqual({
      type: 'input',
      input: {
        moveX: 1,
        moveY: -1,
        aimX: 500,
        aimY: 250,
        fire: true,
        altFire: false,
        autoFire: true,
        autoSpin: false,
      },
    });
  });

  it('rejects malformed input instead of trusting runtime casts', () => {
    const result = validateClientMessage({
      type: 'input',
      input: {
        moveX: Number.NaN,
        moveY: 0,
        aimX: 1,
        aimY: 0,
        fire: 'yes',
        altFire: false,
        autoFire: false,
        autoSpin: false,
      },
    });

    expect(result.message).toBeUndefined();
    expect(result.reason).toBe('Input message has an invalid payload.');
  });

  it('rejects invalid upgrade targets', () => {
    expect(validateClientMessage({ type: 'upgradeStat', stat: 'madeUpStat' }).message).toBeUndefined();
    expect(validateClientMessage({ type: 'upgradeTank', tankId: 'missing_tank' }).message).toBeUndefined();
  });
});
