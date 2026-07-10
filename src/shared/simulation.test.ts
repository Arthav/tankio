import { describe, expect, it } from 'vitest';
import { deriveTankStats, STAT_GAINS } from './progression';
import { addPlayer, createRoom, retryPlayer, setPlayerInput, snapshotForPlayer, updateRoom, upgradePlayerStat, upgradePlayerTank } from './simulation';
import type { MatchProjectile, MatchShape } from './simulation';

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

  it('does not mutate the room when snapshotting a missing player', () => {
    const room = createRoom('test', 123);
    const playerCount = room.players.size;

    const snapshot = snapshotForPlayer(room, 'missing-player');

    expect(snapshot.selfId).toBe('missing-player');
    expect(snapshot.self.alive).toBe(false);
    expect(snapshot.players).toEqual([]);
    expect(room.players.size).toBe(playerCount);
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

  it('emits feedback when a projectile hits a shape', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Shooter' });
    resetCombatRoom(room);
    player.x = 1000;
    player.y = 1000;
    const shape = addTestShape(room, { id: 'shape-hit', x: 1120, y: 1000, hp: 80, xp: 24 });
    const projectile = addTestProjectile(room, player.id, shape.x, shape.y, { damage: 17, penetration: 100 });

    updateRoom(room, 1);

    expect(combatKinds(room)).toContain('projectile_shape');
    expect(room.shapes.get(shape.id)?.hp).toBeCloseTo(80 - projectile.damage, 5);
  });

  it('emits destruction feedback and preserves shape XP when a projectile destroys a shape', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Shooter' });
    resetCombatRoom(room);
    player.x = 1000;
    player.y = 1000;
    const shape = addTestShape(room, { id: 'shape-dead', x: 1120, y: 1000, hp: 5, xp: 46 });

    addTestProjectile(room, player.id, shape.x, shape.y, { damage: 17, penetration: 100 });
    updateRoom(room, 1);

    expect(combatKinds(room)).toEqual(expect.arrayContaining(['projectile_shape', 'shape_destroyed']));
    const destroyEvent = room.combatEvents.find((event) => event.kind === 'shape_destroyed');
    expect(destroyEvent?.xpGain).toBe(46);
    expect(destroyEvent?.xpAfter).toBe(46);
    expect(destroyEvent?.levelAfter).toBe(1);
    expect(room.shapes.has(shape.id)).toBe(false);
    expect(player.score).toBe(46);
    expect(player.sessionXp).toBe(46);
  });

  it('includes XP reward metadata when body damage destroys a shape', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Rammer' });
    resetCombatRoom(room);
    player.x = 1000;
    player.y = 1000;
    player.invulnerableMs = 0;
    const shape = addTestShape(room, { id: 'shape-body-dead', x: 1000, y: 1000, hp: 0.5, xp: 24 });

    updateRoom(room, 16);

    const destroyEvent = room.combatEvents.find((event) => event.kind === 'shape_destroyed');
    expect(destroyEvent?.xpGain).toBe(24);
    expect(destroyEvent?.xpAfter).toBe(24);
    expect(destroyEvent?.levelAfter).toBe(1);
    expect(room.shapes.has(shape.id)).toBe(false);
    expect(player.score).toBe(24);
    expect(player.sessionXp).toBe(24);
  });

  it('emits feedback when a projectile hits a player without changing projectile damage', () => {
    const room = createRoom('test', 123);
    const shooter = addPlayer(room, { id: 'p1', name: 'Shooter' });
    const target = addPlayer(room, { id: 'p2', name: 'Target' });
    resetCombatRoom(room);
    shooter.x = 1000;
    shooter.y = 1000;
    target.x = 1400;
    target.y = 1000;
    target.invulnerableMs = 0;
    const projectile = addTestProjectile(room, shooter.id, target.x, target.y, { damage: 17, penetration: 100 });
    const startingHealth = target.health;

    updateRoom(room, 1);

    expect(combatKinds(room)).toContain('projectile_player');
    expect(target.health).toBeCloseTo(startingHealth - projectile.damage, 5);
  });

  it('emits player destruction feedback when projectile damage kills a player', () => {
    const room = createRoom('test', 123);
    const shooter = addPlayer(room, { id: 'p1', name: 'Shooter' });
    const target = addPlayer(room, { id: 'p2', name: 'Target' });
    resetCombatRoom(room);
    shooter.x = 1000;
    shooter.y = 1000;
    target.x = 1400;
    target.y = 1000;
    target.health = 1;
    target.invulnerableMs = 0;

    addTestProjectile(room, shooter.id, target.x, target.y, { damage: 17, penetration: 100 });
    updateRoom(room, 1);

    expect(target.alive).toBe(false);
    expect(combatKinds(room)).toEqual(expect.arrayContaining(['projectile_player', 'player_destroyed']));
    const destroyEvent = room.combatEvents.find((event) => event.kind === 'player_destroyed');
    expect(destroyEvent?.xpGain).toBe(120);
    expect(destroyEvent?.xpAfter).toBe(120);
    expect(destroyEvent?.levelAfter).toBe(2);
    expect(shooter.sessionXp).toBe(120);
  });

  it('emits throttled body impact feedback for player and shape collisions', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Rammer' });
    resetCombatRoom(room);
    player.x = 1000;
    player.y = 1000;
    player.health = 102;
    player.invulnerableMs = 0;
    const shape = addTestShape(room, { id: 'shape-ram', x: 1000, y: 1000, hp: 999, xp: 24 });

    updateRoom(room, 16);
    const firstCount = combatKinds(room).filter((kind) => kind === 'body_shape').length;
    player.x = shape.x;
    player.y = shape.y;
    updateRoom(room, 16);
    const throttledCount = combatKinds(room).filter((kind) => kind === 'body_shape').length;
    player.x = shape.x;
    player.y = shape.y;
    updateRoom(room, 181);
    const unthrottledCount = combatKinds(room).filter((kind) => kind === 'body_shape').length;

    expect(firstCount).toBe(1);
    expect(throttledCount).toBe(1);
    expect(unthrottledCount).toBe(2);
  });

  it('emits throttled body impact feedback for player and player collisions', () => {
    const room = createRoom('test', 123);
    const first = addPlayer(room, { id: 'p1', name: 'First' });
    const second = addPlayer(room, { id: 'p2', name: 'Second' });
    resetCombatRoom(room);
    first.x = 1000;
    first.y = 1000;
    second.x = 1000;
    second.y = 1000;
    first.invulnerableMs = 0;
    second.invulnerableMs = 0;

    updateRoom(room, 16);
    const firstCount = combatKinds(room).filter((kind) => kind === 'body_player').length;
    first.x = 1000;
    first.y = 1000;
    second.x = 1000;
    second.y = 1000;
    updateRoom(room, 16);
    const throttledCount = combatKinds(room).filter((kind) => kind === 'body_player').length;
    first.x = 1000;
    first.y = 1000;
    second.x = 1000;
    second.y = 1000;
    updateRoom(room, 181);
    const unthrottledCount = combatKinds(room).filter((kind) => kind === 'body_player').length;

    expect(firstCount).toBe(1);
    expect(throttledCount).toBe(1);
    expect(unthrottledCount).toBe(2);
  });

  it('includes visible combat feedback events in snapshots', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Shooter' });
    resetCombatRoom(room);
    player.x = 1000;
    player.y = 1000;
    const shape = addTestShape(room, { id: 'shape-snapshot', x: 1120, y: 1000, hp: 80, xp: 24 });

    addTestProjectile(room, player.id, shape.x, shape.y, { damage: 17, penetration: 100 });
    updateRoom(room, 1);

    expect(snapshotForPlayer(room, player.id).combatEvents.some((event) => event.kind === 'projectile_shape')).toBe(true);
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

  it('heals max-health stat upgrades by the actual gained capacity', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    player.level = 2;
    const before = deriveTankStats(player.tankId, player.level, player.stats);
    player.health = before.maxHealth - 30;

    expect(upgradePlayerStat(room, player.id, 'maxHealth')).toBe(true);

    const after = deriveTankStats(player.tankId, player.level, player.stats);
    expect(after.maxHealth - before.maxHealth).toBeCloseTo(STAT_GAINS.maxHealth, 5);
    expect(player.health).toBeCloseTo(before.maxHealth - 30 + STAT_GAINS.maxHealth, 5);
  });

  it('applies non-health stat upgrades without exceeding points or caps', () => {
    const room = createRoom('test', 123);
    const player = addPlayer(room, { id: 'p1', name: 'Tester' });
    player.level = 2;
    const derived = deriveTankStats(player.tankId, player.level, player.stats);
    player.health = derived.maxHealth - 40;

    expect(upgradePlayerStat(room, player.id, 'reload')).toBe(true);
    expect(player.stats.reload).toBe(1);
    expect(player.health).toBeCloseTo(derived.maxHealth - 24, 5);
    expect(upgradePlayerStat(room, player.id, 'movementSpeed')).toBe(false);
    expect(player.stats.movementSpeed).toBe(0);

    const smasher = addPlayer(room, { id: 'p2', name: 'Smasher' });
    smasher.tankId = 'smasher';
    smasher.level = 2;

    expect(upgradePlayerStat(room, smasher.id, 'bulletDamage')).toBe(false);
    expect(smasher.stats.bulletDamage).toBe(0);
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

function resetCombatRoom(room: ReturnType<typeof createRoom>): void {
  room.shapes.clear();
  room.projectiles.clear();
  room.combatEvents.length = 0;
  room.bodyImpactCooldowns.clear();
}

function addTestShape(
  room: ReturnType<typeof createRoom>,
  options: { id: string; x: number; y: number; hp: number; xp: number },
): MatchShape {
  const shape: MatchShape = {
    id: options.id,
    shape: 'square',
    x: options.x,
    y: options.y,
    radius: 24,
    hp: options.hp,
    maxHp: options.hp,
    xp: options.xp,
    rotation: 0,
  };
  room.shapes.set(shape.id, shape);
  return shape;
}

function addTestProjectile(
  room: ReturnType<typeof createRoom>,
  ownerId: string,
  x: number,
  y: number,
  options: { damage: number; penetration: number },
): MatchProjectile {
  const projectile: MatchProjectile = {
    id: `projectile-${room.projectiles.size + 1}`,
    ownerId,
    kind: 'bullet',
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 8,
    damage: options.damage,
    penetration: options.penetration,
    lifeMs: 1000,
    maxLifeMs: 1000,
    color: '#35d0ff',
  };
  room.projectiles.set(projectile.id, projectile);
  return projectile;
}

function combatKinds(room: ReturnType<typeof createRoom>): string[] {
  return room.combatEvents.map((event) => event.kind);
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
