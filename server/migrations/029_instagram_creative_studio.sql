-- --------------------------------------------------------------------
-- Migration: 029_instagram_creative_studio.sql
-- Description: Smart Brand DNA, Creative Variation Lab, and Instagram Carousel Builder
-- --------------------------------------------------------------------

-- 1. Workspace Brand DNA
CREATE TABLE IF NOT EXISTS workspace_brand_dna (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT 'Technology',
  target_audience text NOT NULL DEFAULT 'Professionals & Decision Makers',
  communication_tone text NOT NULL DEFAULT 'Professional & Authoritative',
  brand_colors jsonb NOT NULL DEFAULT '["#2563eb", "#06b6d4", "#f59e0b"]'::jsonb,
  typography_style text NOT NULL DEFAULT 'Modern Clean Sans-Serif',
  visual_style text NOT NULL DEFAULT 'Minimal High-Tech',
  logo_url text,
  logo_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  logo_position text NOT NULL DEFAULT 'top-right',
  website_domain text NOT NULL DEFAULT '',
  preferred_language text NOT NULL DEFAULT 'English',
  cta_style text NOT NULL DEFAULT 'Explore Insights & Connect',
  creative_guidelines text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'MANUAL')),
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_brand_dna_ws ON workspace_brand_dna(workspace_id);

-- 2. Creative Variations
CREATE TABLE IF NOT EXISTS creative_variations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  concept_style text NOT NULL CHECK (concept_style IN ('PREMIUM_LUXURY', 'MODERN_MINIMAL', 'BOLD_ENGAGEMENT')),
  headline text NOT NULL,
  caption text NOT NULL,
  cta text NOT NULL,
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt text NOT NULL,
  aspect_ratio text NOT NULL DEFAULT '4:5',
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  image_url text,
  raw_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  raw_image_url text,
  is_selected boolean NOT NULL DEFAULT false,
  source_topic text NOT NULL DEFAULT '',
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creative_variations_batch ON creative_variations(batch_id);
CREATE INDEX IF NOT EXISTS idx_creative_variations_ws ON creative_variations(workspace_id);

-- 3. Instagram Carousels & Slides
CREATE TABLE IF NOT EXISTS instagram_carousels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  caption text NOT NULL DEFAULT '',
  aspect_ratio text NOT NULL DEFAULT '4:5',
  slide_count integer NOT NULL DEFAULT 5,
  theme_style text NOT NULL DEFAULT 'MODERN_MINIMAL',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'SCHEDULED', 'PUBLISHED', 'FAILED')),
  content_id uuid REFERENCES content(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_carousels_ws ON instagram_carousels(workspace_id);

CREATE TABLE IF NOT EXISTS instagram_carousel_slides (
  id uuid PRIMARY KEY,
  carousel_id uuid NOT NULL REFERENCES instagram_carousels(id) ON DELETE CASCADE,
  slide_index integer NOT NULL,
  slide_type text NOT NULL CHECK (slide_type IN ('HOOK', 'CONTENT', 'CTA')),
  headline text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  badge_text text,
  prompt text NOT NULL DEFAULT '',
  aspect_ratio text NOT NULL DEFAULT '4:5',
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  image_url text,
  raw_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  raw_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carousel_id, slide_index)
);

CREATE INDEX IF NOT EXISTS idx_carousel_slides_carousel ON instagram_carousel_slides(carousel_id, slide_index ASC);

INSERT INTO schema_migrations (name, applied_at)
VALUES ('029_instagram_creative_studio.sql', now())
ON CONFLICT (name) DO NOTHING;

