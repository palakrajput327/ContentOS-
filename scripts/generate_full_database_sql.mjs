import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('server/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let sql = `-- ====================================================================
-- ContentOS Full Database Schema & Initial Setup
-- Generated for cPanel PostgreSQL (phpPgAdmin / psql)
-- Includes migrations 001 to 027 + Seed Admin User, Workspace & Social Accounts
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
INSERT INTO workspaces (id, name, timezone, require_approval, created_at)
VALUES (
  '${workspaceId}',
  'Palak Gemini''s workspace',
  'Asia/Kolkata',
  true,
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

-- 4. Active Workspace Subscription (5 Years Scale Plan)
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
-- Connected Social Accounts (LinkedIn, Instagram, Facebook, Telegram, YouTube)
-- ====================================================================

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('ba86baec-532a-416a-8266-8c4e201f30fc', '${workspaceId}', 'linkedin', 'urn:li:person:91BIqvndCz', 'palak kashyap', 'CONNECTED', now())
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('56bdf6fd-6944-4b58-8afd-6bd8f9f14765', '${workspaceId}', 'facebook', '1389305704261474', 'Hindustan social network', 'CONNECTED', now())
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('e343e8df-5168-4f40-879c-35dcbe2d186c', '${workspaceId}', 'instagram', '17841450582690207', '@hindustan_social_network', 'CONNECTED', now())
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('54dba928-27a0-4753-88ee-8fe5fc3e6c3e', '${workspaceId}', 'telegram', '-1001512721655', 'Hindustan software Solution (@hssblockchaindeveloments)', 'CONNECTED', now())
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('f166c4df-4f10-498b-915a-d5aae6b6e880', '${workspaceId}', 'youtube', 'UCyA3wMqiw5Dp-pa8jPuGwfw', 'Hindustansocialnetwork', 'CONNECTED', now())
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

-- Encrypted Access Tokens
INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('ba86baec-532a-416a-8266-8c4e201f30fc', 'w5nnIoWHUjXdx9qT.SaG3gyfJ4uxCdKHSwylOLg==.01lmpDonJbU7BJX9lMSQR7TamI7j6/DYxdir+gS1uxAiD0jhqyXlFEHdI2/X0FxPVQigFG3nT+8J9aLjclOIulUd1y3rBTuwwL88GJLJRUoeeXpX6QA//dwwXAXzzHDZ5fC0DAjpfJtoKFczRzJpMEn19/lE0id/R2LOH8XFc75M8BC3I1EAhj5CKd/N6tvK5odCHjacoLJEhZJg07satSgFfOKbtLck25I39ppzr3z6Xp6MMghk3GQlEc/O+Jo2sfBJu1fP1wZC/jJFLb+M6JiOISVqd3o/3eKeh/P0rYsecKHi1mIaXSy7z60flHv2Xqu1164i2bNr0zspUdhSbfF0B/A1bl5MEKnelgGVpIZ/fqr6PSWiQwFUKkyvdxa6CRhaMzopZONtVuO5dSMg4VVc1Z1jD8jDj/AwdFfKHCEki4Cdu+jKr8pM6/cW35OPexI5wsWAu4Q6wgiC9sg=', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('56bdf6fd-6944-4b58-8afd-6bd8f9f14765', 'XANQMs4WU/QABkK2.PoNNrtYPOnuKTb2dJi6N6Q==.BMEYce8EsDlxeLBhH8zE6Fh6wIUg/YqfpfVE0Jq0gJg2sGM3Ne+o1zBFOkmHYwR4EPpuWVDDr3e2CHdcSAaBIxFyIT0tLPibMQeqxX7x9AOT/jx0lsfYrALbEm/wW8ZctLUDlxD2w2Ja9Ed1MJxmDRWVeME+uWSFjcj/yDjXyAMLcMHD3u1VP5CreKUAx/EDE2pv3W1zn+47trr5BR6ptu/e5ScDnrZqn/MpsPiMtvq/q/1Bb6q/dKcO4mChGiD4zNzB4dMMUyNFzSeN5w==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('e343e8df-5168-4f40-879c-35dcbe2d186c', 'ogIQM7u+gXtuS4ar.Df1jsbm2c1mIAF+AeYK5xA==.cmACZhcHYnmCqHp/HH2bSr7cebzlQtdfNFH+2uQVcw/3S7UbgEaBrdsL2IQDo8cJ2CLhG5lYMQpbENbETtB89TPLazeAuLAxGjBRjxIHirRFgHTMQ2+UXibJlaWuIkHUuYpMDM/+e8/+QDAiO3KZwSFd3YUJP+W22z8WpvSqzgRB40MzH/xTqzfgKJ5Gbs89Kz2lQIf4b7MvCKq6By+zC7hzYb/yIh1K/57/YOVoq1neTRuC9g2OZTO81FqNjZUhqLJE7J7/0EXmyPBxCA==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('54dba928-27a0-4753-88ee-8fe5fc3e6c3e', 'ZBznvWtgAs6quJ0c.dhP8h1dwPgNqSajMvaBIkQ==.YJJXoWINuUDI9PcgU0oFKwJziXDDdH/2cEQrS45IxUrEOjFoeAbMGxEZ2smPxg==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('f166c4df-4f10-498b-915a-d5aae6b6e880', 'G2DB63jV+8trJiT4.7ZoPLcnWMmT9SoIhXjYMuw==.iOh2xIdcgHNUpDD2oV0S18pyTx4qFGYmZcSTMX9pql3sjfbRlLL6W+B2xXUoIAClYcdaVKriky679sa4SViMj2MeFkaIE3sT9MFeXkEc05c7tpQ5PRK+9Eimc52Ly+WPeT6YWtIAiGbEoIXN6v+gIM1S9N50sTHXmsA71u5fq/SfzQGE8HDO8gfn9oUKB824y2Daf4ypN8GUOvw26ArlZJRSkJanpCgnxow/MQLIRT97/GH/6XzwQZJVj03qD7LBg9eKXCC3WfsvcVhvIq5TC/QtVeXTagoXlxhx6mubSMJa3Wp4D+evIKaI4NfqIzKzsuHbNsPPDM5ajdRVk=', '2026-10-16T09:05:24.193Z', 'rZ71T7+3PMCgkDsQ.kpAJxWwWGQdZcaknjnDg1A==.M/RvZTrYAu+Gi82yRcYxFis3JriId7+K+yb59S8gHnA4i97/Ug/6mgSojKYCohijVxbys4TTtK2oy1+SJrQhZpncxLDqRiiNH8AVDwmghlF3a9P0E8WfFsczT5BNKr8qf5aVyI10Rw==')
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext;

-- Permissions for cPanel database user hindust1_OneSocial
GRANT ALL ON SCHEMA public TO "hindust1_OneSocial";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "hindust1_OneSocial";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "hindust1_OneSocial";
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "hindust1_OneSocial";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "hindust1_OneSocial";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "hindust1_OneSocial";

-- ====================================================================
-- Setup Complete!
-- ====================================================================
`;

fs.writeFileSync('database_full_setup.sql', sql, 'utf8');
console.log('Successfully generated database_full_setup.sql! Size:', fs.statSync('database_full_setup.sql').size, 'bytes');
