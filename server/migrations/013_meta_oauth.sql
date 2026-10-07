ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS provider text;
CREATE TABLE IF NOT EXISTS meta_oauth_pending (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
 ciphertext text NOT NULL, expires_at timestamptz NOT NULL
);

ALTER TABLE posting_slots DROP CONSTRAINT IF EXISTS posting_slots_platform_check;
ALTER TABLE posting_slots ADD CONSTRAINT posting_slots_platform_check CHECK(platform IS NULL OR platform IN ('LinkedIn','X','Instagram','Facebook','Telegram','YouTube'));
