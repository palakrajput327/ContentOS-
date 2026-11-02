import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('server/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let sql = `-- ====================================================================
-- ContentOS Full Database Schema & Initial Setup
-- Generated for cPanel PostgreSQL (phpPgAdmin / psql)
-- Includes migrations 001 to 027 + Seed Admin User & Workspace
-- ====================================================================

-- 1. Create Schema Migrations Table
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

`;

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  sql += `-- --------------------------------------------------------------------
-- Migration: ${file}
-- --------------------------------------------------------------------
${content.trim()}

INSERT INTO schema_migrations (name, applied_at)
VALUES ('${file}', now())
ON CONFLICT (name) DO NOTHING;

`;
}

// Seed user & workspace
const userId = '83be9c4d-a880-4e62-8555-84ef29486a54';
const workspaceId = '4386cbf8-47bf-41fe-a925-0549bced08f2';
const passwordHash = 'scrypt:b96725ae50d3a122ecd660ae90b095ee:0d685f4a87d38a07242cff4e233156a3379cc3b7126aa266eaa8cb24614641f0067beab30f0a987767c5a05b5b1fc6b1b3ab6fb04ba96f06462a62d9f00c9e7e';

sql += `-- ====================================================================
-- Initial Seed Data: User, Workspace, Membership & Active Subscription
-- ====================================================================

-- 1. User Account (geminipalak19@gmail.com / 321Palak123Palak)
INSERT INTO users (id, email, name, password_hash, email_verified_at, terms_accepted_at, terms_version, created_at, updated_at)
VALUES (
  '${userId}',
  'geminipalak19@gmail.com',
  'Palak Gemini',
  '${passwordHash}',
  now(),
  now(),
  'development-v1',
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  email_verified_at = EXCLUDED.email_verified_at;

-- 2. Workspace
INSERT INTO workspaces (id, name, created_at, updated_at)
VALUES (
  '${workspaceId}',
  'Palak Gemini''s workspace',
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

-- 3. Workspace Membership (Owner)
INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
VALUES (
  '${workspaceId}',
  '${userId}',
  'Owner',
  now()
) ON CONFLICT DO NOTHING;

-- 4. Active Workspace Subscription
INSERT INTO workspace_subscriptions (
  id, workspace_id, plan_id, billing_period, status, start_at, current_period_end, cancel_at_period_end, custom_daily_limit, created_at, updated_at
) VALUES (
  '4f504e03-8b41-4da5-ad99-bd561b65cb2f',
  '${workspaceId}',
  '33333333-3333-4333-a333-333333333333',
  'MONTHLY',
  'ACTIVE',
  now(),
  now() + interval '5 years',
  false,
  10,
  now(),
  now()
) ON CONFLICT (id) DO UPDATE SET
  status = 'ACTIVE',
  current_period_end = now() + interval '5 years';

-- 5. Active Workspace Trial
INSERT INTO workspace_trials (
  id, workspace_id, started_at, ends_at, status, extension_count, daily_post_limit, created_at, updated_at
) VALUES (
  '1270775c-cf56-4ed5-8529-021896e30af3',
  '${workspaceId}',
  now(),
  now() + interval '5 years',
  'ACTIVE',
  0,
  10,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- Setup Complete!
-- ====================================================================
`;

fs.writeFileSync('database_full_setup.sql', sql, 'utf8');
console.log('Successfully generated database_full_setup.sql! Size:', fs.statSync('database_full_setup.sql').size, 'bytes');
