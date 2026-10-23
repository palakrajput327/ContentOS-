-- Managed-media budget: includes uploaded PDFs, reserved uploads, and generated assets.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT NOT NULL DEFAULT 1073741824 CHECK(storage_limit_bytes>0);
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_purged_at TIMESTAMPTZ;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS source_last_referenced_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS media_extraction_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_media_budget ON media_assets(workspace_id) WHERE storage_purged_at IS NULL;
CREATE OR REPLACE FUNCTION enforce_workspace_media_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE budget bigint; used bigint;
BEGIN
 IF NEW.storage_purged_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.workspace_id=NEW.workspace_id AND OLD.storage_purged_at IS NULL AND NEW.size_bytes<=OLD.size_bytes THEN RETURN NEW; END IF;
 END IF;
 SELECT storage_limit_bytes INTO budget FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT COALESCE(SUM(size_bytes),0) INTO used FROM media_assets WHERE workspace_id=NEW.workspace_id AND storage_purged_at IS NULL AND id<>NEW.id;
 IF used+NEW.size_bytes>budget THEN
   RAISE EXCEPTION 'Workspace storage quota exceeded. Free managed storage or increase the workspace storage limit.' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_media_budget ON media_assets;
CREATE TRIGGER workspace_media_budget BEFORE INSERT OR UPDATE OF size_bytes,workspace_id,storage_purged_at ON media_assets
 FOR EACH ROW EXECUTE FUNCTION enforce_workspace_media_budget();
CREATE OR REPLACE FUNCTION touch_source_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'DELETE' THEN UPDATE media_assets SET source_last_referenced_at=now() WHERE id=NEW.media_asset_id AND workspace_id=NEW.workspace_id; END IF;
 IF TG_OP<>'INSERT' THEN UPDATE media_assets SET source_last_referenced_at=now() WHERE id=OLD.media_asset_id AND workspace_id=OLD.workspace_id; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS source_media_reference_touch ON document_source_media;
CREATE TRIGGER source_media_reference_touch AFTER INSERT OR DELETE OR UPDATE ON document_source_media
 FOR EACH ROW EXECUTE FUNCTION touch_source_media_reference();

