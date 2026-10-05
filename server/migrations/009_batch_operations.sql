CREATE TABLE IF NOT EXISTS batch_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type IN ('ai_generation', 'bulk_save', 'bulk_approve', 'bulk_reject', 'bulk_schedule', 'bulk_publish', 'bulk_retry')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_items integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS batch_child_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  target_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  result jsonb,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_child_items_batch_idx ON batch_child_items(batch_id, status);
CREATE INDEX IF NOT EXISTS batch_jobs_workspace_idx ON batch_jobs(workspace_id, created_at DESC);
