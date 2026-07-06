import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProfileDto } from '../shared/protocol';

export interface MatchRecordInput {
  profileId?: string;
  roomId: string;
  finalScore: number;
  xpEarned: number;
  kills: number;
  deaths: number;
  bestTankId: string;
  durationSeconds: number;
}

export interface ProfileResult {
  profile: ProfileDto;
  token: string;
}

export interface ProfileStore {
  getOrCreateGuest(token: string | undefined, displayName: string): Promise<ProfileResult>;
  getByToken(token: string): Promise<ProfileResult | undefined>;
  recordMatch(input: MatchRecordInput): Promise<void>;
  close(): Promise<void>;
}

interface StoredProfile {
  id: string;
  tokenHash: string;
  displayName: string;
  profileXp: number;
  bodyColor: string;
  accentColor: string;
  achievements: Set<string>;
  customBranchUnlocks: Set<string>;
}

export class MemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();

  async getOrCreateGuest(token: string | undefined, displayName: string): Promise<ProfileResult> {
    if (token) {
      const existing = await this.getByToken(token);
      if (existing) return existing;
    }

    const nextToken = createGuestToken();
    const tokenHash = hashToken(nextToken);
    const profile: StoredProfile = {
      id: crypto.randomUUID(),
      tokenHash,
      displayName: cleanDisplayName(displayName),
      profileXp: 0,
      bodyColor: '#35d0ff',
      accentColor: '#ffe45c',
      achievements: new Set(),
      customBranchUnlocks: new Set(),
    };
    this.profiles.set(tokenHash, profile);
    return { profile: toDto(profile), token: nextToken };
  }

  async getByToken(token: string): Promise<ProfileResult | undefined> {
    const profile = this.profiles.get(hashToken(token));
    if (!profile) return undefined;
    return { profile: toDto(profile), token };
  }

  async recordMatch(input: MatchRecordInput): Promise<void> {
    if (!input.profileId) return;
    const profile = [...this.profiles.values()].find((candidate) => candidate.id === input.profileId);
    if (!profile) return;
    profile.profileXp += Math.max(0, Math.floor(input.xpEarned));
    if (input.kills >= 1) profile.achievements.add('first_destroy');
    if (input.finalScore >= 2500) profile.achievements.add('score_2500');
    if (input.bestTankId !== 'basic') profile.achievements.add('first_upgrade');
    if (profile.profileXp >= 8000) profile.customBranchUnlocks.add('tankio.experimental.alpha');
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PostgresProfileStore implements ProfileStore {
  constructor(private readonly pool: Pool) {}

  async getOrCreateGuest(token: string | undefined, displayName: string): Promise<ProfileResult> {
    if (token) {
      const existing = await this.getByToken(token);
      if (existing) return existing;
    }

    const nextToken = createGuestToken();
    const tokenHash = hashToken(nextToken);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{
        id: string;
        display_name: string;
        profile_xp: number;
      }>(
        `
        INSERT INTO profiles (guest_token_hash, display_name)
        VALUES ($1, $2)
        RETURNING id, display_name, profile_xp
        `,
        [tokenHash, cleanDisplayName(displayName)],
      );
      const profileRow = inserted.rows[0];
      await client.query('INSERT INTO profile_cosmetics (profile_id) VALUES ($1)', [profileRow.id]);
      await client.query('COMMIT');
      return {
        token: nextToken,
        profile: {
          id: profileRow.id,
          displayName: profileRow.display_name,
          profileXp: profileRow.profile_xp,
          bodyColor: '#35d0ff',
          accentColor: '#ffe45c',
          achievements: [],
          customBranchUnlocks: [],
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getByToken(token: string): Promise<ProfileResult | undefined> {
    const tokenHash = hashToken(token);
    const result = await this.pool.query<{
      id: string;
      display_name: string;
      profile_xp: number;
      body_color: string;
      accent_color: string;
    }>(
      `
      SELECT p.id, p.display_name, p.profile_xp, c.body_color, c.accent_color
      FROM profiles p
      LEFT JOIN profile_cosmetics c ON c.profile_id = p.id
      WHERE p.guest_token_hash = $1
      `,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;

    const [achievementRows, unlockRows] = await Promise.all([
      this.pool.query<{ achievement_id: string }>('SELECT achievement_id FROM profile_achievements WHERE profile_id = $1', [row.id]),
      this.pool.query<{ branch_id: string }>('SELECT branch_id FROM custom_branch_unlocks WHERE profile_id = $1', [row.id]),
    ]);

    return {
      token,
      profile: {
        id: row.id,
        displayName: row.display_name,
        profileXp: row.profile_xp,
        bodyColor: row.body_color ?? '#35d0ff',
        accentColor: row.accent_color ?? '#ffe45c',
        achievements: achievementRows.rows.map((achievement) => achievement.achievement_id),
        customBranchUnlocks: unlockRows.rows.map((unlock) => unlock.branch_id),
      },
    };
  }

  async recordMatch(input: MatchRecordInput): Promise<void> {
    if (!input.profileId) return;
    const xpEarned = Math.max(0, Math.floor(input.xpEarned));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
        INSERT INTO match_history (profile_id, room_id, final_score, xp_earned, kills, deaths, best_tank_id, duration_seconds)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          input.profileId,
          input.roomId,
          Math.floor(input.finalScore),
          xpEarned,
          input.kills,
          input.deaths,
          input.bestTankId,
          input.durationSeconds,
        ],
      );
      await client.query('UPDATE profiles SET profile_xp = profile_xp + $1, updated_at = now() WHERE id = $2', [
        xpEarned,
        input.profileId,
      ]);
      await client.query(
        `
        INSERT INTO profile_tank_mastery (profile_id, tank_id, xp, kills, deaths)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (profile_id, tank_id)
        DO UPDATE SET
          xp = profile_tank_mastery.xp + EXCLUDED.xp,
          kills = profile_tank_mastery.kills + EXCLUDED.kills,
          deaths = profile_tank_mastery.deaths + EXCLUDED.deaths,
          updated_at = now()
        `,
        [input.profileId, input.bestTankId, xpEarned, input.kills, input.deaths],
      );
      await this.unlockAchievements(client, input);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async unlockAchievements(client: PoolClient, input: MatchRecordInput): Promise<void> {
    const achievements = new Set<string>();
    if (input.kills >= 1) achievements.add('first_destroy');
    if (input.finalScore >= 2500) achievements.add('score_2500');
    if (input.bestTankId !== 'basic') achievements.add('first_upgrade');
    if (input.xpEarned >= 5000) achievements.add('deep_run');
    for (const achievement of achievements) {
      await client.query(
        `
        INSERT INTO profile_achievements (profile_id, achievement_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [input.profileId, achievement],
      );
    }

    const profile = await client.query<{ profile_xp: number }>('SELECT profile_xp FROM profiles WHERE id = $1', [input.profileId]);
    if ((profile.rows[0]?.profile_xp ?? 0) >= 8000) {
      await client.query(
        `
        INSERT INTO custom_branch_unlocks (profile_id, branch_id)
        VALUES ($1, 'tankio.experimental.alpha')
        ON CONFLICT DO NOTHING
        `,
        [input.profileId],
      );
    }
  }
}

export function createGuestToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanDisplayName(name: string): string {
  const cleaned = name.replace(/[^\w .-]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 18) : 'Pilot';
}

function toDto(profile: StoredProfile): ProfileDto {
  return {
    id: profile.id,
    displayName: profile.displayName,
    profileXp: profile.profileXp,
    bodyColor: profile.bodyColor,
    accentColor: profile.accentColor,
    achievements: [...profile.achievements],
    customBranchUnlocks: [...profile.customBranchUnlocks],
  };
}
