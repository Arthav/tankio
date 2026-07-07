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

  it('preserves raw mouse aim angle instead of clamping it into a diagonal', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    const expectedAngle = Math.atan2(250, 500);

    setPlayerInput(room, player.id, {
      moveX: 0,
      moveY: 0,
      aimX: 500,
      aimY: 250,
      fire: false,
      altFire: false,
      autoFire: false,
      autoSpin: false,
    });
    updateRoom(room, 16);

    expect(player.input.aimX).toBeCloseTo(500 / Math.hypot(500, 250), 5);
    expect(player.input.aimY).toBeCloseTo(250 / Math.hypot(500, 250), 5);
    expect(player.aim).toBeCloseTo(expectedAngle, 5);
    expect(player.aim).not.toBeCloseTo(Math.PI / 4, 5);
  });

  it('fires projectiles along the normalized mouse aim angle', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    const expectedAngle = Math.atan2(250, 500);

    setPlayerInput(room, player.id, {
      moveX: 0,
      moveY: 0,
      aimX: 500,
      aimY: 250,
      fire: true,
      altFire: false,
      autoFire: false,
      autoSpin: false,
    });
    updateRoom(room, 16);

    const projectile = [...room.projectiles.values()].find((entry) => entry.ownerId === player.id);
    expect(projectile).toBeDefined();
    expect(Math.atan2(projectile!.vy, projectile!.vx)).toBeCloseTo(expectedAngle, 5);
  });

  it('keeps auto-spin-friendly tanks on mouse aim when auto-spin is off', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    player.tankId = 'quad_tank';

    setPlayerInput(room, player.id, {
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 1,
      fire: false,
      altFire: false,
      autoFire: false,
      autoSpin: false,
    });
    updateRoom(room, 100);

    expect(player.aim).toBeCloseTo(Math.PI / 2, 5);
  });

  it('rotates auto-spin-friendly tanks only when auto-spin is on', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    player.tankId = 'quad_tank';
    player.aim = 0;

    setPlayerInput(room, player.id, {
      moveX: 0,
      moveY: 0,
      aimX: 0,
      aimY: 1,
      fire: false,
      altFire: false,
      autoFire: false,
      autoSpin: true,
    });
    updateRoom(room, 100);

    expect(player.aim).toBeCloseTo(0.064 * 0.9, 5);
    expect(player.aim).not.toBeCloseTo(Math.PI / 2, 5);
  });

  it('rejects unavailable tank upgrades', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    expect(upgradePlayerTank(room, player.id, 'triplet')).toBe(false);
  });
});
