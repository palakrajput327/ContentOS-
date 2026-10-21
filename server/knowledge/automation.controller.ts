import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { pool, transaction, audit } from "../db.js";
import {
  assertPermission,
  WorkspaceRequired,
  type AuthedRequest,
} from "../security.js";
import { knowledgePool } from "./automation.service.js";

export const automationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    horizonDays: z.number().int().min(1).max(14),
    cooldownDays: z.number().int().min(1).max(365),
    platforms: z
      .array(z.enum(["LinkedIn", "Telegram", "X", "Facebook", "Instagram"]))
      .min(1)
      .max(5)
      .refine(
        (p) => new Set(p).size === p.length,
        "Choose each platform once.",
      ),
    postingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("10:00").optional(),
  })
  .strict();

@WorkspaceRequired()
@Controller("knowledge-automation")
export class KnowledgeAutomationController {
  @Get() async overview(@Req() r: AuthedRequest) {
    const workspaceId = r.workspace.id;
    const [topics, settings, plans, workspace, accounts] = await Promise.all([
      knowledgePool(pool, workspaceId),
      pool.query(
        "SELECT * FROM knowledge_automation_settings WHERE workspace_id=$1",
        [workspaceId],
      ),
      pool.query(
        `SELECT p.*,c.title,c.status AS content_status,c.variants,c.platforms,c.scheduled_at FROM knowledge_content_plans p
        LEFT JOIN content c ON c.id=p.content_id AND c.workspace_id=p.workspace_id
        WHERE p.workspace_id=$1 ORDER BY p.created_at DESC LIMIT 100`,
        [workspaceId],
      ),
      pool.query(
        `SELECT timezone, daily_posting_target, festival_automation_enabled, 
                festival_auto_publish_enabled, festival_approval_mode, 
                festival_post_time, festival_region, festival_language 
         FROM workspaces WHERE id=$1`,
        [workspaceId],
      ),
      pool.query(
        "SELECT platform,name FROM social_accounts WHERE workspace_id=$1 AND lower(state)='connected'",
        [workspaceId],
      ),
    ]);
    return {
      topics,
      settings: settings.rows[0] || {
        enabled: false,
        horizon_days: 14,
        cooldown_days: 90,
        platforms: ["LinkedIn"],
        posting_time: "10:00",
      },
      plans: plans.rows,
      workspace: workspace.rows[0],
      accounts: accounts.rows,
      canManage: ["Owner", "Admin"].includes(r.workspace.role),
      canEdit: ["Owner", "Admin", "Content Manager", "Editor"].includes(
        r.workspace.role,
      ),
      mode: "REVIEW",
    };
  }
  @Patch("settings") async settings(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const value = automationSettingsSchema.parse(input);
    return transaction(async (db) => {
      await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        r.workspace.id,
      ]);
      const previous = (
        await db.query(
          "SELECT * FROM knowledge_automation_settings WHERE workspace_id=$1",
          [r.workspace.id],
        )
      ).rows[0];
      const result = (
        await db.query(
          `INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled,horizon_days,cooldown_days,platforms,posting_time)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,'10:00')) 
        ON CONFLICT(workspace_id) DO UPDATE SET actor_id=$2,enabled=$3,horizon_days=$4,cooldown_days=$5,platforms=$6,posting_time=COALESCE($7,knowledge_automation_settings.posting_time,'10:00'),next_run_at=now(),updated_at=now() RETURNING *`,
          [
            r.workspace.id,
            r.user.id,
            value.enabled,
            value.horizonDays,
            value.cooldownDays,
            JSON.stringify(value.platforms),
            value.postingTime || "10:00",
          ],
        )
      ).rows[0];
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        value.enabled
          ? "KNOWLEDGE_AUTOMATION_ENABLED"
          : "KNOWLEDGE_AUTOMATION_PAUSED",
        "workspace",
        r.workspace.id,
        "Knowledge automation",
        previous,
        result,
      );
      return result;
    });
  }
  @Post("run") async run(@Req() r: AuthedRequest) {
    assertPermission(r.workspace.role, "manage");
    const config = (
      await pool.query(
        "SELECT enabled FROM knowledge_automation_settings WHERE workspace_id=$1",
        [r.workspace.id],
      )
    ).rows[0];
    if (!config?.enabled)
      throw new BadRequestException(
        "Enable and save automation before running the planner.",
      );
    // Request work durably; the dedicated worker performs AI calls asynchronously.
    await pool.query(
      "UPDATE knowledge_automation_settings SET next_run_at=now() WHERE workspace_id=$1",
      [r.workspace.id],
    );
    return { requested: true };
  }

  @Post("auto-pilot")
  async autoPilot(
    @Req() r: AuthedRequest,
    @Body() input?: { documentId?: string },
  ) {
    assertPermission(r.workspace.role, "edit");
    const { KnowledgeAutomationService } = await import("./automation.service.js");
    const service = new KnowledgeAutomationService(pool);
    assertPermission(r.workspace.role, "manage");
    const value = z.object({documentId:z.string().uuid().optional()}).strict().parse(input || {});
    const result = await service.runAutoPilot(r.workspace.id, r.user.id, value.documentId);
    return {
      success: true,
      generated: result.generated,
      festivalEnabled: true,
      requested: result.requested,
      message: "Auto-pilot enabled. Background generation is queued. Generated, scheduled and published results will appear separately in history; no publication has been confirmed yet.",
    };
  }
  @Post("plans/:id/retry") async retry(
    @Req() r: AuthedRequest,
    @Param("id") rawId: string,
  ) {
    assertPermission(r.workspace.role, "manage");
    const id = z.string().uuid().parse(rawId);
    return transaction(async (db) => {
      await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        r.workspace.id,
      ]);
      const plan = (
        await db.query(
          "SELECT * FROM knowledge_content_plans WHERE id=$1 AND workspace_id=$2 AND state='FAILED' AND content_id IS NULL",
          [id, r.workspace.id],
        )
      ).rows[0];
      if (!plan)
        throw new NotFoundException(
          "Retry is available only for failed generation in this workspace.",
        );
      await db.query(
        "UPDATE knowledge_content_plans SET attempts=0,updated_at=now()-interval '16 minutes' WHERE workspace_id=$1 AND topic_hash=$2 AND state='FAILED' AND content_id IS NULL",
        [r.workspace.id, plan.topic_hash],
      );
      await db.query(
        "UPDATE knowledge_automation_settings SET next_run_at=now() WHERE workspace_id=$1",
        [r.workspace.id],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "KNOWLEDGE_GENERATION_RETRY",
        "knowledge_plan",
        id,
        "Knowledge proposal",
      );
      return { requested: true };
    });
  }
  @Post("plans/:id/dismiss") async dismiss(
    @Req() r: AuthedRequest,
    @Param("id") rawId: string,
  ) {
    assertPermission(r.workspace.role, "manage");
    const id = z.string().uuid().parse(rawId);
    return transaction(async (db) => {
      await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        r.workspace.id,
      ]);
      const plan = (
        await db.query(
          `SELECT p.* FROM knowledge_content_plans p JOIN content c ON c.id=p.content_id AND c.workspace_id=p.workspace_id
        WHERE p.id=$1 AND p.workspace_id=$2 AND p.state='REVIEW' AND c.status IN ('DRAFT','NEEDS_REVIEW') FOR UPDATE OF c,p`,
          [id, r.workspace.id],
        )
      ).rows[0];
      if (!plan)
        throw new BadRequestException(
          "Only unapproved proposals can be dismissed.",
        );
      await db.query(
        "UPDATE knowledge_content_plans SET state='DISMISSED',updated_at=now() WHERE id=$1",
        [id],
      );
      await db.query(
        "UPDATE content SET status='DRAFT',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",
        [plan.content_id, r.user.id],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "KNOWLEDGE_PROPOSAL_DISMISSED",
        "content",
        plan.content_id,
        "Knowledge proposal",
      );
      return { dismissed: true };
    });
  }
}
