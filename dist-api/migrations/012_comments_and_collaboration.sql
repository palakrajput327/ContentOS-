-- Migration 012: Team Collaboration and Content Discussion

ALTER TABLE content ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id) ON DELETE SET NULL;

-- Remove rigid type CHECK constraint on notifications if present to allow collaboration types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

CREATE TABLE IF NOT EXISTS content_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES content_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS content_comments_workspace_idx ON content_comments(workspace_id);
CREATE INDEX IF NOT EXISTS content_comments_content_idx ON content_comments(content_id, created_at ASC);
CREATE INDEX IF NOT EXISTS content_comments_parent_idx ON content_comments(parent_id);
CREATE INDEX IF NOT EXISTS content_comments_author_idx ON content_comments(author_id);
CREATE INDEX IF NOT EXISTS content_assigned_to_idx ON content(workspace_id, assigned_to);
