-- Migration 028: Add rich caption column to document_visual_concepts
ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS caption text;

