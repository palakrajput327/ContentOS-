import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  Injectable,
  CanActivate,
  ExecutionContext,
  UseGuards,
  SetMetadata,
  HttpException,
  Query,
  Param,
  Patch,
  Delete,
} from "@nestjs/common";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { hash, Public } from "./security.js";
import { queueBackend } from './queue-backend.js';
import { createRateLimiter } from './rate-limiter.js';
import {adminUserImpact,mutateAdminUser} from './admin-users.js';

const adminCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.APP_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v1/admin",
});

function getAdminConfig() {
  const username = process.env.SYSTEM_ADMIN_USERNAME || "";
  const password = process.env.SYSTEM_ADMIN_PASSWORD || "";
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

const AdminEntry = () => SetMetadata("admin-entry", true);
async function adminSession(req: Request) {
  const token = req.cookies?.contentos_admin_session;
  const config = getAdminConfig();
  if (!config || typeof token !== "string" || token.length > 128) return null;
  const result = await pool.query(
    "SELECT username FROM system_admin_sessions WHERE token_hash=$1 AND username=$2 AND revoked_at IS NULL AND expires_at>now()",
    [hash(token), config.username],
  );
  return result.rows[0] || null;
}

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (Reflect.getMetadata("admin-entry", ctx.getHandler())) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!(await adminSession(req))) throw new ForbiddenException("Super Admin authentication required. Workspace roles do not grant platform access.");
    return true;
  }
}

@Controller("admin")
@Public()
@UseGuards(AdminGuard)
export class AdminController {
  @AdminEntry()
  @Public()
  @Post("login")
  async login(@Body() input: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const credentials = getAdminConfig();
    if (!credentials) {
      throw new ForbiddenException("System Admin credentials not configured.");
    }
    const body = z
      .object({
        username: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(128),
      })
      .parse(input);

    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const agent = (req.get("user-agent") || "").slice(0, 512);
    const attempts = await pool.query("SELECT COUNT(*)::int AS count FROM system_admin_events WHERE action='LOGIN_FAILED' AND ip_address=$1 AND created_at>now()-interval '15 minutes'", [ip]);
    if (attempts.rows[0].count >= 10) throw new HttpException("Too many admin login attempts. Try again in 15 minutes.", 429);
    const usernameMatches = timingSafeEqual(Buffer.from(hash(body.username), "hex"), Buffer.from(hash(credentials.username), "hex"));
    const passwordMatches = timingSafeEqual(Buffer.from(hash(body.password), "hex"), Buffer.from(hash(credentials.password), "hex"));
    if (!usernameMatches || !passwordMatches) {
      await pool.query("INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGIN_FAILED',$3,$4)", [randomUUID(), body.username, ip, agent]);
      throw new UnauthorizedException("Invalid System Admin credentials.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
    await transaction(async db => {
      await db.query("INSERT INTO system_admin_sessions(token_hash,username,expires_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5)", [hash(token), credentials.username, new Date(expiresAt), ip, agent]);
      await db.query("INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGIN',$3,$4)", [randomUUID(), credentials.username, ip, agent]);
    });

    res.cookie("contentos_admin_session", token, {
      ...adminCookieOptions(),
      expires: new Date(expiresAt),
    });

    return { success: true, message: "System Admin authenticated." };
  }

  @Public()
  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.contentos_admin_session;
    if (typeof token === "string") {
      await transaction(async db => {
        const revoked = await db.query("UPDATE system_admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING username", [hash(token)]);
        if (revoked.rowCount) await db.query("INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGOUT',$3,$4)", [randomUUID(), revoked.rows[0].username, req.ip, (req.get("user-agent") || "").slice(0,512)]);
      });
    }
    res.clearCookie("contentos_admin_session", adminCookieOptions());
    return { success: true, message: "System Admin logged out." };
  }

  @Public()
  @Get("me")
  async me(@Req() req: Request) {
    const session = await adminSession(req);
    if (!session) throw new UnauthorizedException("Not authenticated as Super Admin.");
    return { authenticated: true, role: "Super Admin", username: session.username };
  }

  @Get("summary")
  async summary() {
    const [usersCount, verifiedUsers, workspacesCount, membersCount, draftsCount, scheduledCount, publishedCount, accountsCount, recentEvents] =
      await Promise.all([
        pool.query("SELECT COUNT(*)::int AS cnt FROM users"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE email_verified_at IS NOT NULL"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM workspaces"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM workspace_members"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM content WHERE status = 'DRAFT'"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM content WHERE status = 'SCHEDULED'"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM content WHERE status = 'PUBLISHED'"),
        pool.query("SELECT COUNT(*)::int AS cnt FROM social_accounts WHERE state = 'Connected'"),
        pool.query(
          "SELECT e.id, e.action, e.created_at, u.email FROM auth_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.created_at DESC LIMIT 10",
        ),
      ]);

    return {
      metrics: {
        totalUsers: usersCount.rows[0]?.cnt || 0,
        verifiedUsers: verifiedUsers.rows[0]?.cnt || 0,
        activeWorkspaces: workspacesCount.rows[0]?.cnt || 0,
        workspaceMembers: membersCount.rows[0]?.cnt || 0,
        draftContent: draftsCount.rows[0]?.cnt || 0,
        scheduledContent: scheduledCount.rows[0]?.cnt || 0,
        publishedContent: publishedCount.rows[0]?.cnt || 0,
        connectedSocialAccounts: accountsCount.rows[0]?.cnt || 0,
      },
      recentSystemActivity: recentEvents.rows.map((r) => ({
        id: r.id,
        action: r.action,
        userEmail: r.email || "System",
        at: r.created_at,
      })),
    };
  }

  @Get("users")
  async users() {
    const res = await pool.query(
      `SELECT u.id, u.name, u.email, u.email_verified_at, u.created_at,u.account_status,u.admin_note,u.admin_version,
              (SELECT MAX(created_at) FROM auth_events WHERE user_id=u.id AND action='USER_LOGIN') AS last_login_at,
              (SELECT COUNT(*)::int FROM auth_events WHERE user_id=u.id AND action='USER_LOGIN') AS login_count,
              (SELECT COUNT(*)::int FROM content WHERE created_by=u.id) AS post_count,
              COALESCE(
                json_agg(
                  json_build_object('workspaceId', wm.workspace_id, 'workspaceName', w.name, 'role', CASE wm.role WHEN 'Owner' THEN 'Workspace manager' WHEN 'Admin' THEN 'Workspace admin' ELSE wm.role END)
                ) FILTER (WHERE wm.workspace_id IS NOT NULL),
                '[]'
              ) AS memberships
       FROM users u
       LEFT JOIN workspace_members wm ON wm.user_id = u.id
       LEFT JOIN workspaces w ON w.id = wm.workspace_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );

    return {
      users: res.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: !!u.email_verified_at,
        createdAt: u.created_at,
        memberships: u.memberships,
        lastLoginAt: u.last_login_at,
        loginCount: u.login_count,
        postCount: u.post_count,
        accountStatus: u.account_status,
        adminNote:u.admin_note,
        adminVersion:u.admin_version,
      })),
    };
  }

  @Get('users/:id/impact')
  async userImpact(@Param('id') id:string){return adminUserImpact(id);}
  @Patch('users/:id')
  async editUser(@Param('id') id:string,@Body() body:unknown,@Req() req:Request){return mutateAdminUser(id,body,req);}
  @Delete('users/:id')
  async deleteUser(@Param('id') id:string,@Body() body:unknown,@Req() req:Request){return mutateAdminUser(id,body,req,true);}

  @Get("workspaces")
  async workspaces() {
    const res = await pool.query(
      `SELECT w.id, w.name, w.timezone, w.created_at,
              (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = w.id) AS member_count,
              (SELECT COUNT(*)::int FROM content WHERE workspace_id = w.id) AS content_count,
              (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = w.id AND state = 'Connected') AS account_count,
              (SELECT string_agg(u.email, ', ' ORDER BY u.email) FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=w.id AND wm.role='Owner' AND u.account_status='ACTIVE') AS owner_email
       FROM workspaces w
       ORDER BY w.created_at DESC`,
    );

    return {
      workspaces: res.rows.map((w) => ({
        id: w.id,
        name: w.name,
        timezone: w.timezone,
        createdAt: w.created_at,
        memberCount: w.member_count,
        contentCount: w.content_count,
        socialAccountsCount: w.account_count,
        owner: getAdminConfig()?.username || "Platform administrator",
        status: w.member_count ? "Has members" : "No members",
      })),
    };
  }

  @Get("posts")
  async posts(@Query() input: unknown) {
    const q=z.object({page:z.coerce.number().int().min(1).default(1),search:z.string().max(100).default(''),status:z.enum(['','DRAFT','NEEDS_REVIEW','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','FAILED','UNCERTAIN']).default('')}).parse(input);
    const args=[`%${q.search}%`,q.status];
    const where="WHERE (c.title ILIKE $1 OR w.name ILIKE $1 OR u.email ILIKE $1) AND ($2='' OR c.status=$2)";
    const [count,rows]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM content c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.created_by ${where}`,args),
      pool.query(`SELECT c.id,c.title,c.body,c.status,c.platforms,c.created_at,c.updated_at,c.scheduled_at,w.name AS workspace,u.email AS creator FROM content c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.created_by ${where} ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET $3`,[...args,(q.page-1)*25]),
    ]);
    return {posts:rows.rows,total:count.rows[0].total,page:q.page,pageSize:25};
  }

  @Get("analytics")
  async analytics() {
    const [users,statuses,platforms,daily,workspaces,logins]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE email_verified_at IS NOT NULL)::int AS verified,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM auth_events e WHERE e.user_id=users.id AND e.action='USER_LOGIN'))::int AS logged_in FROM users`),
      pool.query("SELECT status,COUNT(*)::int AS count FROM content GROUP BY status ORDER BY count DESC"),
      pool.query("SELECT p.platform,COUNT(*)::int AS count FROM content c CROSS JOIN LATERAL jsonb_array_elements_text(c.platforms) p(platform) GROUP BY p.platform ORDER BY count DESC"),
      pool.query("SELECT d.day::date::text AS day,COUNT(c.id)::int AS count FROM generate_series(current_date-13,current_date,interval '1 day') d(day) LEFT JOIN content c ON c.created_at>=d.day AND c.created_at<d.day+interval '1 day' GROUP BY d.day ORDER BY d.day"),
      pool.query("SELECT w.id,w.name,COUNT(c.id)::int AS posts,COUNT(c.id) FILTER(WHERE c.status='PUBLISHED')::int AS published FROM workspaces w LEFT JOIN content c ON c.workspace_id=w.id GROUP BY w.id ORDER BY posts DESC,w.name LIMIT 10"),
      pool.query("SELECT COUNT(*)::int AS events,COUNT(DISTINCT user_id)::int AS users FROM auth_events WHERE action='USER_LOGIN' AND created_at>now()-interval '30 days'"),
    ]);
    return {users:users.rows[0],statuses:statuses.rows,platforms:platforms.rows,daily:daily.rows,workspaces:workspaces.rows,logins:logins.rows[0],engagementAvailable:false};
  }

  @Get("events")
  async events(@Query() input: unknown) {
    const q=z.object({page:z.coerce.number().int().min(1).default(1),kind:z.enum(['all','login','workspace','admin']).default('all'),search:z.string().max(100).default('')}).parse(input);
    const union=`SELECT e.id,e.action,e.created_at,u.email AS actor,'login' AS kind,NULL::text AS workspace,NULL::text AS detail,NULL::text AS ip,NULL::text AS device FROM auth_events e LEFT JOIN users u ON u.id=e.user_id
      UNION ALL SELECT a.id,a.action,a.created_at,u.email,'workspace',w.name,a.entity,NULL::text,NULL::text FROM activity_logs a LEFT JOIN users u ON u.id=a.actor_id JOIN workspaces w ON w.id=a.workspace_id
      UNION ALL SELECT e.id,e.action,e.created_at,e.username,'admin',NULL::text,u.email,e.ip_address,e.user_agent FROM system_admin_events e LEFT JOIN users u ON u.id=e.target_user_id`;
    const where="WHERE ($1='all' OR kind=$1) AND (COALESCE(actor,'System') ILIKE $2 OR action ILIKE $2 OR COALESCE(workspace,'') ILIKE $2 OR COALESCE(detail,'') ILIKE $2)";
    const args=[q.kind,`%${q.search}%`];
    const [count,rows]=await Promise.all([pool.query(`SELECT COUNT(*)::int AS total FROM (${union}) events ${where}`,args),pool.query(`SELECT * FROM (${union}) events ${where} ORDER BY created_at DESC,id LIMIT 25 OFFSET $3`,[...args,(q.page-1)*25])]);
    return {events:rows.rows,total:count.rows[0].total,page:q.page,pageSize:25};
  }

  @Get("activity")
  async activity() {
    const res = await pool.query(
      `SELECT e.id, e.action, e.created_at, e.request_id, u.name AS user_name, u.email AS user_email
       FROM auth_events e
       LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC LIMIT 100`,
    );

    return {
      activities: res.rows.map((a) => ({
        id: a.id,
        action: a.action,
        user: a.user_name ? `${a.user_name} (${a.user_email})` : "System",
        requestId: a.request_id,
        at: a.created_at,
      })),
    };
  }

  @Get("status")
  async status() {
    let pgStatus = "healthy";
    try {
      await pool.query("SELECT 1");
    } catch {
      pgStatus = "unavailable";
    }

    let redisStatus = "healthy";
    let redis: Awaited<ReturnType<typeof createRateLimiter>> | undefined;
    try {
      redis = await createRateLimiter();
      await redis.ping();
      await redis.quit();
    } catch {
      redisStatus = "unavailable";
    } finally {
      redis?.disconnect();
    }

    const smtpConfigured = !!process.env.MAIL_HOST && !!process.env.MAIL_USERNAME;

    return {
      services: {
        postgres: { status: pgStatus, note: "Configured application database" },
        redis: { status: queueBackend() === 'postgres' ? 'disabled' : redisStatus, note: 'Selected queue backend: '+queueBackend() },
        queue: { status: 'not_checked', backend:queueBackend(), note:'Inspect cron heartbeat and queue jobs to verify processing' },
        smtp: { status: smtpConfigured ? "configured" : "not_configured", note: process.env.MAIL_HOST || "Not set" },
      },
    };
  }
}
