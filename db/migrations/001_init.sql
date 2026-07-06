CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_token_hash TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Pilot',
  profile_xp INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_email TEXT UNIQUE,
  linked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profile_cosmetics (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  body_color TEXT NOT NULL DEFAULT '#35d0ff',
  accent_color TEXT NOT NULL DEFAULT '#ffe45c',
  trail_id TEXT NOT NULL DEFAULT 'starter'
);

CREATE TABLE IF NOT EXISTS profile_achievements (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS profile_tank_mastery (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tank_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, tank_id)
);

CREATE TABLE IF NOT EXISTS custom_branch_unlocks (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, branch_id)
);

CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  room_id TEXT NOT NULL,
  final_score INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  best_tank_id TEXT NOT NULL DEFAULT 'basic',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
