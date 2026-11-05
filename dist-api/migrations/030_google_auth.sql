-- Migration: 030_google_auth.sql
-- Add Google OAuth columns to users table and create auth_oauth_states table

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state text PRIMARY KEY,
  action text NOT NULL DEFAULT 'signup_or_login',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_oauth_states_expires_idx ON auth_oauth_states(expires_at);

INSERT INTO schema_migrations (name, applied_at)
VALUES ('030_google_auth.sql', now())
ON CONFLICT (name) DO NOTHING;

