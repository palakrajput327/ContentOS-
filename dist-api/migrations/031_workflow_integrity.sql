ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS content_id uuid;
-- Additive workflow enforcement. Existing financial records and legacy grants retain their meaning.
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS is_simulated boolean NOT NULL DEFAULT false;
ALTER TABLE subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_status_check;
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_status_check
  CHECK (status IN ('PENDING','VERIFIED','APPROVED','REJECTED'));

ALTER TABLE workspace_subscriptions ADD COLUMN IF NOT EXISTS custom_limit_source text NOT NULL DEFAULT 'ADMIN' CHECK(custom_limit_source IN ('PLAN','TRIAL','ADMIN'));
UPDATE workspace_subscriptions SET custom_limit_source='PLAN' WHERE custom_daily_limit IS NULL;
UPDATE workspace_subscriptions ws SET custom_limit_source='TRIAL' WHERE ws.status IN ('TRIALING','EXPIRED')
  AND ws.custom_daily_limit=(SELECT daily_post_limit FROM workspace_trials WHERE workspace_id=ws.workspace_id)
  AND (ws.admin_override_note IS NULL OR ws.admin_override_note LIKE 'Extended by %');

-- A receipt of capacity attached to the existing scheduled-post identity, not a second queue.
-- No FK to content/schedule: deletion must never erase successful usage or uncertain outcomes.
CREATE TABLE IF NOT EXISTS publication_quota (
  scheduled_post_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  account_id uuid NOT NULL,
  content_version integer NOT NULL,
  business_date date NOT NULL,
  timezone text NOT NULL,
  state text NOT NULL CHECK (state IN ('RESERVED','PROCESSING','UNCERTAIN','SUCCESS','RELEASED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publication_quota_workspace_day ON publication_quota(workspace_id,business_date,state);

INSERT INTO publication_quota(scheduled_post_id,workspace_id,content_id,account_id,content_version,business_date,timezone,state)
SELECT s.id,s.workspace_id,s.content_id,s.account_id,s.content_version,
  (COALESCE(p.published_at,s.execute_at) AT TIME ZONE COALESCE(w.timezone,'Asia/Kolkata'))::date,
  COALESCE(w.timezone,'Asia/Kolkata'),
  CASE s.state WHEN 'PUBLISHED' THEN 'SUCCESS' WHEN 'PROCESSING' THEN 'PROCESSING'
    WHEN 'UNCERTAIN' THEN 'UNCERTAIN' WHEN 'FAILED' THEN 'RELEASED'
    WHEN 'CANCELLED' THEN 'RELEASED' ELSE 'RESERVED' END
FROM scheduled_posts s JOIN workspaces w ON w.id=s.workspace_id
LEFT JOIN published_posts p ON p.scheduled_post_id=s.id
ON CONFLICT(scheduled_post_id) DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS publication_quota_identity ON publication_quota(workspace_id,content_id,account_id,content_version) WHERE state IN ('RESERVED','PROCESSING','UNCERTAIN','SUCCESS');

CREATE OR REPLACE FUNCTION enforce_publication_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid uuid; tz text; day date; lim integer; used integer; active boolean;
  require_review boolean; approved uuid; next_state text; existing_state text;
BEGIN
  IF TG_OP='DELETE' THEN
    UPDATE publication_quota SET state='RELEASED',updated_at=now()
    WHERE scheduled_post_id=OLD.id AND state NOT IN ('SUCCESS','UNCERTAIN','PROCESSING');
    RETURN OLD;
  END IF;
  wid:=NEW.workspace_id;
  -- One serialization point across distinct content items, accounts, APIs and worker processes.
  PERFORM pg_advisory_xact_lock(hashtextextended(wid::text, 315031));
  SELECT COALESCE(timezone,'Asia/Kolkata'),require_approval INTO tz,require_review FROM workspaces WHERE id=wid;
  IF tz IS NULL THEN RAISE EXCEPTION 'Workspace not found' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM content WHERE id=NEW.content_id AND workspace_id=wid)
    OR NOT EXISTS(SELECT 1 FROM social_accounts WHERE id=NEW.account_id AND workspace_id=wid) THEN
    RAISE EXCEPTION 'Publication workspace mismatch' USING ERRCODE='23514';
  END IF;
  next_state:=CASE NEW.state WHEN 'PUBLISHED' THEN 'SUCCESS' WHEN 'PROCESSING' THEN 'PROCESSING'
    WHEN 'UNCERTAIN' THEN 'UNCERTAIN' WHEN 'FAILED' THEN 'RELEASED'
    WHEN 'CANCELLED' THEN 'RELEASED' ELSE 'RESERVED' END;
  SELECT state INTO existing_state FROM publication_quota WHERE scheduled_post_id=NEW.id;
  IF existing_state='SUCCESS' AND next_state='SUCCESS' THEN RETURN NEW; END IF;
  IF existing_state='SUCCESS' AND next_state<>'SUCCESS' THEN
    RAISE EXCEPTION 'Successful publication cannot be retried' USING ERRCODE='23514';
  END IF;
  IF existing_state='UNCERTAIN' AND next_state IN ('RESERVED','PROCESSING') THEN
    RAISE EXCEPTION 'Uncertain publication requires reconciliation before retry' USING ERRCODE='23514';
  END IF;
  day:=(CASE WHEN next_state IN ('PROCESSING','SUCCESS','UNCERTAIN') THEN clock_timestamp() ELSE NEW.execute_at END AT TIME ZONE tz)::date;
  IF TG_OP='INSERT' OR (next_state IN ('RESERVED','PROCESSING') AND
    (OLD.state IS DISTINCT FROM NEW.state OR OLD.execute_at IS DISTINCT FROM NEW.execute_at)) THEN
    SELECT CASE
      WHEN ws.status='ADMIN_GRANTED' THEN ws.current_period_end IS NULL OR ws.current_period_end>now()
      WHEN ws.status='ACTIVE' THEN ws.current_period_end>now()
      WHEN ws.status='TRIALING' THEN wt.ends_at>now() AND wt.status IN ('ACTIVE','EXTENDED')
      ELSE false END,
      COALESCE(ws.custom_daily_limit,CASE WHEN ws.status='TRIALING' THEN wt.daily_post_limit ELSE p.daily_post_limit END,3)
      INTO active,lim
    FROM workspace_subscriptions ws LEFT JOIN workspace_trials wt ON wt.workspace_id=ws.workspace_id
    LEFT JOIN subscription_plans p ON p.id=ws.plan_id WHERE ws.workspace_id=wid;
    IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Subscription required for publishing' USING ERRCODE='23514'; END IF;
    SELECT approved_by INTO approved FROM content WHERE id=NEW.content_id AND workspace_id=wid;
    IF (require_review OR EXISTS(SELECT 1 FROM knowledge_content_plans WHERE workspace_id=wid AND content_id=NEW.content_id)) AND approved IS NULL THEN
      RAISE EXCEPTION 'Content approval required' USING ERRCODE='23514';
    END IF;
    SELECT count(*) INTO used FROM publication_quota q WHERE workspace_id=wid AND scheduled_post_id<>NEW.id
      AND (q.business_date=day AND q.state IN ('SUCCESS','RESERVED') OR q.state IN ('PROCESSING','UNCERTAIN'));
    IF used>=lim THEN RAISE EXCEPTION 'Daily platform publication quota reached' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO publication_quota(scheduled_post_id,workspace_id,content_id,account_id,content_version,business_date,timezone,state)
  VALUES(NEW.id,wid,NEW.content_id,NEW.account_id,NEW.content_version,day,tz,next_state)
  ON CONFLICT(scheduled_post_id) DO UPDATE SET business_date=EXCLUDED.business_date,state=EXCLUDED.state,updated_at=now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS publication_quota_guard ON scheduled_posts;
CREATE TRIGGER publication_quota_guard AFTER INSERT OR UPDATE OF state,execute_at OR DELETE ON scheduled_posts
FOR EACH ROW EXECUTE FUNCTION enforce_publication_quota();
