import type { ClientInputPayload, ClientMessage } from './protocol';
import { STAT_KEYS, type StatKey } from './tankTypes';
import { TANK_CLASSES_BY_ID } from './tanks';

export interface ClientMessageValidationResult {
  message?: ClientMessage;
  reason?: string;
}

const MAX_NAME_LENGTH = 64;

export function validateClientMessage(value: unknown): ClientMessageValidationResult {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { reason: 'Message must be an object with a type.' };
  }

  if (value.type === 'join') {
    if (typeof value.name !== 'string') return { reason: 'Join message requires a name.' };
    if (value.name.length > MAX_NAME_LENGTH) return { reason: 'Join name is too long.' };
    if (value.token !== undefined && typeof value.token !== 'string') return { reason: 'Join token must be a string.' };
    if (value.mode !== 'online' && value.mode !== 'bots') return { reason: 'Join mode must be online or bots.' };

    return {
      message: {
        type: 'join',
        token: value.token,
        name: value.name,
        mode: value.mode,
      },
    };
  }

  if (value.type === 'input') {
    const input = validateInputPayload(value.input);
    if (!input) return { reason: 'Input message has an invalid payload.' };
    return {
      message: {
        type: 'input',
        input,
      },
    };
  }

  if (value.type === 'retry') {
    return { message: { type: 'retry' } };
  }

  if (value.type === 'upgradeStat') {
    if (!isStatKey(value.stat)) return { reason: 'Upgrade stat is not valid.' };
    return {
      message: {
        type: 'upgradeStat',
        stat: value.stat,
      },
    };
  }

  if (value.type === 'upgradeTank') {
    if (typeof value.tankId !== 'string' || !TANK_CLASSES_BY_ID[value.tankId]) {
      return { reason: 'Upgrade tank is not valid.' };
    }
    return {
      message: {
        type: 'upgradeTank',
        tankId: value.tankId,
      },
    };
  }

  return { reason: 'Unknown client message type.' };
}

function validateInputPayload(value: unknown): ClientInputPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isFiniteNumber(value.moveX) ||
    !isFiniteNumber(value.moveY) ||
    !isFiniteNumber(value.aimX) ||
    !isFiniteNumber(value.aimY) ||
    typeof value.fire !== 'boolean' ||
    typeof value.altFire !== 'boolean' ||
    typeof value.autoFire !== 'boolean' ||
    typeof value.autoSpin !== 'boolean'
  ) {
    return undefined;
  }

  return {
    moveX: value.moveX,
    moveY: value.moveY,
    aimX: value.aimX,
    aimY: value.aimY,
    fire: value.fire,
    altFire: value.altFire,
    autoFire: value.autoFire,
    autoSpin: value.autoSpin,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStatKey(value: unknown): value is StatKey {
  return typeof value === 'string' && STAT_KEYS.includes(value as StatKey);
}
