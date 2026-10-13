-- Migration 015: Festival Automation Phase 2: Auto-Approval & Multi-Platform Publishing

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_auto_publish_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_approval_mode text NOT NULL DEFAULT 'MANUAL_APPROVAL';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS festival_social_account_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE scheduled_festival_posts ADD COLUMN IF NOT EXISTS publish_status text DEFAULT 'PENDING';
ALTER TABLE scheduled_festival_posts ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE scheduled_festival_posts ADD COLUMN IF NOT EXISTS error_message text;

-- Add check constraint for approval mode if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_festival_approval_mode_check'
  ) THEN
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_festival_approval_mode_check 
    CHECK (festival_approval_mode IN ('MANUAL_APPROVAL', 'AUTO_APPROVAL'));
  END IF;
END $$;

-- Add check constraint for publish_status if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_festival_posts_publish_status_check'
  ) THEN
    ALTER TABLE scheduled_festival_posts ADD CONSTRAINT scheduled_festival_posts_publish_status_check 
    CHECK (publish_status IN ('PENDING', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'UNCERTAIN', 'SKIPPED'));
  END IF;
END $$;
