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
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { hash, Public } from "./security.js";
import { Redis } from "ioredis";

const adminCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.APP_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v1/admin",
});

function getAdminConfig() {
  const env = process.env.APP_ENV || "development";
  const username = process.env.SYSTEM_ADMIN_USERNAME || (env !== "production" ? "ADMIN" : "");
  const password = process.env.SYSTEM_ADMIN_PASSWORD || (env !== "production" ? "ADMIN@123" : "");
  if (!username || !password) {
    return null;
  }
  return { username, password };
}

// In-memory / DB backed admin session store
const adminSessions = new Map<string, { expiresAt: number }>();

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.contentos_admin_session;
    if (typeof token !== "string") {
      throw new ForbiddenException("System Admin authentication required.");
    }
    const session = adminSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      adminSessions.delete(token);
      throw new ForbiddenException("System Admin session expired.");
    }
    return true;
  }
}

@Controller("admin")
export class AdminController {
  @Public()
  @Post("login")
  async login(@Body() input: unknown, @Res({ passthrough: true }) res: Response) {
    const credentials = getAdminConfig();
    if (!credentials) {
      throw new ForbiddenException("System Admin credentials not configured.");
    }
    const body = z
      .object({
        username: z.string().trim(),
        password: z.string().trim(),
      })
      .parse(input);

    if (body.username !== credentials.username || body.password !== credentials.password) {
      throw new UnauthorizedException("Invalid System Admin credentials.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
    adminSessions.set(token, { expiresAt });

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
      adminSessions.delete(token);
    }
    res.clearCookie("contentos_admin_session", adminCookieOptions());
    return { success: true, message: "System Admin logged out." };
  }

  @Public()
  @Get("me")
  async me(@Req() req: Request) {
    const token = req.cookies?.contentos_admin_session;
    if (typeof token !== "string") {
      throw new UnauthorizedException("Not authenticated as System Admin.");
    }
    const session = adminSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      adminSessions.delete(token);
      throw new UnauthorizedException("System Admin session expired.");
    }
    return { authenticated: true, role: "System Admin" };
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
      `SELECT u.id, u.name, u.email, u.email_verified_at, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object('workspaceId', wm.workspace_id, 'workspaceName', w.name, 'role', wm.role)
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
        accountStatus: "Active",
      })),
    };
  }

  @Get("workspaces")
  async workspaces() {
    const res = await pool.query(
      `SELECT w.id, w.name, w.timezone, w.created_at,
              (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = w.id) AS member_count,
              (SELECT COUNT(*)::int FROM content WHERE workspace_id = w.id) AS content_count,
              (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = w.id AND state = 'Connected') AS account_count,
              u.name AS owner_name, u.email AS owner_email
       FROM workspaces w
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.role = 'Owner'
       LEFT JOIN users u ON u.id = wm.user_id
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
        owner: w.owner_name ? `${w.owner_name} (${w.owner_email})` : "Unassigned",
        status: "Active",
      })),
    };
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
    try {
      const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:63799", {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
      });
      await redis.ping();
      await redis.quit();
    } catch {
      redisStatus = "unavailable";
    }

    const smtpConfigured = !!process.env.MAIL_HOST && !!process.env.MAIL_USERNAME;

    return {
      services: {
        postgres: { status: pgStatus, note: "Local PostgreSQL DB" },
        redis: { status: redisStatus, note: "Local Redis instance" },
        queue: { status: redisStatus === "healthy" ? "healthy" : "degraded", note: "BullMQ on Redis" },
        smtp: { status: smtpConfigured ? "configured" : "not_configured", note: process.env.MAIL_HOST || "Not set" },
      },
    };
  }
}
