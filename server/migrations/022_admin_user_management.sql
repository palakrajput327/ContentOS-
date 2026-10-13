ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'ACTIVE' CHECK(account_status IN ('ACTIVE','SUSPENDED','DELETED'));
ALTER TABLE users ADD COLUMN admin_note text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
ALTER TABLE system_admin_events ADD COLUMN target_user_id uuid REFERENCES users(id);
ALTER TABLE system_admin_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
