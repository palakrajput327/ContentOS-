import { pool } from '../dist-api/db.js';
import { KnowledgeAutomationService } from '../dist-api/knowledge/automation.service.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const user = (await pool.query("SELECT id FROM users WHERE email='geminipalak19@gmail.com'")).rows[0];
  console.log('--- Triggering AutoPilot for Workspace ---');
  
  const service = new KnowledgeAutomationService(pool);
  const res = await service.runAutoPilot(wid, user.id);
  console.log('AutoPilot Result:', res);

  const plans = (await pool.query(`
    SELECT p.id, p.content_id, c.title, c.platforms, c.scheduled_at, s.state AS publish_state, s.execute_at
    FROM knowledge_content_plans p
    LEFT JOIN content c ON c.id=p.content_id
    LEFT JOIN scheduled_posts s ON s.content_id=c.id
    WHERE p.workspace_id=$1
    ORDER BY p.created_at DESC LIMIT 5
  `, [wid])).rows;

  console.log('Recent Generated Plans & Schedules:');
  for (const pl of plans) {
    console.log({
      plan_id: pl.id,
      title: pl.title,
      scheduled_at: pl.scheduled_at || pl.execute_at,
      publish_state: pl.publish_state,
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error running autopilot:', err);
  process.exit(1);
});
