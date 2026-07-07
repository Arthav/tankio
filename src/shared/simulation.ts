import {
  availableStatPoints,
  canAllocateStat,
  canUpgradeTank,
  DEFAULT_STATS,
  deriveTankStats,
  levelForXp,
  normalizeStatsForTank,
  upgradeOptions,
} from './progression';
import type { ClientInputPayload, GameSnapshot } from './protocol';
import type { ProjectileKind, StatAllocation, StatKey, WeaponMount } from './tankTypes';
import { getTankClass, TANK_CLASSES_BY_ID } from './tanks';

const WORLD_WIDTH = 4200;
const WORLD_HEIGHT = 4200;
const MAX_SHAPES = 260;
const PLAYER_RESPAWN_MS = 2200;
const INPUT_DEADZONE = 0.05;

type ShapeKind = 'square' | 'triangle' | 'pentagon' | 'alpha_pentagon';

interface SnapshotEvent {
  id: string;
  type: 'kill' | 'level' | 'upgrade' | 'system';
  message: string;
  at: number;
}

export interface MatchInput extends ClientInputPayload {
  lastSeenAt: number;
}

export interface MatchPlayer {
  id: string;
  profileId?: string;
  name: string;
  bot: boolean;
  tankId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  xp: number;
  level: number;
  score: number;
  sessionXp: number;
  stats: StatAllocation;
  health: number;
  alive: boolean;
  respawnMs: number;
  invulnerableMs: number;
  reloads: Record<string, number>;
  stealthMs: number;
  revealedMs: number;
  kills: number;
  deaths: number;
  color: string;
  input: MatchInput;
  botThinkMs: number;
  botTargetId?: string;
  joinedAt: number;
  bestTankId: string;
}

export interface MatchProjectile {
  id: string;
  ownerId: string;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  penetration: number;
  lifeMs: number;
  maxLifeMs: number;
  color: string;
  targetX?: number;
  targetY?: number;
  turnRate?: number;
  dampingAfterMs?: number;
  splitCount?: number;
}

export interface MatchShape {
  id: string;
  shape: ShapeKind;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  xp: number;
  rotation: number;
}

export interface SimulationDeath {
  type: 'death';
  victimId: string;
  killerId?: string;
  victimProfileId?: string;
  killerProfileId?: string;
  victimName: string;
  killerName?: string;
  victimTankId: string;
  xpEarned: number;
  score: number;
  kills: number;
  deaths: number;
  durationSeconds: number;
}

export interface GameRoom {
  id: string;
  now: number;
  width: number;
  height: number;
  players: Map<string, MatchPlayer>;
  projectiles: Map<string, MatchProjectile>;
  shapes: Map<string, MatchShape>;
  events: SnapshotEvent[];
  sequence: number;
  rng: () => number;
}

export interface AddPlayerOptions {
  id: string;
  profileId?: string;
  name: string;
  bot?: boolean;
  color?: string;
}

function defaultInput(now: number): MatchInput {
  return {
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    fire: false,
    altFire: false,
    autoFire: false,
    autoSpin: false,
    lastSeenAt: now,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRoom(id = 'ffa-main', seed = Date.now()): GameRoom {
  const room: GameRoom = {
    id,
    now: 0,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    players: new Map(),
    projectiles: new Map(),
    shapes: new Map(),
    events: [],
    sequence: 0,
    rng: mulberry32(seed),
  };
  refillShapes(room);
  return room;
}

export function addPlayer(room: GameRoom, options: AddPlayerOptions): MatchPlayer {
  const position = randomSpawn(room);
  const player: MatchPlayer = {
    id: options.id,
    profileId: options.profileId,
    name: cleanName(options.name),
    bot: options.bot ?? false,
    tankId: 'basic',
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    aim: 0,
    xp: 0,
    level: 1,
    score: 0,
    sessionXp: 0,
    stats: { ...DEFAULT_STATS },
    health: 102,
    alive: true,
    respawnMs: 0,
    invulnerableMs: 1500,
    reloads: {},
    stealthMs: 0,
    revealedMs: 0,
    kills: 0,
    deaths: 0,
    color: options.color ?? (options.bot ? '#ff6b7a' : '#35d0ff'),
    input: defaultInput(room.now),
    botThinkMs: 0,
    joinedAt: room.now,
    bestTankId: 'basic',
  };
  player.health = deriveTankStats(player.tankId, player.level, player.stats).maxHealth;
  room.players.set(player.id, player);
  pushEvent(room, 'system', `${player.name} entered the arena.`);
  return player;
}

export function removePlayer(room: GameRoom, playerId: string): MatchPlayer | undefined {
  const player = room.players.get(playerId);
  if (!player) return undefined;
  room.players.delete(playerId);
  for (const projectile of [...room.projectiles.values()]) {
    if (projectile.ownerId === playerId) room.projectiles.delete(projectile.id);
  }
  pushEvent(room, 'system', `${player.name} left the arena.`);
  return player;
}

export function setPlayerInput(room: GameRoom, playerId: string, input: ClientInputPayload): void {
  const player = room.players.get(playerId);
  if (!player) return;
  const aim = normalizeAimInput(input.aimX, input.aimY);
  player.input = {
    moveX: clamp(input.moveX, -1, 1),
    moveY: clamp(input.moveY, -1, 1),
    aimX: aim.x,
    aimY: aim.y,
    fire: input.fire,
    altFire: input.altFire,
    autoFire: input.autoFire,
    autoSpin: input.autoSpin,
    lastSeenAt: room.now,
  };
}

export function upgradePlayerStat(room: GameRoom, playerId: string, stat: StatKey): boolean {
  const player = room.players.get(playerId);
  if (!player || !player.alive) return false;
  if (availableStatPoints(player.level, player.stats) <= 0) return false;
  if (!canAllocateStat(player.tankId, player.stats, stat)) return false;
  player.stats = {
    ...player.stats,
    [stat]: player.stats[stat] + 1,
  };
  const derived = deriveTankStats(player.tankId, player.level, player.stats);
  player.health = Math.min(derived.maxHealth, player.health + 16);
  return true;
}

export function upgradePlayerTank(room: GameRoom, playerId: string, tankId: string): boolean {
  const player = room.players.get(playerId);
  if (!player || !player.alive) return false;
  if (!canUpgradeTank(player.tankId, tankId, player.level)) return false;
  const previousTankId = player.tankId;
  player.tankId = tankId;
  player.bestTankId = tankId;
  player.stats = normalizeStatsForTank(tankId, player.stats);
  player.reloads = {};
  const derived = deriveTankStats(player.tankId, player.level, player.stats);
  player.health = Math.min(derived.maxHealth, player.health + 24);
  pushEvent(room, 'upgrade', `${player.name} upgraded ${display(previousTankId)} to ${display(tankId)}.`);
  return true;
}

export function updateRoom(room: GameRoom, dtMs: number): SimulationDeath[] {
  const deaths: SimulationDeath[] = [];
  const dt = Math.min(64, Math.max(1, dtMs)) / 1000;
  room.now += dtMs;

  for (const player of room.players.values()) {
    if (player.bot) updateBot(room, player, dtMs);
    updatePlayer(room, player, dt, dtMs);
  }

  for (const projectile of [...room.projectiles.values()]) {
    updateProjectile(room, projectile, dt, dtMs);
  }

  resolveProjectileCollisions(room, deaths);
  resolveBodyCollisions(room, deaths, dt);
  refillShapes(room);
  trimEvents(room);
  return deaths;
}

export function snapshotForPlayer(room: GameRoom, playerId: string): GameSnapshot {
  const self = room.players.get(playerId) ?? [...room.players.values()][0];
  const selfDerived = self ? deriveTankStats(self.tankId, self.level, self.stats) : undefined;
  const visibleRadius = 1200 * (selfDerived?.fovMultiplier ?? 1);
  const players = [...room.players.values()]
    .filter((player) => !self || distance(player, self) <= visibleRadius || player.id === self.id)
    .map((player) => {
      const derived = deriveTankStats(player.tankId, player.level, player.stats);
      const invisible =
        player.id !== self?.id &&
        getTankClass(player.tankId).abilities.includes('invisibility') &&
        player.stealthMs > 2000 &&
        player.revealedMs <= 0;
      return {
        id: player.id,
        name: player.name,
        tankId: player.tankId,
        bot: player.bot,
        x: round(player.x),
        y: round(player.y),
        aim: round(player.aim),
        radius: round(derived.radius),
        health: round(player.health),
        maxHealth: round(derived.maxHealth),
        level: player.level,
        score: Math.floor(player.score),
        color: player.color,
        invisible,
        kills: player.kills,
        deaths: player.deaths,
      };
    });

  const shapes = [...room.shapes.values()]
    .filter((shape) => !self || distance(shape, self) <= visibleRadius + 240)
    .map((shape) => ({
      id: shape.id,
      shape: shape.shape,
      x: round(shape.x),
      y: round(shape.y),
      radius: shape.radius,
      hp: round(shape.hp),
      maxHp: shape.maxHp,
      rotation: round(shape.rotation),
    }));

  const projectiles = [...room.projectiles.values()]
    .filter((projectile) => !self || distance(projectile, self) <= visibleRadius + 240)
    .map((projectile) => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
      kind: projectile.kind,
      x: round(projectile.x),
      y: round(projectile.y),
      radius: round(projectile.radius),
      color: projectile.color,
    }));

  const fallbackSelf = self ?? addPlayer(room, { id: nextId(room, 'fallback'), name: 'Pilot' });
  const selfState = {
    id: fallbackSelf.id,
    tankId: fallbackSelf.tankId,
    level: fallbackSelf.level,
    xp: Math.floor(fallbackSelf.xp),
    score: Math.floor(fallbackSelf.score),
    stats: fallbackSelf.stats,
    availableStatPoints: availableStatPoints(fallbackSelf.level, fallbackSelf.stats),
    upgradeOptions: upgradeOptions(fallbackSelf.tankId, fallbackSelf.level).map((tankClass) => tankClass.id),
    alive: fallbackSelf.alive,
    respawnMs: Math.max(0, Math.ceil(fallbackSelf.respawnMs)),
    sessionXp: Math.floor(fallbackSelf.sessionXp),
  };

  return {
    type: 'snapshot',
    roomId: room.id,
    selfId: fallbackSelf.id,
    now: room.now,
    world: {
      width: room.width,
      height: room.height,
    },
    self: selfState,
    players,
    projectiles,
    shapes,
    leaderboard: [...room.players.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: Math.floor(player.score),
        level: player.level,
        tankId: player.tankId,
        bot: player.bot,
      })),
  };
}

export function summarizePlayer(player: MatchPlayer, room: GameRoom): SimulationDeath {
  return {
    type: 'death',
    victimId: player.id,
    victimProfileId: player.profileId,
    victimName: player.name,
    victimTankId: player.bestTankId,
    xpEarned: Math.floor(player.sessionXp),
    score: Math.floor(player.score),
    kills: player.kills,
    deaths: player.deaths,
    durationSeconds: Math.max(0, Math.floor((room.now - player.joinedAt) / 1000)),
  };
}

function updatePlayer(room: GameRoom, player: MatchPlayer, dt: number, dtMs: number): void {
  if (!player.alive) {
    player.respawnMs -= dtMs;
    if (player.respawnMs <= 0) respawnPlayer(room, player);
    return;
  }

  const tankClass = getTankClass(player.tankId);
  const derived = deriveTankStats(player.tankId, player.level, player.stats);
  player.invulnerableMs = Math.max(0, player.invulnerableMs - dtMs);
  player.revealedMs = Math.max(0, player.revealedMs - dtMs);

  if (player.input.autoSpin) {
    player.aim += dt * 0.9;
  } else if (Math.hypot(player.input.aimX, player.input.aimY) > INPUT_DEADZONE) {
    player.aim = Math.atan2(player.input.aimY, player.input.aimX);
  }

  const moveLength = Math.hypot(player.input.moveX, player.input.moveY);
  const moveX = moveLength > INPUT_DEADZONE ? player.input.moveX / moveLength : 0;
  const moveY = moveLength > INPUT_DEADZONE ? player.input.moveY / moveLength : 0;
  player.vx = moveX * derived.moveSpeed;
  player.vy = moveY * derived.moveSpeed;
  player.x = clamp(player.x + player.vx * dt, derived.radius, room.width - derived.radius);
  player.y = clamp(player.y + player.vy * dt, derived.radius, room.height - derived.radius);

  player.health = Math.min(derived.maxHealth, player.health + derived.regenPerSecond * dt);

  const isTryingToShoot = player.input.fire || player.input.autoFire || player.input.altFire;
  if (tankClass.abilities.includes('invisibility') && !isTryingToShoot && moveLength <= INPUT_DEADZONE) {
    player.stealthMs += dtMs;
  } else {
    player.stealthMs = 0;
  }
  if (isTryingToShoot) player.revealedMs = 800;

  for (const key of Object.keys(player.reloads)) {
    player.reloads[key] = Math.max(0, player.reloads[key] - dtMs);
  }

  fireWeapons(room, player, derived);
}

function fireWeapons(room: GameRoom, player: MatchPlayer, derived: ReturnType<typeof deriveTankStats>): void {
  const tankClass = getTankClass(player.tankId);
  if (tankClass.weaponLayout.length === 0) return;

  for (const weapon of tankClass.weaponLayout) {
    const wantsPrimary = player.input.fire || player.input.autoFire || weapon.autoAim;
    const wantsAlt = weapon.altFire && player.input.altFire;
    if (weapon.altFire ? !wantsAlt : !wantsPrimary) continue;
    if (weapon.autoAim && !nearestTarget(room, player, 780)) continue;
    if ((player.reloads[weapon.id] ?? 0) > 0) continue;
    if ((weapon.projectile.kind === 'drone' || weapon.projectile.kind === 'minion') && countOwnerProjectiles(room, player.id, weapon.projectile.kind) >= (tankClass.maxDrones ?? 8)) {
      continue;
    }

    spawnProjectile(room, player, weapon, derived);
    player.reloads[weapon.id] = weapon.reloadMs * derived.reloadMultiplier + (weapon.staggerMs ?? 0);
  }
}

function spawnProjectile(room: GameRoom, player: MatchPlayer, weapon: WeaponMount, derived: ReturnType<typeof deriveTankStats>): void {
  const profile = weapon.projectile;
  const target = weapon.autoAim ? nearestTarget(room, player, 880) : undefined;
  const angle =
    target !== undefined
      ? Math.atan2(target.y - player.y, target.x - player.x)
      : player.aim + degToRad(weapon.angleDeg) + degToRad(((room.rng() * 2 - 1) * (weapon.spreadDeg ?? 0)));
  const speed = profile.speed * derived.bulletSpeedMultiplier * (weapon.speedScale ?? 1);
  const radius = profile.radius * (weapon.sizeScale ?? 1);
  const muzzle = derived.radius + weapon.offset + weapon.length * 0.35;
  const projectile: MatchProjectile = {
    id: nextId(room, 'p'),
    ownerId: player.id,
    kind: profile.kind,
    x: player.x + Math.cos(angle) * muzzle,
    y: player.y + Math.sin(angle) * muzzle,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    damage: profile.damage * derived.bulletDamageMultiplier * (weapon.damageScale ?? 1),
    penetration: profile.penetration * derived.bulletPenetrationMultiplier * (weapon.damageScale ?? 1),
    lifeMs: profile.lifetimeMs * (weapon.lifetimeScale ?? 1),
    maxLifeMs: profile.lifetimeMs * (weapon.lifetimeScale ?? 1),
    color: player.color,
    turnRate: profile.turnRate,
    dampingAfterMs: profile.dampingAfterMs,
    splitCount: profile.splitCount,
  };

  if (profile.kind === 'drone' || profile.kind === 'minion' || profile.kind === 'missile') {
    const aimDistance = 360;
    projectile.targetX = target?.x ?? player.x + Math.cos(player.aim) * aimDistance;
    projectile.targetY = target?.y ?? player.y + Math.sin(player.aim) * aimDistance;
  }

  room.projectiles.set(projectile.id, projectile);

  const recoil = (weapon.recoil ?? 0) * 0.08;
  player.x = clamp(player.x - Math.cos(angle) * recoil, 0, room.width);
  player.y = clamp(player.y - Math.sin(angle) * recoil, 0, room.height);
}

function updateProjectile(room: GameRoom, projectile: MatchProjectile, dt: number, dtMs: number): void {
  projectile.lifeMs -= dtMs;
  if (projectile.lifeMs <= 0) {
    if (projectile.splitCount && projectile.splitCount > 0) splitProjectile(room, projectile);
    room.projectiles.delete(projectile.id);
    return;
  }

  if (projectile.turnRate && projectile.targetX !== undefined && projectile.targetY !== undefined) {
    const desired = Math.atan2(projectile.targetY - projectile.y, projectile.targetX - projectile.x);
    const current = Math.atan2(projectile.vy, projectile.vx);
    const next = rotateToward(current, desired, projectile.turnRate * dt);
    const speed = Math.hypot(projectile.vx, projectile.vy);
    projectile.vx = Math.cos(next) * speed;
    projectile.vy = Math.sin(next) * speed;
  }

  if (projectile.dampingAfterMs && projectile.maxLifeMs - projectile.lifeMs > projectile.dampingAfterMs) {
    projectile.vx *= 0.93;
    projectile.vy *= 0.93;
  }

  projectile.x += projectile.vx * dt;
  projectile.y += projectile.vy * dt;

  if (projectile.x < -80 || projectile.x > room.width + 80 || projectile.y < -80 || projectile.y > room.height + 80) {
    room.projectiles.delete(projectile.id);
  }
}

function resolveProjectileCollisions(room: GameRoom, deaths: SimulationDeath[]): void {
  for (const projectile of [...room.projectiles.values()]) {
    for (const shape of [...room.shapes.values()]) {
      if (!circlesOverlap(projectile, shape)) continue;
      shape.hp -= projectile.damage;
      projectile.penetration -= shape.radius * 1.6;
      if (shape.hp <= 0) {
        room.shapes.delete(shape.id);
        awardXp(room, projectile.ownerId, shape.xp, shape.xp);
      }
      if (projectile.penetration <= 0) {
        room.projectiles.delete(projectile.id);
        break;
      }
    }

    if (!room.projectiles.has(projectile.id)) continue;

    for (const player of room.players.values()) {
      if (!player.alive || player.id === projectile.ownerId || player.invulnerableMs > 0) continue;
      const derived = deriveTankStats(player.tankId, player.level, player.stats);
      if (!circleValuesOverlap(projectile.x, projectile.y, projectile.radius, player.x, player.y, derived.radius)) continue;
      damagePlayer(room, player, projectile.damage, projectile.ownerId, deaths);
      projectile.penetration -= derived.radius * 2;
      if (projectile.penetration <= 0) {
        room.projectiles.delete(projectile.id);
        break;
      }
    }
  }
}

function resolveBodyCollisions(room: GameRoom, deaths: SimulationDeath[], dt: number): void {
  const players = [...room.players.values()].filter((player) => player.alive);
  for (const player of players) {
    const playerDerived = deriveTankStats(player.tankId, player.level, player.stats);
    for (const shape of [...room.shapes.values()]) {
      if (!circleValuesOverlap(player.x, player.y, playerDerived.radius, shape.x, shape.y, shape.radius)) continue;
      const damage = playerDerived.bodyDamage * dt * 2.4;
      shape.hp -= damage;
      if (player.invulnerableMs <= 0) player.health -= Math.max(2, shape.radius * 0.16) * dt * 18;
      separate(player, shape, playerDerived.radius, shape.radius, 0.45);
      if (shape.hp <= 0) {
        room.shapes.delete(shape.id);
        awardXp(room, player.id, shape.xp, shape.xp);
      }
      if (player.health <= 0) killPlayer(room, player, undefined, deaths);
    }
  }

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const aDerived = deriveTankStats(a.tankId, a.level, a.stats);
      const bDerived = deriveTankStats(b.tankId, b.level, b.stats);
      if (!circleValuesOverlap(a.x, a.y, aDerived.radius, b.x, b.y, bDerived.radius)) continue;
      if (a.invulnerableMs <= 0) damagePlayer(room, a, bDerived.bodyDamage * dt * 2.2, b.id, deaths);
      if (b.invulnerableMs <= 0) damagePlayer(room, b, aDerived.bodyDamage * dt * 2.2, a.id, deaths);
      separate(a, b, aDerived.radius, bDerived.radius, 0.5);
    }
  }
}

function damagePlayer(room: GameRoom, player: MatchPlayer, damage: number, attackerId: string | undefined, deaths: SimulationDeath[]): void {
  player.health -= damage;
  player.revealedMs = 800;
  if (player.health <= 0) killPlayer(room, player, attackerId, deaths);
}

function killPlayer(room: GameRoom, victim: MatchPlayer, killerId: string | undefined, deaths: SimulationDeath[]): void {
  if (!victim.alive) return;
  const killer = killerId ? room.players.get(killerId) : undefined;
  victim.alive = false;
  victim.respawnMs = PLAYER_RESPAWN_MS;
  victim.deaths += 1;
  victim.health = 0;
  victim.revealedMs = 1200;
  if (killer && killer.id !== victim.id) {
    killer.kills += 1;
    awardXp(room, killer.id, Math.max(120, victim.score * 0.08), Math.max(120, victim.score * 0.08));
    pushEvent(room, 'kill', `${killer.name} destroyed ${victim.name}.`);
  } else {
    pushEvent(room, 'kill', `${victim.name} was destroyed.`);
  }
  deaths.push({
    type: 'death',
    victimId: victim.id,
    killerId: killer?.id,
    victimProfileId: victim.profileId,
    killerProfileId: killer?.profileId,
    victimName: victim.name,
    killerName: killer?.name,
    victimTankId: victim.bestTankId,
    xpEarned: Math.floor(victim.sessionXp),
    score: Math.floor(victim.score),
    kills: victim.kills,
    deaths: victim.deaths,
    durationSeconds: Math.max(0, Math.floor((room.now - victim.joinedAt) / 1000)),
  });

  for (const projectile of [...room.projectiles.values()]) {
    if (projectile.ownerId === victim.id) room.projectiles.delete(projectile.id);
  }
}

function respawnPlayer(room: GameRoom, player: MatchPlayer): void {
  const position = randomSpawn(room);
  player.x = position.x;
  player.y = position.y;
  player.vx = 0;
  player.vy = 0;
  player.tankId = 'basic';
  player.bestTankId = 'basic';
  player.xp = 0;
  player.level = 1;
  player.score = 0;
  player.stats = { ...DEFAULT_STATS };
  player.reloads = {};
  player.alive = true;
  player.respawnMs = 0;
  player.invulnerableMs = 1500;
  player.stealthMs = 0;
  player.revealedMs = 0;
  player.joinedAt = room.now;
  player.sessionXp = 0;
  player.health = deriveTankStats(player.tankId, player.level, player.stats).maxHealth;
}

function awardXp(room: GameRoom, playerId: string, xp: number, score: number): void {
  const player = room.players.get(playerId);
  if (!player || !player.alive) return;
  const previousLevel = player.level;
  player.xp += xp;
  player.sessionXp += xp;
  player.score += score;
  player.level = levelForXp(player.xp);
  if (player.level > previousLevel) {
    const derived = deriveTankStats(player.tankId, player.level, player.stats);
    player.health = Math.min(derived.maxHealth, player.health + (player.level - previousLevel) * 18);
    pushEvent(room, 'level', `${player.name} reached level ${player.level}.`);
  }
}

function updateBot(room: GameRoom, bot: MatchPlayer, dtMs: number): void {
  bot.botThinkMs -= dtMs;
  if (bot.botThinkMs <= 0) {
    bot.botThinkMs = 220 + room.rng() * 240;
    bot.botTargetId = chooseBotTarget(room, bot);
    spendBotPoints(room, bot);
  }

  const target = bot.botTargetId ? findTargetById(room, bot.botTargetId) : undefined;
  if (!target) {
    bot.input = {
      ...bot.input,
      moveX: room.rng() * 2 - 1,
      moveY: room.rng() * 2 - 1,
      fire: false,
      autoFire: true,
      lastSeenAt: room.now,
    };
    return;
  }

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const distanceToTarget = Math.max(1, Math.hypot(dx, dy));
  const desiredRange = getTankClass(bot.tankId).tags.includes('range') ? 620 : 360;
  const direction = distanceToTarget > desiredRange ? 1 : -0.35;
  bot.input = {
    ...bot.input,
    moveX: (dx / distanceToTarget) * direction,
    moveY: (dy / distanceToTarget) * direction,
    aimX: dx / distanceToTarget,
    aimY: dy / distanceToTarget,
    fire: true,
    autoFire: true,
    altFire: distanceToTarget < 460,
    lastSeenAt: room.now,
  };
}

function spendBotPoints(room: GameRoom, bot: MatchPlayer): void {
  const priorities: StatKey[] = getTankClass(bot.tankId).tags.includes('rammer')
    ? ['movementSpeed', 'bodyDamage', 'maxHealth', 'healthRegen']
    : ['reload', 'bulletDamage', 'bulletPenetration', 'bulletSpeed', 'movementSpeed', 'maxHealth'];

  while (availableStatPoints(bot.level, bot.stats) > 0) {
    const stat = priorities.find((key) => canAllocateStat(bot.tankId, bot.stats, key));
    if (!stat) break;
    upgradePlayerStat(room, bot.id, stat);
  }

  const options = upgradeOptions(bot.tankId, bot.level);
  if (options.length > 0) {
    const chosen = options[Math.floor(room.rng() * options.length)];
    upgradePlayerTank(room, bot.id, chosen.id);
  }
}

function chooseBotTarget(room: GameRoom, bot: MatchPlayer): string | undefined {
  const enemyPlayers = [...room.players.values()]
    .filter((player) => player.id !== bot.id && player.alive && distance(player, bot) < 780)
    .sort((a, b) => distance(a, bot) - distance(b, bot));
  if (enemyPlayers[0] && (bot.level >= enemyPlayers[0].level - 4 || distance(enemyPlayers[0], bot) < 280)) {
    return enemyPlayers[0].id;
  }
  return [...room.shapes.values()].sort((a, b) => scoreShapeTarget(a, bot) - scoreShapeTarget(b, bot))[0]?.id;
}

function scoreShapeTarget(shape: MatchShape, bot: MatchPlayer): number {
  const valueBias = shape.shape === 'alpha_pentagon' ? -600 : shape.shape === 'pentagon' ? -180 : 0;
  return distance(shape, bot) + valueBias;
}

function findTargetById(room: GameRoom, id: string): { x: number; y: number } | undefined {
  return room.players.get(id) ?? room.shapes.get(id);
}

function nearestTarget(room: GameRoom, player: MatchPlayer, maxDistance: number): { x: number; y: number } | undefined {
  const candidates = [
    ...[...room.players.values()].filter((other) => other.id !== player.id && other.alive),
    ...room.shapes.values(),
  ];
  return candidates
    .filter((target) => distance(target, player) <= maxDistance)
    .sort((a, b) => distance(a, player) - distance(b, player))[0];
}

function refillShapes(room: GameRoom): void {
  while (room.shapes.size < MAX_SHAPES) {
    const roll = room.rng();
    const shape: ShapeKind = roll > 0.985 ? 'alpha_pentagon' : roll > 0.82 ? 'pentagon' : roll > 0.48 ? 'triangle' : 'square';
    const stats =
      shape === 'alpha_pentagon'
        ? { radius: 42, hp: 440, xp: 820 }
        : shape === 'pentagon'
          ? { radius: 28, hp: 130, xp: 145 }
          : shape === 'triangle'
            ? { radius: 19, hp: 48, xp: 46 }
            : { radius: 17, hp: 28, xp: 24 };
    room.shapes.set(nextId(room, 's'), {
      id: `s-${room.sequence}`,
      shape,
      x: 80 + room.rng() * (room.width - 160),
      y: 80 + room.rng() * (room.height - 160),
      radius: stats.radius,
      hp: stats.hp,
      maxHp: stats.hp,
      xp: stats.xp,
      rotation: room.rng() * Math.PI * 2,
    });
  }

  for (const shape of room.shapes.values()) {
    shape.rotation += shape.shape === 'alpha_pentagon' ? 0.002 : 0.004;
  }
}

function randomSpawn(room: GameRoom): { x: number; y: number } {
  return {
    x: 160 + room.rng() * (room.width - 320),
    y: 160 + room.rng() * (room.height - 320),
  };
}

function cleanName(name: string): string {
  const cleaned = name.replace(/[^\w .-]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 18) : 'Pilot';
}

function pushEvent(room: GameRoom, type: SnapshotEvent['type'], message: string): void {
  room.events.push({
    id: nextId(room, 'e'),
    type,
    message,
    at: room.now,
  });
}

function trimEvents(room: GameRoom): void {
  if (room.events.length > 50) room.events.splice(0, room.events.length - 50);
}

function splitProjectile(room: GameRoom, projectile: MatchProjectile): void {
  const count = projectile.splitCount ?? 0;
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const child: MatchProjectile = {
      ...projectile,
      id: nextId(room, 'p'),
      vx: Math.cos(angle) * 520,
      vy: Math.sin(angle) * 520,
      radius: Math.max(4, projectile.radius * 0.42),
      damage: projectile.damage * 0.22,
      penetration: projectile.penetration * 0.18,
      lifeMs: 520,
      maxLifeMs: 520,
      splitCount: undefined,
    };
    room.projectiles.set(child.id, child);
  }
}

function countOwnerProjectiles(room: GameRoom, ownerId: string, kind: ProjectileKind): number {
  let count = 0;
  for (const projectile of room.projectiles.values()) {
    if (projectile.ownerId === ownerId && projectile.kind === kind) count += 1;
  }
  return count;
}

function nextId(room: GameRoom, prefix: string): string {
  room.sequence += 1;
  return `${prefix}-${room.sequence}`;
}

function display(tankId: string): string {
  return TANK_CLASSES_BY_ID[tankId]?.displayName ?? tankId;
}

function normalizeAimInput(x: number, y: number): { x: number; y: number } {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const length = Math.hypot(safeX, safeY);
  if (length <= INPUT_DEADZONE) return { x: 0, y: 0 };
  return {
    x: safeX / length,
    y: safeY / length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function circlesOverlap(a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): boolean {
  return circleValuesOverlap(a.x, a.y, a.radius, b.x, b.y, b.radius);
}

function circleValuesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  return Math.hypot(ax - bx, ay - by) <= ar + br;
}

function separate(
  a: { x: number; y: number },
  b: { x: number; y: number },
  ar: number,
  br: number,
  strength: number,
): void {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const overlap = Math.max(0, ar + br - length);
  a.x += (dx / length) * overlap * strength;
  a.y += (dy / length) * overlap * strength;
}

function rotateToward(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + clamp(delta, -maxStep, maxStep);
}
