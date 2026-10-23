CREATE TABLE IF NOT EXISTS posting_slots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
  time_of_day text NOT NULL CHECK(time_of_day ~ '^[0-2][0-9]:[0-5][0-9]$'),
  platform text CHECK(platform IS NULL OR platform IN ('LinkedIn', 'X', 'Instagram', 'Telegram', 'YouTube')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posting_slots_workspace_day_idx ON posting_slots(workspace_id, day_of_week, enabled);
