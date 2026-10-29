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

