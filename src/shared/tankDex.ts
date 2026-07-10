import { DEFAULT_STATS, deriveTankStats, statCapsForTank } from './progression';
import type { TankAbility, TankClassDefinition } from './tankTypes';
import { getTankClass, TANK_CLASSES } from './tanks';

export type TankPowerKey = 'damage' | 'fireRate' | 'range' | 'mobility' | 'survivability' | 'utility';

export type TankPowerBars = Record<TankPowerKey, number>;

export interface TankDexMetadata {
  role: string;
  description: string;
  playstyle: string;
}

export interface TankDexPathSegment {
  fromTankId: string;
  fromDisplayName: string;
  toTankId: string;
  toDisplayName: string;
  requiredLevel: 15 | 30 | 45;
  requiresSkippedUpgrade: boolean;
}

export interface TankDexUpgradePath {
  tankIds: string[];
  displayNames: string[];
  segments: TankDexPathSegment[];
}

export interface TankDexEntry {
  tank: TankClassDefinition;
  metadata: TankDexMetadata;
  power: TankPowerBars;
  paths: TankDexUpgradePath[];
  abilityLabels: string[];
  traits: string[];
  weaponSummary: string;
  statCapSummary: string;
}

export const TANK_DEX_METADATA: Record<string, TankDexMetadata> = {
  basic: {
    role: 'Starter Cannon',
    description: 'Balanced starter tank with one reliable cannon and no special mechanics.',
    playstyle: 'Use it to farm early shapes, learn spacing, and choose a level 15 branch once your run has direction.',
  },
  twin: {
    role: 'Dual Stream',
    description: 'Two close barrels trade single-shot punch for steadier bullet pressure.',
    playstyle: 'Hold lanes with constant fire and build toward multi-barrel spread or flank control.',
  },
  sniper: {
    role: 'Long Range',
    description: 'A slower cannon with stronger reach and a wider field of view.',
    playstyle: 'Stay at distance, farm safely, and prepare for precision, drone, hunter, or trap branches.',
  },
  machine_gun: {
    role: 'Rapid Spray',
    description: 'Fast reload and light bullets make it the first aggressive pressure branch.',
    playstyle: 'Keep the muzzle active, deny space, and upgrade into heavy burst, stream, shotgun, or skipped Sprayer.',
  },
  flank_guard: {
    role: 'Two-Way Control',
    description: 'Front and rear cannons cover both sides while keeping Basic-style handling.',
    playstyle: 'Use the rear barrel to punish chasers and open radial, recoil, and auto-turret routes.',
  },
  triple_shot: {
    role: 'Spread Fighter',
    description: 'Three forward barrels widen your threat cone and make dodging harder.',
    playstyle: 'Aim near enemies rather than directly at them and use the spread to control corridors.',
  },
  quad_tank: {
    role: 'Radial Guard',
    description: 'Four barrels cover every cardinal direction with steady area pressure.',
    playstyle: 'Spin or rotate through targets to farm safely and build toward wider radial or auto coverage.',
  },
  twin_flank: {
    role: 'Dual Flanker',
    description: 'Twin barrels fire forward and backward for stronger chase resistance.',
    playstyle: 'Fight while retreating, crossfire around shapes, and unlock radial or drone-flank hybrids.',
  },
  assassin: {
    role: 'Precision Range',
    description: 'A deeper sniper branch with stronger reach and slower, more deliberate shots.',
    playstyle: 'Pick targets from outside their comfort range and avoid close fights while reloading.',
  },
  overseer: {
    role: 'Drone Commander',
    description: 'Launches controllable drones instead of bullets and gains a wider tactical view.',
    playstyle: 'Fight by positioning drones, not the body, and pressure enemies from angles they cannot ignore.',
  },
  hunter: {
    role: 'Burst Marksman',
    description: 'Layered shots create a compact burst that rewards clean aim.',
    playstyle: 'Time volleys into enemy movement and branch into focused Predator or sustained Streamliner fire.',
  },
  trapper: {
    role: 'Zone Builder',
    description: 'Fires durable traps that slow fights down and defend territory.',
    playstyle: 'Lay traps around escape routes, shape clusters, and objectives before committing.',
  },
  destroyer: {
    role: 'Heavy Cannon',
    description: 'Slow reload and massive projectiles create lethal single-shot pressure.',
    playstyle: 'Make each shot count, use recoil carefully, and force enemies to respect your burst window.',
  },
  gunner: {
    role: 'Bullet Stream',
    description: 'Small barrels pour out rapid low-damage rounds with excellent consistency.',
    playstyle: 'Track targets continuously and use the stream to chip, farm, and pin evasive enemies.',
  },
  shotgun: {
    role: 'Close Burst',
    description: 'A wide pellet blast creates dangerous short-range burst damage.',
    playstyle: 'Ambush around shapes, fire at close range, and disengage while the volley reloads.',
  },
  tri_angle: {
    role: 'Recoil Runner',
    description: 'Rear cannons push the body forward while a front cannon keeps pressure ahead.',
    playstyle: 'Use recoil movement to chase, escape, and convert speed into better fight angles.',
  },
  auto_3: {
    role: 'Auto Triangle',
    description: 'Three auto turrets fire independently while the body keeps moving.',
    playstyle: 'Let the turrets handle nearby threats while you focus on positioning and farming routes.',
  },
  smasher: {
    role: 'Body Rammer',
    description: 'A skipped-upgrade body tank with no weapons and much higher body stat caps.',
    playstyle: 'Commit to contact damage, dodge bullets, and invest in health, body damage, regen, and movement.',
  },
  triplet: {
    role: 'Focused Stream',
    description: 'Three tight barrels create one of the strongest forward bullet streams.',
    playstyle: 'Face the target, keep firing, and win with sustained pressure instead of spread.',
  },
  penta_shot: {
    role: 'Wide Spread',
    description: 'Five forward barrels cover a broad arc with constant bullet traffic.',
    playstyle: 'Control space, farm wide clusters, and punish enemies that try to dodge sideways.',
  },
  spread_shot: {
    role: 'Fan Barrage',
    description: 'A strong center shot backed by many mini shots creates a huge firing fan.',
    playstyle: 'Keep enemies inside the fan and use the center cannon for the real finishing pressure.',
  },
  octo_tank: {
    role: 'Full Radial',
    description: 'Eight barrels cover every angle and make the tank naturally spin-friendly.',
    playstyle: 'Rotate through the arena while farming and let constant radial fire deny approaches.',
  },
  auto_5: {
    role: 'Auto Screen',
    description: 'Five auto turrets create broad independent coverage around the body.',
    playstyle: 'Stay mobile while turrets punish nearby enemies and clean up small threats.',
  },
  triple_twin: {
    role: 'Triple Flank',
    description: 'Three twin pairs fire around the body for dense radial bullet coverage.',
    playstyle: 'Use the six barrels to control crowds and survive pressure from multiple angles.',
  },
  battleship: {
    role: 'Drone Swarm',
    description: 'Fast, short-lived drones create a loose swarm around the fight.',
    playstyle: 'Flood space with drones, keep moving, and overwhelm targets through repeated contact.',
  },
  ranger: {
    role: 'Extreme Range',
    description: 'The longest sniper branch with very high reach and a large field of view.',
    playstyle: 'Play patiently from maximum distance and punish enemies before they can answer.',
  },
  stalker: {
    role: 'Stealth Sniper',
    description: 'A sniper branch that can turn invisible while still and not firing.',
    playstyle: 'Hide, line up the first shot, then reposition before enemies collapse on you.',
  },
  overlord: {
    role: 'Drone Control',
    description: 'Four drone launchers give strong command over a compact drone group.',
    playstyle: 'Trap enemies between your body and drones while keeping your tank out of danger.',
  },
  necromancer: {
    role: 'Swarm Controller',
    description: 'Square body and high drone cap support a larger drone swarm identity.',
    playstyle: 'Build pressure through numbers and use the swarm to block movement paths.',
  },
  manager: {
    role: 'Stealth Drone',
    description: 'A single drone launcher combines with invisibility for ambush pressure.',
    playstyle: 'Disappear when safe, reposition drones, and force enemies to guess where the body is.',
  },
  overtrapper: {
    role: 'Hybrid Zone',
    description: 'Combines traps and drones for layered defense and remote pressure.',
    playstyle: 'Anchor space with traps, then use drones to punish enemies who hesitate.',
  },
  factory: {
    role: 'Minion Control',
    description: 'Launches minions that behave like a heavier controlled swarm.',
    playstyle: 'Fight through minion positioning and protect your body while your army takes space.',
  },
  predator: {
    role: 'Focused Burst',
    description: 'A multi-layer hunter burst with extra focus-oriented range behavior.',
    playstyle: 'Line up volleys carefully and use the burst rhythm to delete exposed targets.',
  },
  streamliner: {
    role: 'Needle Stream',
    description: 'Very fast staggered mini shots create a thin, relentless stream.',
    playstyle: 'Track precisely and melt targets that stay inside the firing line.',
  },
  tri_trapper: {
    role: 'Radial Traps',
    description: 'Three trap launchers build defensive zones in multiple directions.',
    playstyle: 'Layer traps around the body and make enemies fight through prepared ground.',
  },
  gunner_trapper: {
    role: 'Stream Defense',
    description: 'Forward gunner barrels pair with a rear trap launcher.',
    playstyle: 'Pressure ahead with bullets while leaving traps behind to block pursuit.',
  },
  mega_trapper: {
    role: 'Heavy Traps',
    description: 'A single larger trap launcher creates stronger defensive anchors.',
    playstyle: 'Place fewer but more meaningful traps and fight around them.',
  },
  auto_trapper: {
    role: 'Auto Defense',
    description: 'Trap placement combines with an auto turret for safer zone control.',
    playstyle: 'Build a trap line and let the turret punish enemies that get too close.',
  },
  hybrid: {
    role: 'Heavy Drone',
    description: 'A destroyer cannon backed by a small drone threat.',
    playstyle: 'Use the heavy shot as the main threat while drones add pressure during reloads.',
  },
  annihilator: {
    role: 'Huge Cannon',
    description: 'The destroyer idea pushed further with an even larger, harder-hitting shot.',
    playstyle: 'Play around reload windows and use recoil plus threat pressure to control fights.',
  },
  skimmer: {
    role: 'Missile Heavy',
    description: 'Fires guided missile-style projectiles from a heavy cannon frame.',
    playstyle: 'Use missile steering to pressure targets that would dodge ordinary heavy shots.',
  },
  rocketeer: {
    role: 'Power Missile',
    description: 'A stronger missile branch with heavier projectile pressure.',
    playstyle: 'Force movement with missiles and punish enemies who dodge too late.',
  },
  glider: {
    role: 'Fast Missile',
    description: 'A missile branch with cleaner movement and lighter heavy identity.',
    playstyle: 'Keep distance, send guided pressure, and reposition between launches.',
  },
  firework: {
    role: 'Split Burst',
    description: 'A missile that splits into many smaller shots at the end of its life.',
    playstyle: 'Aim for delayed area denial and catch enemies in the split pattern.',
  },
  auto_gunner: {
    role: 'Auto Stream',
    description: 'Gunner pressure plus an auto turret gives both focus fire and side coverage.',
    playstyle: 'Track targets with the main stream while the turret covers nearby threats.',
  },
  pellet_shot: {
    role: 'Pellet Wall',
    description: 'An expanded shotgun branch with a very wide pellet cloud.',
    playstyle: 'Control close and mid range with volume, then retreat while pellets reload.',
  },
  dual_barrel: {
    role: 'Alt Burst',
    description: 'Shotgun-style barrels support alternating fire patterns.',
    playstyle: 'Mix primary and alternate shots to keep burst pressure unpredictable.',
  },
  sprayer: {
    role: 'Skipped Spray',
    description: 'A skipped Machine Gun upgrade with extra needle fire inside the spray.',
    playstyle: 'Skip earlier choices, then overwhelm enemies with constant layered bullets.',
  },
  booster: {
    role: 'High Recoil',
    description: 'Extra rear barrels make this Tri-Angle branch extremely movement-focused.',
    playstyle: 'Use recoil to sprint, chase weak targets, and escape bad fights before they close.',
  },
  fighter: {
    role: 'Combat Recoil',
    description: 'Tri-Angle mobility plus side barrels creates a more fight-ready recoil tank.',
    playstyle: 'Strafe through fights, keep the front cannon active, and let side barrels add pressure.',
  },
  landmine: {
    role: 'Stealth Rammer',
    description: 'A Smasher branch that adds invisibility to body-contact damage.',
    playstyle: 'Wait unseen, choose the approach, and burst into enemies with body damage.',
  },
  auto_smasher: {
    role: 'Auto Rammer',
    description: 'A Smasher body with an auto turret and broader stat caps.',
    playstyle: 'Ram as the main threat while the turret adds constant nuisance pressure.',
  },
  spike: {
    role: 'Pure Rammer',
    description: 'A larger spiked Smasher branch built entirely around body damage.',
    playstyle: 'Commit hard to contact fights and use the bigger body to threaten space.',
  },
  auto_tank: {
    role: 'Skipped Auto',
    description: 'A skipped Basic branch that adds an auto turret to a normal cannon body.',
    playstyle: 'Skip the mid-tree, then combine manual cannon shots with autonomous coverage.',
  },
};

export const ABILITY_LABELS: Record<TankAbility, string> = {
  'auto-turret': 'Auto Turret',
  'drone-control': 'Drone Control',
  'trap-launcher': 'Trap Launcher',
  invisibility: 'Invisibility',
  'predator-focus': 'Predator Focus',
  rammer: 'Rammer',
  'factory-minions': 'Factory Minions',
  'burst-fire': 'Burst Fire',
  'auto-spin-friendly': 'Auto Spin Friendly',
};

const POWER_KEYS: TankPowerKey[] = ['damage', 'fireRate', 'range', 'mobility', 'survivability', 'utility'];

export const TANK_DEX_ENTRIES: TankDexEntry[] = TANK_CLASSES.map((tankClass) => buildTankDexEntry(tankClass)).sort(
  (left, right) => left.tank.tier - right.tank.tier || left.tank.displayName.localeCompare(right.tank.displayName),
);

export const TANK_DEX_BY_ID = Object.fromEntries(TANK_DEX_ENTRIES.map((entry) => [entry.tank.id, entry])) as Record<string, TankDexEntry>;

export function getTankDexEntry(tankId: string): TankDexEntry {
  return TANK_DEX_BY_ID[tankId] ?? TANK_DEX_BY_ID.basic;
}

export function tankDexPowerKeys(): TankPowerKey[] {
  return POWER_KEYS;
}

function buildTankDexEntry(tankClass: TankClassDefinition): TankDexEntry {
  return {
    tank: tankClass,
    metadata: TANK_DEX_METADATA[tankClass.id],
    power: derivePowerBars(tankClass),
    paths: buildUpgradePaths(tankClass.id),
    abilityLabels: tankClass.abilities.map((ability) => ABILITY_LABELS[ability]),
    traits: buildTraits(tankClass),
    weaponSummary: buildWeaponSummary(tankClass),
    statCapSummary: buildStatCapSummary(tankClass),
  };
}

function derivePowerBars(tankClass: TankClassDefinition): TankPowerBars {
  const derived = deriveTankStats(tankClass.id, tankClass.unlockLevel, DEFAULT_STATS);
  let damagePerSecond = 0;
  let shotsPerSecond = 0;
  let maxRange = 0;
  let utilityScore = 0;

  for (const weapon of tankClass.weaponLayout) {
    const profile = weapon.projectile;
    const reload = Math.max(80, weapon.reloadMs + (weapon.staggerMs ?? 0));
    const shotRate = 1000 / reload;
    const splitMultiplier = profile.splitCount ? 1 + profile.splitCount * 0.22 : 1;
    const shotDamage = profile.damage * (weapon.damageScale ?? 1) * splitMultiplier;
    const activeLifeMs = profile.dampingAfterMs ?? profile.lifetimeMs;
    damagePerSecond += shotDamage * shotRate;
    shotsPerSecond += shotRate;
    maxRange = Math.max(maxRange, (profile.speed * (weapon.speedScale ?? 1) * activeLifeMs * (weapon.lifetimeScale ?? 1)) / 1000);
    if (weapon.autoAim) utilityScore += 10;
    if (weapon.altFire) utilityScore += 8;
    if (profile.turnRate) utilityScore += 6;
    if (profile.splitCount) utilityScore += 10;
  }

  if (tankClass.weaponLayout.length === 0 || tankClass.tags.includes('rammer')) {
    damagePerSecond += derived.bodyDamage * (tankClass.id === 'spike' ? 3 : 2.2);
  }

  const abilityUtility = tankClass.abilities.length * 15;
  const tagUtility =
    (tankClass.tags.includes('stealth') ? 12 : 0) +
    (tankClass.tags.includes('defense') ? 8 : 0) +
    (tankClass.tags.includes('swarm') ? 10 : 0) +
    (tankClass.tags.includes('alt-fire') ? 8 : 0);
  const droneUtility = tankClass.maxDrones ? Math.min(28, tankClass.maxDrones * 1.6) : 0;
  const recoilBonus = tankClass.tags.includes('recoil-move') ? 17 : 0;
  const rammerSurvival = tankClass.tags.includes('rammer') ? 18 : 0;

  return {
    damage: clampScore(scoreFromRange(damagePerSecond, 12, 145)),
    fireRate: clampScore(scoreFromRange(shotsPerSecond, 0.8, 8.5)),
    range: clampScore(scoreFromRange(maxRange || derived.radius * 7, 230, 1900) + (tankClass.fovMultiplier ? (tankClass.fovMultiplier - 1) * 28 : 0)),
    mobility: clampScore(scoreFromRange(derived.moveSpeed, 170, 250) + recoilBonus),
    survivability: clampScore(scoreFromRange(derived.maxHealth + derived.bodyDamage * 1.4 + derived.radius * 1.8, 145, 320) + rammerSurvival),
    utility: clampScore(abilityUtility + tagUtility + droneUtility + utilityScore),
  };
}

function buildUpgradePaths(tankId: string, visited: string[] = []): TankDexUpgradePath[] {
  const tankClass = getTankClass(tankId);
  if (visited.includes(tankId)) return [];
  if (tankClass.parents.length === 0) {
    return [
      {
        tankIds: [tankClass.id],
        displayNames: [tankClass.displayName],
        segments: [],
      },
    ];
  }

  return tankClass.parents.flatMap((parentId) =>
    buildUpgradePaths(parentId, [...visited, tankId]).map((path) => {
      const parent = getTankClass(parentId);
      return {
        tankIds: [...path.tankIds, tankClass.id],
        displayNames: [...path.displayNames, tankClass.displayName],
        segments: [
          ...path.segments,
          {
            fromTankId: parent.id,
            fromDisplayName: parent.displayName,
            toTankId: tankClass.id,
            toDisplayName: tankClass.displayName,
            requiredLevel: tankClass.unlockLevel as 15 | 30 | 45,
            requiresSkippedUpgrade: tankClass.requiresSkippedUpgrade ?? false,
          },
        ],
      };
    }),
  );
}

function buildTraits(tankClass: TankClassDefinition): string[] {
  const traits = new Set<string>();
  for (const tag of tankClass.tags) traits.add(titleCase(tag));
  if (tankClass.maxDrones) traits.add(`${tankClass.maxDrones} Max Drones`);
  if (tankClass.fovMultiplier && tankClass.fovMultiplier > 1) traits.add(`${Math.round(tankClass.fovMultiplier * 100)}% View`);
  if (tankClass.requiresSkippedUpgrade) traits.add('Skipped Upgrade');
  if (tankClass.bodyShape && tankClass.bodyShape !== 'circle') traits.add(`${titleCase(tankClass.bodyShape)} Body`);
  return [...traits];
}

function buildWeaponSummary(tankClass: TankClassDefinition): string {
  if (tankClass.weaponLayout.length === 0) return 'Body-only rammer';
  const projectileKinds = [...new Set(tankClass.weaponLayout.map((weapon) => titleCase(weapon.projectile.kind)))].join(' / ');
  const autoCount = tankClass.weaponLayout.filter((weapon) => weapon.autoAim).length;
  const altCount = tankClass.weaponLayout.filter((weapon) => weapon.altFire).length;
  const extras = [autoCount > 0 ? `${autoCount} auto` : '', altCount > 0 ? `${altCount} alt-fire` : ''].filter(Boolean).join(', ');
  return `${tankClass.weaponLayout.length} mount${tankClass.weaponLayout.length === 1 ? '' : 's'} - ${projectileKinds}${extras ? ` (${extras})` : ''}`;
}

function buildStatCapSummary(tankClass: TankClassDefinition): string {
  const caps = statCapsForTank(tankClass.id);
  const capValues = Object.values(caps);
  const maxCap = Math.max(...capValues);
  const zeroCaps = Object.entries(caps)
    .filter(([, value]) => value === 0)
    .map(([key]) => titleCase(key));
  if (zeroCaps.length > 0) return `Body build caps: ${maxCap}. No ${zeroCaps.join(', ')}.`;
  if (maxCap > 7) return `Expanded stat caps up to ${maxCap}.`;
  return 'Standard stat caps up to 7.';
}

function scoreFromRange(value: number, min: number, max: number): number {
  return ((value - min) / (max - min)) * 100;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
