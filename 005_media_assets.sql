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
