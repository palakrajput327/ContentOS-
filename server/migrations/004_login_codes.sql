ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check CHECK(purpose IN ('verify','reset','login'));
ALTER TABLE auth_tokens ADD COLUMN challenge_hash text;
