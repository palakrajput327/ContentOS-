-- Preserve approval checks for automated sources while allowing manual drafts to publish.
CREATE OR REPLACE FUNCTION publication_requires_approval(wid uuid, cid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM knowledge_content_plans WHERE workspace_id=wid AND content_id=cid)
    OR EXISTS(
      SELECT 1 FROM workspaces w WHERE w.id=wid AND w.require_approval AND (
        EXISTS(SELECT 1 FROM instagram_carousels WHERE workspace_id=wid AND content_id=cid)
        OR EXISTS(SELECT 1 FROM document_visual_concepts WHERE workspace_id=wid AND content_id=cid)
        OR EXISTS(SELECT 1 FROM scheduled_festival_posts WHERE workspace_id=wid AND content_id=cid)
      )
    );
$$;

CREATE OR REPLACE FUNCTION enforce_publication_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid uuid; tz text; day date; lim integer; used integer; active boolean;
  approval_status text; approved uuid; next_state text; existing_state text;
BEGIN
  IF TG_OP='DELETE' THEN
    UPDATE publication_quota SET state='RELEASED',updated_at=now()
    WHERE scheduled_post_id=OLD.id AND state NOT IN ('SUCCESS','UNCERTAIN','PROCESSING');
    RETURN OLD;
  END IF;
  wid:=NEW.workspace_id;
  -- One serialization point across distinct content items, accounts, APIs and worker processes.
  PERFORM pg_advisory_xact_lock(hashtextextended(wid::text, 315031));
  SELECT COALESCE(timezone,'Asia/Kolkata') INTO tz FROM workspaces WHERE id=wid;
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
    SELECT approved_by,status INTO approved,approval_status FROM content WHERE id=NEW.content_id AND workspace_id=wid;
    IF approval_status='NEEDS_REVIEW' OR (publication_requires_approval(wid,NEW.content_id) AND approved IS NULL) THEN
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
