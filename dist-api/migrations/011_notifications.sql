CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type IN ('approval_requested', 'approved', 'rejected', 'scheduled', 'published', 'publish_failed', 'batch_completed', 'batch_partial', 'batch_failed')),
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_workspace_user_idx ON notifications(workspace_id, user_id, read, created_at DESC);
