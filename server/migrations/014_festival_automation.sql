ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_automation_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_prep_days integer NOT NULL DEFAULT 2;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_region text NOT NULL DEFAULT 'ALL';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_language text NOT NULL DEFAULT 'HINGLISH';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_post_time text NOT NULL DEFAULT '09:00';

CREATE TABLE IF NOT EXISTS scheduled_festival_posts(
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  festival_id text NOT NULL,
  festival_date date NOT NULL,
  content_id uuid REFERENCES content(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'GENERATED' CHECK(status IN ('PROCESSING','GENERATED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, festival_id, festival_date)
);

CREATE INDEX IF NOT EXISTS scheduled_festival_posts_ws_date_idx ON scheduled_festival_posts(workspace_id, festival_date);
