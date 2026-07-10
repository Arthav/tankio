import type { GameSnapshot, SnapshotProjectile, SnapshotShape, SnapshotTank } from '../shared/protocol';
import { lerp, lerpAngle } from './math';

export function interpolateSnapshots(previous: GameSnapshot, next: GameSnapshot, alpha: number): GameSnapshot {
  const previousPlayers = keyed(previous.players);
  const previousProjectiles = keyed(previous.projectiles);
  const previousShapes = keyed(previous.shapes);

  return {
    ...next,
    now: lerp(previous.now, next.now, alpha),
    players: next.players.map((player) => interpolateTank(previousPlayers.get(player.id), player, alpha)),
    projectiles: next.projectiles.map((projectile) => interpolateProjectile(previousProjectiles.get(projectile.id), projectile, alpha)),
    shapes: next.shapes.map((shape) => interpolateShape(previousShapes.get(shape.id), shape, alpha)),
  };
}

function interpolateTank(previous: SnapshotTank | undefined, next: SnapshotTank, alpha: number): SnapshotTank {
  if (!previous) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    aim: lerpAngle(previous.aim, next.aim, alpha),
    radius: lerp(previous.radius, next.radius, alpha),
    health: lerp(previous.health, next.health, alpha),
    maxHealth: lerp(previous.maxHealth, next.maxHealth, alpha),
  };
}

function interpolateProjectile(previous: SnapshotProjectile | undefined, next: SnapshotProjectile, alpha: number): SnapshotProjectile {
  if (!previous || previous.kind !== next.kind) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    radius: lerp(previous.radius, next.radius, alpha),
  };
}

function interpolateShape(previous: SnapshotShape | undefined, next: SnapshotShape, alpha: number): SnapshotShape {
  if (!previous || previous.shape !== next.shape) return next;
  return {
    ...next,
    x: lerp(previous.x, next.x, alpha),
    y: lerp(previous.y, next.y, alpha),
    hp: lerp(previous.hp, next.hp, alpha),
    rotation: lerpAngle(previous.rotation, next.rotation, alpha),
  };
}

function keyed<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}
