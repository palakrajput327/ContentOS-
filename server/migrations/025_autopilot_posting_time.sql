-- Migration 025: Add customizable posting_time to knowledge_automation_settings
ALTER TABLE knowledge_automation_settings ADD COLUMN IF NOT EXISTS posting_time text NOT NULL DEFAULT '10:00';
