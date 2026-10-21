import { pool } from '../dist-api/db.js';
import { KnowledgeAutomationService } from '../dist-api/knowledge/automation.service.js';

async function main() {
  const wsId = '4386cbf8-47bf-41fe-a925-0549bced08f2';

  // Ensure settings are enabled
  await pool.query(
    "UPDATE knowledge_automation_settings SET enabled = true, autopilot_enabled = true, posting_time = '16:00', updated_at = now() WHERE workspace_id = $1",
    [wsId]
  );

  const service = new KnowledgeAutomationService(pool);
  console.log('Running KnowledgeAutomationService for workspace...');
  const result = await service.run(wsId, 1);
  console.log('Automation run result:', result);

  const plans = await pool.query(
    "SELECT id, topic_hash, state, proposed_at, content_id FROM knowledge_content_plans WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 5",
    [wsId]
  );
  console.log('--- knowledge_content_plans ---');
  console.table(plans.rows);

  const content = await pool.query(
    "SELECT id, title, status, platforms, scheduled_at FROM content WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 3",
    [wsId]
  );
  console.log('--- content ---');
  console.table(content.rows);

  const sched = await pool.query(
    "SELECT sp.id, a.platform, sp.execute_at, sp.state FROM scheduled_posts sp JOIN social_accounts a ON sp.account_id = a.id WHERE sp.workspace_id = $1 ORDER BY sp.created_at DESC LIMIT 5",
    [wsId]
  );
  console.log('--- scheduled_posts ---');
  console.table(sched.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
