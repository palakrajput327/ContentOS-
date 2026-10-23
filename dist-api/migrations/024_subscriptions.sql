-- 024_subscriptions.sql
-- Complete SaaS Subscription, Free Trials, User Management & Entitlement System

-- 1. User table enhancements: international phone number
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code text;

-- 2. Subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'INR',
  monthly_price numeric(12,2) NOT NULL,
  yearly_price numeric(12,2),
  daily_post_limit integer NOT NULL DEFAULT 3,
  is_active boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial plans
INSERT INTO subscription_plans (id, code, name, description, currency, monthly_price, yearly_price, daily_post_limit, is_active, features)
VALUES
  ('11111111-1111-4111-a111-111111111111', 'STARTER', 'Starter', 'Essential social media creation and scheduling for individuals and growing businesses.', 'INR', 15000, 150000, 3, true, '["AI Studio generation", "Up to 3 posts per day", "Content calendar & scheduler", "Connected social platforms", "Content library", "Standard support"]'::jsonb),
  ('22222222-2222-4222-a222-222222222222', 'GROWTH', 'Growth', 'Our most popular plan with festival automation and multi-channel scheduling.', 'INR', 25000, 250000, 5, true, '["Everything in Starter", "Up to 5 posts per day", "Indian Festival Automation", "Team review & approval workflows", "Multi-account simultaneous distribution", "Priority customer support"]'::jsonb),
  ('33333333-3333-4333-a333-333333333333', 'SCALE', 'Scale', 'High-volume publishing, knowledge intelligence, and priority capacity for agencies.', 'INR', 50000, 500000, 10, true, '["Everything in Growth", "Up to 10 posts per day", "Automated Knowledge Engine proposals", "Visual source media & document intelligence", "Custom posting quotas upon request", "Dedicated account assistance"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- 3. Workspace free trials (5 days = 120 hours exact duration)
CREATE TABLE IF NOT EXISTS workspace_trials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'EXTENDED')),
  extension_count integer NOT NULL DEFAULT 0,
  extension_reason text,
  daily_post_limit integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_trials_workspace_idx ON workspace_trials(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_trials_ends_at_idx ON workspace_trials(ends_at);

-- 4. Workspace subscriptions
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES subscription_plans(id),
  billing_period text NOT NULL DEFAULT 'MONTHLY' CHECK (billing_period IN ('MONTHLY', 'YEARLY')),
  status text NOT NULL DEFAULT 'TRIALING' CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED', 'SUSPENDED', 'ADMIN_GRANTED')),
  start_at timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  custom_daily_limit integer,
  admin_override_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_idx ON workspace_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_status_idx ON workspace_subscriptions(status);

-- 5. Payments table (Manual confirmation + online provider abstraction)
CREATE TABLE IF NOT EXISTS subscription_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES subscription_plans(id),
  billing_period text NOT NULL DEFAULT 'MONTHLY',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider text NOT NULL DEFAULT 'MANUAL' CHECK (provider IN ('MANUAL', 'RAZORPAY')),
  provider_reference text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  payment_notes text,
  payment_proof_url text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_workspace_idx ON subscription_payments(workspace_id);
CREATE INDEX IF NOT EXISTS subscription_payments_status_idx ON subscription_payments(status);

-- 6. Subscription events log
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES workspace_subscriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_events_ws_time_idx ON subscription_events(workspace_id, created_at DESC);

-- 7. User consent collection
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version text NOT NULL DEFAULT 'v1.0',
  privacy_version text NOT NULL DEFAULT 'v1.0',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  source text NOT NULL DEFAULT 'signup'
);
CREATE INDEX IF NOT EXISTS user_consents_user_idx ON user_consents(user_id);

-- 8. Platform administrative audit logs
CREATE TABLE IF NOT EXISTS administrative_audit_logs (
  id uuid PRIMARY KEY,
  actor_username text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON administrative_audit_logs(actor_username, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx ON administrative_audit_logs(target_type, target_id);

-- 9. Backfill existing workspaces with ADMIN_GRANTED entitlement so existing production users are NEVER locked out
INSERT INTO workspace_subscriptions (
  id, workspace_id, plan_id, billing_period, status, start_at, current_period_end, custom_daily_limit, admin_override_note
)
SELECT
  gen_random_uuid(),
  w.id,
  '33333333-3333-4333-a333-333333333333',
  'YEARLY',
  'ADMIN_GRANTED',
  w.created_at,
  now() + interval '10 years',
  COALESCE(w.daily_posting_target, 10),
  'Legacy active workspace migrated with complimentary full access.'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_subscriptions ws WHERE ws.workspace_id = w.id
);
