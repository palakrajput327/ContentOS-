-- ContentOS Complete PostgreSQL Database Schema

-- ==========================================
-- Migration: 001_auth.sql
-- ==========================================
CREATE TABLE users (id uuid PRIMARY KEY,email text NOT NULL UNIQUE,name text NOT NULL,password_hash text NOT NULL,email_verified_at timestamptz,terms_accepted_at timestamptz NOT NULL,terms_version text NOT NULL DEFAULT 'development-v1',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auth_tokens(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose text NOT NULL CHECK(purpose IN ('verify','reset')),token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens(user_id,purpose,created_at DESC);
CREATE TABLE auth_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,family_id uuid NOT NULL,access_hash text NOT NULL UNIQUE,refresh_hash text NOT NULL UNIQUE,access_expires_at timestamptz NOT NULL,refresh_expires_at timestamptz NOT NULL,absolute_expires_at timestamptz NOT NULL,revoked_at timestamptz,rotated_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_family_idx ON auth_sessions(family_id);
CREATE TABLE auth_events(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),action text NOT NULL,request_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX auth_events_user_time_idx ON auth_events(user_id,created_at DESC);
CREATE TABLE email_outbox(id uuid PRIMARY KEY,recipient text NOT NULL,subject text NOT NULL,encrypted_body text,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','SENT','FAILED','EXPIRED')),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,claimed_at timestamptz,sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX email_outbox_pending_idx ON email_outbox(state,available_at);


-- ==========================================
-- Migration: 002_codes_workspaces.sql
-- ==========================================
ALTER TABLE auth_tokens ADD COLUMN attempts integer NOT NULL DEFAULT 0;
UPDATE auth_tokens SET used_at=now() WHERE used_at IS NULL;
UPDATE email_outbox SET state='EXPIRED',encrypted_body=NULL WHERE state IN ('PENDING','PROCESSING','FAILED');
CREATE TABLE workspaces(id uuid PRIMARY KEY,name text NOT NULL,timezone text NOT NULL,require_approval boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE workspace_members(workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),role text NOT NULL CHECK(role IN ('Owner','Admin','Content Manager','Editor','Approver','Viewer')),PRIMARY KEY(workspace_id,user_id));
CREATE INDEX memberships_user_idx ON workspace_members(user_id);
CREATE TABLE brand_kits(workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE social_accounts(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),platform text NOT NULL,provider_id text NOT NULL,name text NOT NULL,state text NOT NULL DEFAULT 'Connected',last_sync timestamptz,UNIQUE(workspace_id,platform),UNIQUE(id,workspace_id));
CREATE TABLE social_account_tokens(account_id uuid PRIMARY KEY REFERENCES social_accounts(id) ON DELETE CASCADE,ciphertext text NOT NULL,expires_at timestamptz);
CREATE TABLE oauth_states(state_hash text PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE content(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),title text NOT NULL,body text NOT NULL,variants jsonb NOT NULL DEFAULT '{}',platforms jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','NEEDS_REVIEW','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','FAILED','UNCERTAIN')),version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),approved_by uuid REFERENCES users(id),scheduled_by uuid REFERENCES users(id),published_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),scheduled_at timestamptz,timezone text,UNIQUE(id,workspace_id));
CREATE INDEX content_workspace_status_idx ON content(workspace_id,status,created_at DESC);
CREATE TABLE content_versions(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),content_id uuid NOT NULL,version integer NOT NULL,snapshot jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(content_id,version),FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id));
CREATE TABLE approvals(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),content_id uuid NOT NULL,version integer NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),decision text NOT NULL CHECK(decision IN ('approve','reject')),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id));
CREATE TABLE scheduled_posts(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),content_id uuid NOT NULL,account_id uuid NOT NULL,content_version integer NOT NULL,execute_at timestamptz NOT NULL,timezone text NOT NULL,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ENQUEUED','PROCESSING','PUBLISHED','FAILED','UNCERTAIN','CANCELLED')),attempt_started_at timestamptz,provider_post_id text,error_code text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id),FOREIGN KEY(account_id,workspace_id) REFERENCES social_accounts(id,workspace_id),UNIQUE(content_id,account_id,content_version));
CREATE INDEX scheduled_pending_idx ON scheduled_posts(state,execute_at);
CREATE TABLE published_posts(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),scheduled_post_id uuid NOT NULL UNIQUE REFERENCES scheduled_posts(id),provider_post_id text NOT NULL,published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE activity_logs(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),actor_id uuid REFERENCES users(id),action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,entity text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',previous_value jsonb,new_value jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX activity_workspace_time_idx ON activity_logs(workspace_id,created_at DESC);
CREATE TABLE ai_generations(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),actor_id uuid NOT NULL REFERENCES users(id),provider text NOT NULL,input jsonb NOT NULL,output jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE users ADD COLUMN active_workspace_id uuid REFERENCES workspaces(id);


-- ==========================================
-- Migration: 003_test_mail_isolation.sql
-- ==========================================
ALTER TABLE email_outbox ADD COLUMN is_test boolean NOT NULL DEFAULT false;


-- ==========================================
-- Migration: 004_login_codes.sql
-- ==========================================
ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check CHECK(purpose IN ('verify','reset','login'));
ALTER TABLE auth_tokens ADD COLUMN challenge_hash text;


-- ==========================================
-- Migration: 005_media_assets.sql
-- ==========================================
-- Migration: 005_media_assets.sql
-- Persistent media and object storage asset metadata model

CREATE TYPE media_asset_type AS ENUM (
  'DOCUMENT',
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'THUMBNAIL',
  'GENERATED_ASSET'
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type media_asset_type NOT NULL DEFAULT 'DOCUMENT',
  storage_provider VARCHAR(32) NOT NULL DEFAULT 's3',
  bucket VARCHAR(128) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum VARCHAR(128),
  original_filename VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace ON media_assets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_assets(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_media_assets_type ON media_assets(workspace_id, type);


-- ==========================================
-- Migration: 006_documents.sql
-- ==========================================
-- Migration: 006_documents.sql
-- PDF Intelligence Core: Documents, Pages, Chunks, and Processing Job schema

CREATE TYPE document_status AS ENUM (
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'EXTRACTING',
  'NORMALIZING',
  'CHUNKING',
  'READY',
  'FAILED'
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
  status document_status NOT NULL DEFAULT 'UPLOADED',
  page_count INT NOT NULL DEFAULT 0,
  processing_version INT NOT NULL DEFAULT 1,
  failure_code VARCHAR(64),
  failure_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_media_asset ON documents(media_asset_id);

CREATE TABLE IF NOT EXISTS document_pages (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  raw_text TEXT NOT NULL DEFAULT '',
  clean_text TEXT NOT NULL DEFAULT '',
  extraction_method VARCHAR(32) NOT NULL DEFAULT 'pdf-parse',
  ocr_used BOOLEAN NOT NULL DEFAULT FALSE,
  ocr_confidence NUMERIC(5,2),
  character_count INT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_document_pages_page UNIQUE (document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_document_pages_lookup ON document_pages(workspace_id, document_id, page_number);

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  content TEXT NOT NULL,
  character_count INT NOT NULL,
  token_count INT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_document_chunks_index UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_lookup ON document_chunks(workspace_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_document_chunks_pages ON document_chunks(document_id, page_start, page_end);


-- ==========================================
-- Migration: 007_ai_knowledge.sql
-- ==========================================
-- Migration: 007_ai_knowledge.sql
-- Step 4 Citations + Company Knowledge Engine Schema

-- 1. Safely extend existing ai_generations table
ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS generation_type VARCHAR(64) NOT NULL DEFAULT 'CAPTION',
  ADD COLUMN IF NOT EXISTS model VARCHAR(128),
  ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32) DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_generations_lookup ON ai_generations(workspace_id, generation_type, status);

-- 2. Create Citation Evidence Sources table
CREATE TABLE IF NOT EXISTS ai_generation_sources (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  source_excerpt TEXT NOT NULL,
  claim_key VARCHAR(128),
  confidence NUMERIC(5,2),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_sources_generation ON ai_generation_sources(workspace_id, generation_id);
CREATE INDEX IF NOT EXISTS idx_ai_sources_chunk ON ai_generation_sources(document_chunk_id);
CREATE INDEX IF NOT EXISTS idx_ai_sources_document ON ai_generation_sources(document_id);

-- 3. Create Persistent Document Knowledge table
CREATE TABLE IF NOT EXISTS document_knowledge (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  generation_id UUID REFERENCES ai_generations(id) ON DELETE SET NULL,
  knowledge_type VARCHAR(64) NOT NULL,
  knowledge_key VARCHAR(128) NOT NULL,
  value JSONB NOT NULL,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  source_excerpt TEXT NOT NULL,
  confidence NUMERIC(5,2),
  status VARCHAR(32) NOT NULL DEFAULT 'EXTRACTED', -- EXTRACTED, CONFIRMED, EDITED, REJECTED, LOCKED
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document ON document_knowledge(workspace_id, document_id, knowledge_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON document_knowledge(workspace_id, status);


-- ==========================================
-- Migration: 008_youtube_publishing.sql
-- ==========================================
ALTER TABLE content ADD COLUMN youtube jsonb;
ALTER TABLE social_account_tokens ADD COLUMN refresh_ciphertext text;
ALTER TABLE scheduled_posts ADD COLUMN upload_session_ciphertext text;
ALTER TABLE scheduled_posts ADD COLUMN processing_status text;
ALTER TABLE scheduled_posts ADD COLUMN actual_visibility text;
ALTER TABLE scheduled_posts ADD COLUMN processing_checked_at timestamptz;
ALTER TABLE scheduled_posts ADD COLUMN publish_warning text;
CREATE INDEX youtube_processing_idx ON scheduled_posts(processing_checked_at) WHERE processing_status='processing';


-- ==========================================
-- Migration: 009_batch_operations.sql
-- ==========================================
CREATE TABLE IF NOT EXISTS batch_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type IN ('ai_generation', 'bulk_save', 'bulk_approve', 'bulk_reject', 'bulk_schedule', 'bulk_publish', 'bulk_retry')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_items integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS batch_child_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  target_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  result jsonb,
  error text,
  retry_count integer NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_child_items_batch_idx ON batch_child_items(batch_id, status);
CREATE INDEX IF NOT EXISTS batch_jobs_workspace_idx ON batch_jobs(workspace_id, created_at DESC);


-- ==========================================
-- Migration: 010_posting_slots.sql
-- ==========================================
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


-- ==========================================
-- Migration: 011_notifications.sql
-- ==========================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type IN ('approval_requested', 'approved', 'rejected', 'scheduled', 'published', 'publish_failed', 'batch_completed', 'batch_partial', 'batch_failed')),
  title text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_workspace_user_idx ON notifications(workspace_id, user_id, read, created_at DESC);


-- ==========================================
-- Migration: 012_comments_and_collaboration.sql
-- ==========================================
-- Migration 012: Team Collaboration and Content Discussion

ALTER TABLE content ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id) ON DELETE SET NULL;

-- Remove rigid type CHECK constraint on notifications if present to allow collaboration types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

CREATE TABLE IF NOT EXISTS content_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES content_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS content_comments_workspace_idx ON content_comments(workspace_id);
CREATE INDEX IF NOT EXISTS content_comments_content_idx ON content_comments(content_id, created_at ASC);
CREATE INDEX IF NOT EXISTS content_comments_parent_idx ON content_comments(parent_id);
CREATE INDEX IF NOT EXISTS content_comments_author_idx ON content_comments(author_id);
CREATE INDEX IF NOT EXISTS content_assigned_to_idx ON content(workspace_id, assigned_to);


-- ==========================================
-- Migration: 013_meta_oauth.sql
-- ==========================================
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS provider text;
CREATE TABLE IF NOT EXISTS meta_oauth_pending (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES users(id),
 ciphertext text NOT NULL, expires_at timestamptz NOT NULL
);

ALTER TABLE posting_slots DROP CONSTRAINT IF EXISTS posting_slots_platform_check;
ALTER TABLE posting_slots ADD CONSTRAINT posting_slots_platform_check CHECK(platform IS NULL OR platform IN ('LinkedIn','X','Instagram','Facebook','Telegram','YouTube'));


-- ==========================================
-- Migration: 014_festival_automation.sql
-- ==========================================
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


-- ==========================================
-- Migration: 015_festival_auto_publish.sql
-- ==========================================
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


-- ==========================================
-- Migration: 016_daily_posting.sql
-- ==========================================
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS daily_posting_target integer NOT NULL DEFAULT 3 CHECK (daily_posting_target BETWEEN 1 AND 50);


-- ==========================================
-- Migration: 017_knowledge_automation.sql
-- ==========================================
-- Review-first knowledge planning. Proposed slots are not publishing jobs.
CREATE TABLE knowledge_automation_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL REFERENCES users(id),
  horizon_days integer NOT NULL DEFAULT 14 CHECK(horizon_days BETWEEN 1 AND 14),
  cooldown_days integer NOT NULL DEFAULT 90 CHECK(cooldown_days BETWEEN 1 AND 365),
  platforms jsonb NOT NULL DEFAULT '["LinkedIn"]',
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_content_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic_hash text NOT NULL,
  knowledge_id uuid REFERENCES document_knowledge(id) ON DELETE SET NULL,
  source_snapshot jsonb NOT NULL,
  proposed_at timestamptz NOT NULL,
  content_id uuid,
  state text NOT NULL DEFAULT 'GENERATING' CHECK(state IN ('GENERATING','REVIEW','COMPLETED','FAILED','DISMISSED')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 1,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id)
);
CREATE INDEX knowledge_plans_topics ON knowledge_content_plans(workspace_id,topic_hash,created_at DESC);
CREATE UNIQUE INDEX knowledge_plans_active_topic ON knowledge_content_plans(workspace_id,topic_hash) WHERE state IN ('GENERATING','REVIEW');
CREATE UNIQUE INDEX knowledge_plans_active_slot ON knowledge_content_plans(workspace_id,proposed_at) WHERE state IN ('GENERATING','REVIEW');


-- ==========================================
-- Migration: 018_document_source_media.sql
-- ==========================================
-- Source media retains page provenance independently of replaceable document_pages.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS media_extraction_status VARCHAR(16) NOT NULL DEFAULT 'PENDING';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS media_extraction_message TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS media_extraction_started_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_media_checksum ON media_assets(workspace_id, checksum)
 WHERE deleted_at IS NULL AND metadata->>'origin' = 'PDF_SOURCE';
CREATE TABLE IF NOT EXISTS document_source_media (
 id UUID PRIMARY KEY,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
 page_number INT NOT NULL CHECK (page_number > 0),
 image_index INT NOT NULL CHECK (image_index >= 0),
 kind VARCHAR(24) NOT NULL CHECK (kind IN ('EMBEDDED_IMAGE','PAGE_RENDER')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(document_id,page_number,image_index,kind)
);
CREATE INDEX IF NOT EXISTS idx_source_media_workspace ON document_source_media(workspace_id,document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_tenant_id ON documents(id,workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_tenant_id ON media_assets(id,workspace_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_document_tenant') THEN
    ALTER TABLE document_source_media ADD CONSTRAINT fk_source_document_tenant
      FOREIGN KEY(document_id,workspace_id) REFERENCES documents(id,workspace_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_source_asset_tenant') THEN
    ALTER TABLE document_source_media ADD CONSTRAINT fk_source_asset_tenant
      FOREIGN KEY(media_asset_id,workspace_id) REFERENCES media_assets(id,workspace_id) ON DELETE CASCADE;
  END IF;
END $$;



-- ==========================================
-- Migration: 019_storage_efficiency.sql
-- ==========================================
-- Managed-media budget: includes uploaded PDFs, reserved uploads, and generated assets.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT NOT NULL DEFAULT 1073741824 CHECK(storage_limit_bytes>0);
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_purged_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS source_last_referenced_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS media_extraction_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_media_budget ON media_assets(workspace_id) WHERE storage_purged_at IS NULL;
CREATE OR REPLACE FUNCTION enforce_workspace_media_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE budget bigint; used bigint;
BEGIN
 IF NEW.storage_purged_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.workspace_id=NEW.workspace_id AND OLD.storage_purged_at IS NULL AND NEW.size_bytes<=OLD.size_bytes THEN RETURN NEW; END IF;
 END IF;
 SELECT storage_limit_bytes INTO budget FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT COALESCE(SUM(size_bytes),0) INTO used FROM media_assets WHERE workspace_id=NEW.workspace_id AND storage_purged_at IS NULL AND id<>NEW.id;
 IF used+NEW.size_bytes>budget THEN
   RAISE EXCEPTION 'Workspace storage quota exceeded. Free managed storage or increase the workspace storage limit.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_media_budget ON media_assets;
CREATE TRIGGER workspace_media_budget BEFORE INSERT OR UPDATE OF size_bytes,workspace_id,storage_purged_at ON media_assets
 FOR EACH ROW EXECUTE FUNCTION enforce_workspace_media_budget();
CREATE OR REPLACE FUNCTION touch_source_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'DELETE' THEN UPDATE media_assets SET source_last_referenced_at=now() WHERE id=NEW.media_asset_id AND workspace_id=NEW.workspace_id; END IF;
 IF TG_OP<>'INSERT' THEN UPDATE media_assets SET source_last_referenced_at=now() WHERE id=OLD.media_asset_id AND workspace_id=OLD.workspace_id; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS source_media_reference_touch ON document_source_media;
CREATE TRIGGER source_media_reference_touch AFTER INSERT OR DELETE OR UPDATE ON document_source_media
 FOR EACH ROW EXECUTE FUNCTION touch_source_media_reference();



-- ==========================================
-- Migration: 020_visual_source_knowledge.sql
-- ==========================================
CREATE TABLE source_media_analysis (
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 media_asset_id UUID NOT NULL,
 ocr_status TEXT NOT NULL DEFAULT 'PENDING',
 ocr_text TEXT NOT NULL DEFAULT '',
 ocr_confidence NUMERIC,
 vision_status TEXT NOT NULL DEFAULT 'PENDING',
 observations JSONB NOT NULL DEFAULT '[]',
 provider TEXT,model TEXT,error_message TEXT,
 lease_token UUID,lease_until TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,media_asset_id),
 FOREIGN KEY(media_asset_id,workspace_id) REFERENCES media_assets(id,workspace_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_visual_knowledge_identity ON document_knowledge(document_id,knowledge_key)
 WHERE metadata->>'origin'='SOURCE_VISUAL';
CREATE UNIQUE INDEX uq_source_poster_render ON media_assets(workspace_id,(metadata->>'renderKey'))
 WHERE metadata->>'origin'='SOURCE_POSTER' AND deleted_at IS NULL;


-- ==========================================
-- Migration: 021_super_admin_sessions.sql
-- ==========================================
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


-- ==========================================
-- Migration: 022_admin_user_management.sql
-- ==========================================
ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'ACTIVE' CHECK(account_status IN ('ACTIVE','SUSPENDED','DELETED'));
ALTER TABLE users ADD COLUMN admin_note text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
ALTER TABLE system_admin_events ADD COLUMN target_user_id uuid REFERENCES users(id);
ALTER TABLE system_admin_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}';


-- ==========================================
-- Migration: 023_postgres_queue.sql
-- ==========================================
-- Additive only. Apply explicitly after approval; never from API/cron startup.
CREATE TABLE queue_jobs (
  id uuid PRIMARY KEY,
  queue text NOT NULL,
  scope text NOT NULL,
  workspace_id uuid,
  dedupe_key text NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','active','completed','failed','uncertain','cancelled')),
  priority integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_ms integer NOT NULL DEFAULT 10000 CHECK (backoff_ms >= 0),
  owner uuid,
  lease_until timestamptz,
  error_code text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(queue,scope,dedupe_key),
  CHECK ((workspace_id IS NOT NULL AND scope=workspace_id::text) OR (workspace_id IS NULL AND scope='system'))
);
CREATE INDEX queue_jobs_due ON queue_jobs(priority DESC,run_at,id) WHERE state='waiting';
CREATE INDEX queue_jobs_expired ON queue_jobs(lease_until) WHERE state='active';
CREATE INDEX queue_jobs_workspace ON queue_jobs(workspace_id,queue,state);

CREATE TABLE queue_worker_leases (
  lane text PRIMARY KEY,
  owner uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  last_started_at timestamptz NOT NULL DEFAULT now(),
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_error text
);
CREATE TABLE queue_recurring_tasks (
  name text PRIMARY KEY,
  next_run_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL CHECK(hits>0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX api_rate_limits_expiry ON api_rate_limits(expires_at);

-- Add columns already assumed by the batch consumer, absent in older migrations.
-- Existing columns and their values are preserved when already present.
ALTER TABLE batch_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE batch_child_items ADD COLUMN IF NOT EXISTS item_index integer NOT NULL DEFAULT 0;


-- ==========================================
-- Migration: 024_subscriptions.sql
-- ==========================================
-- 024_subscriptions.sql
-- Complete SaaS Subscription, Free Trials, User Management & Entitlement System

-- 1. User table enhancements: international phone number
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code text;

-- 2. Subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'INR',
  monthly_price numeric(12,2) NOT NULL,
  yearly_price numeric(12,2),
  daily_post_limit integer NOT NULL DEFAULT 3,
  is_active boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial plans
INSERT INTO subscription_plans (id, code, name, description, currency, monthly_price, yearly_price, daily_post_limit, is_active, features)
VALUES
  ('11111111-1111-4111-a111-111111111111', 'STARTER', 'Starter', 'Essential social media creation and scheduling for individuals and growing businesses.', 'INR', 15000, 150000, 3, true, '["AI Studio generation", "Up to 3 posts per day", "Content calendar & scheduler", "Connected social platforms", "Content library", "Standard support"]'::jsonb),
  ('22222222-2222-4222-a222-222222222222', 'GROWTH', 'Growth', 'Our most popular plan with festival automation and multi-channel scheduling.', 'INR', 25000, 250000, 5, true, '["Everything in Starter", "Up to 5 posts per day", "Indian Festival Automation", "Team review & approval workflows", "Multi-account simultaneous distribution", "Priority customer support"]'::jsonb),
  ('33333333-3333-4333-a333-333333333333', 'SCALE', 'Scale', 'High-volume publishing, knowledge intelligence, and priority capacity for agencies.', 'INR', 50000, 500000, 10, true, '["Everything in Growth", "Up to 10 posts per day", "Automated Knowledge Engine proposals", "Visual source media & document intelligence", "Custom posting quotas upon request", "Dedicated account assistance"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- 3. Workspace free trials (5 days = 120 hours exact duration)
CREATE TABLE IF NOT EXISTS workspace_trials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'EXTENDED')),
  extension_count integer NOT NULL DEFAULT 0,
  extension_reason text,
  daily_post_limit integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_trials_workspace_idx ON workspace_trials(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_trials_ends_at_idx ON workspace_trials(ends_at);

-- 4. Workspace subscriptions
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES subscription_plans(id),
  billing_period text NOT NULL DEFAULT 'MONTHLY' CHECK (billing_period IN ('MONTHLY', 'YEARLY')),
  status text NOT NULL DEFAULT 'TRIALING' CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED', 'SUSPENDED', 'ADMIN_GRANTED')),
  start_at timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  custom_daily_limit integer,
  admin_override_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_idx ON workspace_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_subscriptions_status_idx ON workspace_subscriptions(status);

-- 5. Payments table (Manual confirmation + online provider abstraction)
CREATE TABLE IF NOT EXISTS subscription_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES workspace_subscriptions(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES subscription_plans(id),
  billing_period text NOT NULL DEFAULT 'MONTHLY',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider text NOT NULL DEFAULT 'MANUAL' CHECK (provider IN ('MANUAL', 'RAZORPAY')),
  provider_reference text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  payment_notes text,
  payment_proof_url text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_workspace_idx ON subscription_payments(workspace_id);
CREATE INDEX IF NOT EXISTS subscription_payments_status_idx ON subscription_payments(status);

-- 6. Subscription events log
CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES workspace_subscriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_events_ws_time_idx ON subscription_events(workspace_id, created_at DESC);

-- 7. User consent collection
CREATE TABLE IF NOT EXISTS user_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version text NOT NULL DEFAULT 'v1.0',
  privacy_version text NOT NULL DEFAULT 'v1.0',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  source text NOT NULL DEFAULT 'signup'
);
CREATE INDEX IF NOT EXISTS user_consents_user_idx ON user_consents(user_id);

-- 8. Platform administrative audit logs
CREATE TABLE IF NOT EXISTS administrative_audit_logs (
  id uuid PRIMARY KEY,
  actor_username text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON administrative_audit_logs(actor_username, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx ON administrative_audit_logs(target_type, target_id);

-- 9. Backfill existing workspaces with ADMIN_GRANTED entitlement so existing production users are NEVER locked out
INSERT INTO workspace_subscriptions (
  id, workspace_id, plan_id, billing_period, status, start_at, current_period_end, custom_daily_limit, admin_override_note
)
SELECT
  gen_random_uuid(),
  w.id,
  '33333333-3333-4333-a333-333333333333',
  'YEARLY',
  'ADMIN_GRANTED',
  w.created_at,
  now() + interval '10 years',
  COALESCE(w.daily_posting_target, 10),
  'Legacy active workspace migrated with complimentary full access.'
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_subscriptions ws WHERE ws.workspace_id = w.id
);


-- ==========================================
-- Migration: 025_autopilot_posting_time.sql
-- ==========================================
-- Migration 025: Add customizable posting_time to knowledge_automation_settings
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS posting_time text NOT NULL DEFAULT '10:00';


-- ==========================================
-- Migration: 026_autopilot_mode.sql
-- ==========================================
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;


