-- Review-first knowledge planning. Proposed slots are not publishing jobs.
CREATE TABLE knowledge_automation_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL REFERENCES users(id),
  horizon_days integer NOT NULL DEFAULT 14 CHECK(horizon_days BETWEEN 1 AND 14),
  cooldown_days integer NOT NULL DEFAULT 90 CHECK(cooldown_days BETWEEN 1 AND 365),
  platforms jsonb NOT NULL DEFAULT '["LinkedIn"]',
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_content_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic_hash text NOT NULL,
  knowledge_id uuid REFERENCES document_knowledge(id) ON DELETE SET NULL,
  source_snapshot jsonb NOT NULL,
  proposed_at timestamptz NOT NULL,
  content_id uuid,
  state text NOT NULL DEFAULT 'GENERATING' CHECK(state IN ('GENERATING','REVIEW','COMPLETED','FAILED','DISMISSED')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 1,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id)
);
CREATE INDEX knowledge_plans_topics ON knowledge_content_plans(workspace_id,topic_hash,created_at DESC);
CREATE UNIQUE INDEX knowledge_plans_active_topic ON knowledge_content_plans(workspace_id,topic_hash) WHERE state IN ('GENERATING','REVIEW');
CREATE UNIQUE INDEX knowledge_plans_active_slot ON knowledge_content_plans(workspace_id,proposed_at) WHERE state IN ('GENERATING','REVIEW');
