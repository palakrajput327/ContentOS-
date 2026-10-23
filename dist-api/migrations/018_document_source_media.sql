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

