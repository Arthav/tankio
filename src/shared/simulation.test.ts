import { describe, expect, it } from 'vitest';
import { addPlayer, createRoom, retryPlayer, setPlayerInput, snapshotForPlayer, updateRoom, upgradePlayerTank } from './simulation';

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

  it('skips spawn candidates too close to an existing human tank', () => {
    const room = createRoom('test', 123);
    const existing = addPlayer(room, { id: 'p1', name: 'Tester' });
    existing.x = 1000;
    existing.y = 1000;

    setSpawnCandidates(room, [
      { x: 1020, y: 1000 },
      { x: 1800, y: 1000 },
    ]);

    const spawned = addPlayer(room, { id: 'p2', name: 'Second' });

    expectSpawnedAt(spawned, { x: 1800, y: 1000 });
    expect(distanceBetween(spawned, existing)).toBeGreaterThanOrEqual(700);
  });

  it('keeps new spawns away from existing bot tanks', () => {
    const room = createRoom('test', 123);
    const bot = addPlayer(room, { id: 'b1', name: 'Bot', bot: true });
    bot.x = 2200;
    bot.y = 2200;

    setSpawnCandidates(room, [
      { x: 2220, y: 2220 },
      { x: 3000, y: 2200 },
    ]);

    const spawned = addPlayer(room, { id: 'p1', name: 'Tester' });

    expectSpawnedAt(spawned, { x: 3000, y: 2200 });
    expect(distanceBetween(spawned, bot)).toBeGreaterThanOrEqual(700);
  });

  it('keeps destroyed human players dead until retry', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    placeKillingShape(room, player);

    updateRoom(room, 100);

    expect(player.alive).toBe(false);
    expect(player.respawnMs).toBe(0);

    updateRoom(room, 3000);

    expect(player.alive).toBe(false);
    expect(player.respawnMs).toBe(0);
  });

  it('uses safe spawn candidates when retrying dead human players', () => {
    const room = createRoom('test', 123);
    const blocker = addPlayer(room, { id: 'p1', name: 'Blocker' });
    const respawning = addPlayer(room, { id: 'p2', name: 'Respawn' });
    blocker.x = 1000;
    blocker.y = 1000;
    respawning.alive = false;
    respawning.health = 0;
    respawning.respawnMs = 1;
    room.shapes.clear();

    setSpawnCandidates(room, [
      { x: 1010, y: 1000 },
      { x: 1800, y: 1000 },
    ]);

    expect(retryPlayer(room, respawning.id)).toBe(true);

    expect(respawning.alive).toBe(true);
    expectSpawnedAt(respawning, { x: 1800, y: 1000 });
    expect(distanceBetween(respawning, blocker)).toBeGreaterThanOrEqual(700);
  });

  it('rejects retry for alive, missing, and bot players', () => {
    const room = createRoom('test', 123);
    const alive = addPlayer(room, { id: 'p1', name: 'Alive' });
    const bot = addPlayer(room, { id: 'b1', name: 'Bot', bot: true });
    bot.alive = false;
    bot.health = 0;

    expect(retryPlayer(room, alive.id)).toBe(false);
    expect(retryPlayer(room, 'missing')).toBe(false);
    expect(retryPlayer(room, bot.id)).toBe(false);
  });

  it('still auto-respawns dead bots after their rebuild timer', () => {
    const room = createRoom('test', 123);
    const bot = addPlayer(room, { id: 'b1', name: 'Bot', bot: true });
    bot.alive = false;
    bot.health = 0;
    bot.respawnMs = 1;

    setSpawnCandidates(room, [{ x: 1800, y: 1800 }]);
    updateRoom(room, 16);

    expect(bot.alive).toBe(true);
    expectSpawnedAt(bot, { x: 1800, y: 1800 });
  });

  it('falls back to the farthest sampled spawn when all candidates are crowded', () => {
    const room = createRoom('test', 123);
    const blocker = addPlayer(room, { id: 'p1', name: 'Blocker' });
    const nearCandidate = { x: 1020, y: 1000 };
    const farthestUnsafeCandidate = { x: 1600, y: 1000 };
    blocker.x = 1000;
    blocker.y = 1000;

    setSpawnCandidates(room, [
      nearCandidate,
      farthestUnsafeCandidate,
      ...Array.from({ length: 62 }, () => nearCandidate),
    ]);

    const spawned = addPlayer(room, { id: 'p2', name: 'Fallback' });

    expectSpawnedAt(spawned, farthestUnsafeCandidate);
    expect(distanceBetween(spawned, blocker)).toBeLessThan(700);
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

function setSpawnCandidates(room: ReturnType<typeof createRoom>, points: Array<{ x: number; y: number }>): void {
  room.rng = rngFromValues(
    points.flatMap((point) => [
      (point.x - 160) / (room.width - 320),
      (point.y - 160) / (room.height - 320),
    ]),
  );
}

function placeKillingShape(room: ReturnType<typeof createRoom>, player: ReturnType<typeof addPlayer>): void {
  room.shapes.clear();
  player.x = 1000;
  player.y = 1000;
  player.health = 1;
  player.invulnerableMs = 0;
  room.shapes.set('test-shape', {
    id: 'test-shape',
    shape: 'square',
    x: player.x,
    y: player.y,
    radius: 17,
    hp: 999,
    maxHp: 999,
    xp: 0,
    rotation: 0,
  });
}

function rngFromValues(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}

function expectSpawnedAt(player: { x: number; y: number }, point: { x: number; y: number }): void {
  expect(player.x).toBeCloseTo(point.x, 5);
  expect(player.y).toBeCloseTo(point.y, 5);
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
