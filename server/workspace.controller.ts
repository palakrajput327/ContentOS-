import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Req,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "./db.js";
import {
  WorkspaceRequired,
  assertPermission,
  validateTimezone,
  type AuthedRequest,
} from "./security.js";
export const brandSchema = z.object({
  name: z.string().trim().min(1).max(100),
  website: z.union([
    z.literal(""),
    z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v)),
  ]),
  tone: z.enum([
    "Professional",
    "Corporate",
    "Educational",
    "Technical",
    "Conversational",
    "Bold",
    "Promotional",
  ]),
  description: z.string().max(4000),
  cta: z.string().max(300),
  forbiddenWords: z.string().max(1000),
  hashtags: z.string().max(500),
});
export function serializePost(p: Record<string, any>) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    variants: p.variants,
    platforms: p.platforms,
    status: p.status,
    version: p.version,
    creator: p.creator,
    createdAt: p.created_at,
    scheduledAt: p.scheduled_at,
    timezone: p.timezone,
  };
}
@Controller()
export class WorkspaceController {
  @Post("workspaces") async create(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    const v = z
      .object({ name: z.string().trim().min(1).max(100), timezone: z.string() })
      .parse(input);
    validateTimezone(v.timezone);
    const id = randomUUID();
    return transaction(async (db) => {
      await db.query(
        "INSERT INTO workspaces(id,name,timezone) VALUES($1,$2,$3)",
        [id, v.name, v.timezone],
      );
      await db.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'Owner')",
        [id, r.user.id],
      );
      await db.query(
        "INSERT INTO brand_kits(workspace_id,data) VALUES($1,$2)",
        [
          id,
          JSON.stringify({
            name: v.name,
            website: "",
            tone: "Professional",
            description: "",
            cta: "",
            forbiddenWords: "",
            hashtags: "",
          }),
        ],
      );
      await audit(db, id, r.user.id, "created", "workspace", id, v.name);
      return { id };
    });
  }
  @WorkspaceRequired() @Get("workspaces/current") async current(
    @Req() r: AuthedRequest,
  ) {
    const w = r.workspace.id;
    const [workspace, brand, posts, accounts, members, activity] =
      await Promise.all([
        pool.query("SELECT * FROM workspaces WHERE id=$1", [w]),
        pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [w]),
        pool.query(
          "SELECT c.*,u.name AS creator FROM content c JOIN users u ON u.id=c.created_by WHERE c.workspace_id=$1 ORDER BY c.created_at DESC LIMIT 500",
          [w],
        ),
        pool.query(
          "SELECT id,platform,name,state,last_sync FROM social_accounts WHERE workspace_id=$1",
          [w],
        ),
        pool.query(
          "SELECT u.id,u.name,u.email,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1",
          [w],
        ),
        pool.query(
          "SELECT a.id,COALESCE(u.name,'System') AS actor,a.action,a.entity,a.created_at FROM activity_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT 200",
          [w],
        ),
      ]);
    const ws = workspace.rows[0];
    return {
      workspace: {
        id: w,
        name: ws.name,
        timezone: ws.timezone,
        requireApproval: ws.require_approval,
        role: r.workspace.role,
      },
      brand: brand.rows[0].data,
      posts: posts.rows.map(serializePost),
      accounts: accounts.rows.map((a) => ({ ...a, lastSync: a.last_sync })),
      members: members.rows,
      activity: activity.rows.map((a) => ({ ...a, at: a.created_at })),
    };
  }
  @WorkspaceRequired() @Put("settings/brand") async brand(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const v = brandSchema.parse(input);
    return transaction(async (db) => {
      const old = await db.query(
        "SELECT data FROM brand_kits WHERE workspace_id=$1 FOR UPDATE",
        [r.workspace.id],
      );
      await db.query("UPDATE brand_kits SET data=$2 WHERE workspace_id=$1", [
        r.workspace.id,
        JSON.stringify(v),
      ]);
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "updated",
        "brand",
        r.workspace.id,
        "Brand Kit",
        old.rows[0].data,
        v,
      );
      return v;
    });
  }
  @WorkspaceRequired() @Patch("settings") async settings(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const v = z
      .object({
        name: z.string().trim().min(1).max(100),
        timezone: z.string(),
        requireApproval: z.boolean(),
      })
      .parse(input);
    validateTimezone(v.timezone);
    return transaction(async (db) => {
      const old = (
        await db.query("SELECT * FROM workspaces WHERE id=$1 FOR UPDATE", [
          r.workspace.id,
        ])
      ).rows[0];
      await db.query(
        "UPDATE workspaces SET name=$2,timezone=$3,require_approval=$4 WHERE id=$1",
        [r.workspace.id, v.name, v.timezone, v.requireApproval],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "updated",
        "workspace",
        r.workspace.id,
        v.name,
        {
          name: old.name,
          timezone: old.timezone,
          requireApproval: old.require_approval,
        },
        v,
      );
      return v;
    });
  }
  @WorkspaceRequired() @Post("members") async member(
    @Req() r: AuthedRequest,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const v = z
      .object({
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase().trim()),
        role: z.enum([
          "Admin",
          "Content Manager",
          "Editor",
          "Approver",
          "Viewer",
        ]),
      })
      .parse(input);
    if (v.role === "Admin" && r.workspace.role !== "Owner")
      throw new BadRequestException(
        "Only the workspace owner can add an administrator.",
      );
    return transaction(async (db) => {
      const u = (
        await db.query("SELECT id,name FROM users WHERE email=$1", [v.email])
      ).rows[0];
      if (!u)
        throw new NotFoundException(
          "This person needs to create an account first.",
        );
      const exists = await db.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [r.workspace.id, u.id],
      );
      if (exists.rowCount)
        throw new BadRequestException("This person is already a member.");
      await db.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)",
        [r.workspace.id, u.id, v.role],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "added member",
        "member",
        u.id,
        u.name,
        null,
        { role: v.role },
      );
      return { id: u.id };
    });
  }
}
