ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS daily_posting_target integer NOT NULL DEFAULT 3 CHECK (daily_posting_target BETWEEN 1 AND 50);
