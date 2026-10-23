CREATE TABLE system_admin_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);
CREATE INDEX system_admin_sessions_expiry_idx ON system_admin_sessions(expires_at);
CREATE TABLE system_admin_events (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);
