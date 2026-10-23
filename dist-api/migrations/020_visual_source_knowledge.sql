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
