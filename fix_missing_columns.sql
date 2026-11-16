-- ====================================================================
-- Instant Column & Feature Patch for ContentOS (Zero Data Loss)
-- Run this in phpPgAdmin SQL tab to fix any missing columns instantly!
-- ====================================================================

-- 1. Fix Autopilot & Knowledge Automation Settings
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS posting_time text NOT NULL DEFAULT '10:00';
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS poster_style text NOT NULL DEFAULT 'AI_POSTER';

-- 2. Fix Image Asset ID in Content
ALTER TABLE content ADD COLUMN IF NOT EXISTS image_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;

-- 3. Ensure Visual Storytelling Concepts Table & Columns Exist
CREATE TABLE IF NOT EXISTS document_visual_concepts (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  concept_title text NOT NULL,
  summary text NOT NULL,
  hook text NOT NULL,
  core_message text NOT NULL,
  visual_prompt text NOT NULL,
  visual_direction text NOT NULL DEFAULT 'editorial',
  slide_or_page_ref text,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'GENERATING', 'READY', 'FAILED', 'DISPATCHED')),
  target_channels jsonb DEFAULT '["linkedin"]'::jsonb,
  post_result jsonb,
  image_url text,
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  raw_image_url text,
  raw_asset_id uuid,
  scheduled_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS raw_image_url text;
ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS raw_asset_id uuid;
ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS target_channels jsonb DEFAULT '["linkedin"]'::jsonb;
ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS post_result jsonb;

-- 4. Ensure Brand Identity Table Exists
CREATE TABLE IF NOT EXISTS document_brand_identities (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  website text,
  logo_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  logo_url text,
  brand_colors jsonb NOT NULL DEFAULT '["#2563eb", "#06b6d4", "#f59e0b"]'::jsonb,
  apply_to_all_posters boolean NOT NULL DEFAULT true,
  logo_position text NOT NULL DEFAULT 'bottom-right',
  domain_position text NOT NULL DEFAULT 'bottom-center',
  logo_size text NOT NULL DEFAULT 'medium',
  safe_margin integer NOT NULL DEFAULT 32,
  status text NOT NULL DEFAULT 'PENDING_REVIEW',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Safe Permissions for cPanel database user (no error if role differs)
DO $$
BEGIN
  BEGIN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "hindust1_OneSocial";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "hindust1_OneSocial";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "hindust1_OneSocial";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "hindust1_OneSocial";
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "hindust1";
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "hindust1";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "hindust1";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "hindust1";
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

