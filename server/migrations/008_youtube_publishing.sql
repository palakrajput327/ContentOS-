ALTER TABLE content ADD COLUMN youtube jsonb;
ALTER TABLE social_account_tokens ADD COLUMN refresh_ciphertext text;
ALTER TABLE scheduled_posts ADD COLUMN upload_session_ciphertext text;
ALTER TABLE scheduled_posts ADD COLUMN processing_status text;
ALTER TABLE scheduled_posts ADD COLUMN actual_visibility text;
ALTER TABLE scheduled_posts ADD COLUMN processing_checked_at timestamptz;
ALTER TABLE scheduled_posts ADD COLUMN publish_warning text;
CREATE INDEX youtube_processing_idx ON scheduled_posts(processing_checked_at) WHERE processing_status='processing';
