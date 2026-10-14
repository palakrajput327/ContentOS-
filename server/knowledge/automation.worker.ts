import { queueBackend } from '../queue-backend.js';
import { Queue, Worker } from "bullmq";
import { pool } from "../db.js";
import { redis } from "../queues.js";
import { KnowledgeAutomationService } from "./automation.service.js";

if (queueBackend()==='postgres') throw new Error('Use cron-worker in PostgreSQL mode');
export const knowledgeAutomationQueue = new Queue("knowledge-automation", {
  connection: redis,
});
await knowledgeAutomationQueue.upsertJobScheduler(
  "knowledge-planner",
  { every: 60000 },
  {
    name: "plan",
    data: {},
    opts: { removeOnComplete: true, removeOnFail: 100 },
  },
);
export const knowledgeAutomationWorker = new Worker(
  "knowledge-automation",
  async () => {
    const workspaces = (
      await pool.query(
        "SELECT workspace_id FROM knowledge_automation_settings WHERE enabled=true AND next_run_at<=now() ORDER BY next_run_at LIMIT 10",
      )
    ).rows;
    for (const workspace of workspaces) {
      // SQL leases protect individual topics even if multiple processes run this worker.
      try {
        await new KnowledgeAutomationService().run(workspace.workspace_id);
      } catch (error: any) {
        console.error(
          JSON.stringify({
            event: "knowledge_automation_failed",
            workspaceId: workspace.workspace_id,
            message: error.message,
          }),
        );
      }
    }
  },
  { connection: redis, concurrency: 1, lockDuration: 120000 },
);
