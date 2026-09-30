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
