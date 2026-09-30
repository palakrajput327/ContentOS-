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
