-- Visual concepts generated from documents
CREATE TABLE IF NOT EXISTS document_visual_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  concept_title text NOT NULL,
  source_page integer NOT NULL DEFAULT 1,
  source_excerpt text NOT NULL DEFAULT '',
  prompt text NOT NULL,
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  image_url text,
  raw_image_url text,
  raw_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING',
  scheduled_at timestamptz,
  dispatched_at timestamptz,
  target_channels jsonb NOT NULL DEFAULT '["linkedin"]'::jsonb,
  post_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_visual_concepts_doc ON document_visual_concepts(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_visual_concepts_ws ON document_visual_concepts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_doc_visual_concepts_status ON document_visual_concepts(workspace_id, status);

-- Per-PDF Brand Identity
CREATE TABLE IF NOT EXISTS document_brand_identities (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  logo_url text,
  logo_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  website_domain text NOT NULL DEFAULT '',
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

ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS raw_image_url text;
ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS raw_asset_id uuid;
