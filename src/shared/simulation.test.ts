import { describe, expect, it } from 'vitest';
import { addPlayer, createRoom, setPlayerInput, snapshotForPlayer, updateRoom, upgradePlayerTank } from './simulation';

describe('simulation', () => {
  it('creates a room with farmable shapes', () => {
    const room = createRoom('test', 123);
    expect(room.shapes.size).toBeGreaterThan(200);
  });

  it('keeps snapshots scoped to the self player contract', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    const snapshot = snapshotForPlayer(room, player.id);
    expect(snapshot.selfId).toBe(player.id);
    expect(snapshot.self.tankId).toBe('basic');
    expect(snapshot.players.some((entry) => entry.id === player.id)).toBe(true);
  });

  it('accepts valid movement input and advances the player', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    const startX = player.x;
    setPlayerInput(room, player.id, {
      moveX: 1,
      moveY: 0,
      aimX: 1,
      aimY: 0,
      fire: false,
      altFire: false,
      autoFire: false,
      autoSpin: false,
    });
    updateRoom(room, 100);
    expect(player.x).toBeGreaterThan(startX);
  });

  it('rejects unavailable tank upgrades', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    expect(upgradePlayerTank(room, player.id, 'triplet')).toBe(false);
  });
});
