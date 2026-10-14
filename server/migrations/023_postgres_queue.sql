-- Additive only. Apply explicitly after approval; never from API/cron startup.
CREATE TABLE queue_jobs (
  id uuid PRIMARY KEY,
  queue text NOT NULL,
  scope text NOT NULL,
  workspace_id uuid,
  dedupe_key text NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','active','completed','failed','uncertain','cancelled')),
  priority integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_ms integer NOT NULL DEFAULT 10000 CHECK (backoff_ms >= 0),
  owner uuid,
  lease_until timestamptz,
  error_code text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(queue,scope,dedupe_key),
  CHECK ((workspace_id IS NOT NULL AND scope=workspace_id::text) OR (workspace_id IS NULL AND scope='system'))
);
CREATE INDEX queue_jobs_due ON queue_jobs(priority DESC,run_at,id) WHERE state='waiting';
CREATE INDEX queue_jobs_expired ON queue_jobs(lease_until) WHERE state='active';
CREATE INDEX queue_jobs_workspace ON queue_jobs(workspace_id,queue,state);

CREATE TABLE queue_worker_leases (
  lane text PRIMARY KEY,
  owner uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  last_started_at timestamptz NOT NULL DEFAULT now(),
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text
);
CREATE TABLE queue_recurring_tasks (
  name text PRIMARY KEY,
  next_run_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL CHECK(hits>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX api_rate_limits_expiry ON api_rate_limits(expires_at);

-- Add columns already assumed by the batch consumer, absent in older migrations.
-- Existing columns and their values are preserved when already present.
ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE batch_child_items ADD COLUMN IF NOT EXISTS item_index integer NOT NULL DEFAULT 0;
