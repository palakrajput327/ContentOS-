-- Extend the already existing Google OAuth state table; never put secrets in browser URLs.
ALTER TABLE auth_oauth_states ADD COLUMN IF NOT EXISTS nonce text;
ALTER TABLE auth_oauth_states ADD COLUMN IF NOT EXISTS verifier_ciphertext text;
ALTER TABLE auth_oauth_states ADD COLUMN IF NOT EXISTS terms_accepted boolean NOT NULL DEFAULT false;
