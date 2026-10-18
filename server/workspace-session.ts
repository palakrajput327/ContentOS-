import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.js";
import type { AuthedRequest } from "./security.js";
export async function workspaceForUser(userId: string) {
  return transaction(async (db) => {
    const u = (
      await db.query(
        "SELECT name,active_workspace_id FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    const memberships = (
      await db.query(
        "SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at,w.id",
        [userId],
      )
    ).rows;
    let id =
      memberships.find((w) => w.id === u.active_workspace_id)?.id ||
      memberships[0]?.id;
    if (!id) {
      id = randomUUID();
      const name = u.name + "’s workspace";
      await db.query(
        "INSERT INTO workspaces(id,name,timezone) VALUES($1,$2,$3)",
        [id, name, "Asia/Kolkata"],
      );
      await db.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'Owner')",
        [id, userId],
      );
      await db.query(
        "INSERT INTO brand_kits(workspace_id,data) VALUES($1,$2)",
        [
          id,
          JSON.stringify({
            name,
            website: "",
            tone: "Professional",
            description: "",
            cta: "",
            forbiddenWords: "",
            hashtags: "",
          }),
        ],
      );
      // Automatic 5-day trial (exact 120 hours) with 3 posts/day allowance
      const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await db.query(
        `INSERT INTO workspace_trials(id, workspace_id, started_at, ends_at, status, daily_post_limit)
         VALUES($1, $2, now(), $3, 'ACTIVE', 3)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [randomUUID(), id, trialEndsAt],
      );
      await db.query(
        `INSERT INTO workspace_subscriptions(id, workspace_id, plan_id, billing_period, status, start_at, current_period_end, custom_daily_limit)
         VALUES($1, $2, (SELECT id FROM subscription_plans WHERE code='STARTER' LIMIT 1), 'MONTHLY', 'TRIALING', now(), $3, 3)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [randomUUID(), id, trialEndsAt],
      );
      await audit(db, id, userId, "created", "workspace", id, name);
    }
    await db.query("UPDATE users SET active_workspace_id=$2 WHERE id=$1", [
      userId,
      id,
    ]);
    return id as string;
  });
}
@Controller("workspaces")
export class WorkspaceSessionController {
  @Get() async list(@Req() r: AuthedRequest) {
    return (
      await pool.query(
        "SELECT w.id,w.name,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at,w.id",
        [r.user.id],
      )
    ).rows;
  }
  @Post("select") async select(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    const { id } = z.object({ id: z.string().uuid() }).parse(input);
    const changed = await pool.query(
      "UPDATE users SET active_workspace_id=$2 WHERE id=$1 AND EXISTS(SELECT 1 FROM workspace_members WHERE user_id=$1 AND workspace_id=$2) RETURNING id",
      [r.user.id, id],
    );
    if (!changed.rowCount)
      throw new ForbiddenException("Workspace access denied.");
    return { workspaceId: id };
  }
}
