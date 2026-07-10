import { describe, expect, it } from 'vitest';
import { MemoryProfileStore } from './profiles';

describe('MemoryProfileStore', () => {
  it('creates and reconnects a guest profile by token', async () => {
    const store = new MemoryProfileStore();
    const first = await store.getOrCreateGuest(undefined, 'Tester');
    const second = await store.getOrCreateGuest(first.token, 'Ignored');
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.token).toBe(first.token);
  });

  it('persists match XP and unlocks progression hooks', async () => {
    const store = new MemoryProfileStore();
    const guest = await store.getOrCreateGuest(undefined, 'Tester');
    await store.recordMatch({
      profileId: guest.profile.id,
      roomId: 'test',
      finalScore: 3000,
      xpEarned: 9000,
      kills: 2,
      deaths: 1,
      bestTankId: 'triplet',
      durationSeconds: 120,
    });
    const updated = await store.getByToken(guest.token);
    expect(updated?.profile.profileXp).toBe(9000);
    expect(updated?.profile.achievements).toContain('first_destroy');
    expect(updated?.profile.achievements).toContain('score_2500');
    expect(updated?.profile.achievements).toContain('deep_run');
    expect(updated?.profile.customBranchUnlocks).toContain('tankio.experimental.alpha');
  });
});
