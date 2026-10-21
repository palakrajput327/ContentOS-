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
  NotFoundException,
} from "@nestjs/common";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { hash, Public } from "./security.js";
import { queueBackend } from "./queue-backend.js";
import { createRateLimiter } from "./rate-limiter.js";
import {
  adminUserImpact,
  adminUserDetail,
  mutateAdminUser,
  adminResetPassword,
} from "./admin-users.js";

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
    if (!(await adminSession(req)))
      throw new ForbiddenException(
        "Super Admin authentication required. Workspace roles do not grant platform access.",
      );
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
  async login(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
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
    const attempts = await pool.query(
      "SELECT COUNT(*)::int AS count FROM system_admin_events WHERE action='LOGIN_FAILED' AND ip_address=$1 AND created_at>now()-interval '15 minutes'",
      [ip],
    );
    if (attempts.rows[0].count >= 10)
      throw new HttpException(
        "Too many admin login attempts. Try again in 15 minutes.",
        429,
      );
    const usernameMatches = timingSafeEqual(
      Buffer.from(hash(body.username), "hex"),
      Buffer.from(hash(credentials.username), "hex"),
    );
    const passwordMatches = timingSafeEqual(
      Buffer.from(hash(body.password), "hex"),
      Buffer.from(hash(credentials.password), "hex"),
    );
    if (!usernameMatches || !passwordMatches) {
      await pool.query(
        "INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGIN_FAILED',$3,$4)",
        [randomUUID(), body.username, ip, agent],
      );
      throw new UnauthorizedException("Invalid System Admin credentials.");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
    await transaction(async (db) => {
      await db.query(
        "INSERT INTO system_admin_sessions(token_hash,username,expires_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5)",
        [hash(token), credentials.username, new Date(expiresAt), ip, agent],
      );
      await db.query(
        "INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGIN',$3,$4)",
        [randomUUID(), credentials.username, ip, agent],
      );
    });

    res.cookie("contentos_admin_session", token, {
      ...adminCookieOptions(),
      expires: new Date(expiresAt),
    });

    return { success: true, message: "System Admin authenticated." };
  }

  @Public()
  @Post("logout")
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.contentos_admin_session;
    if (typeof token === "string") {
      await transaction(async (db) => {
        const revoked = await db.query(
          "UPDATE system_admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING username",
          [hash(token)],
        );
        if (revoked.rowCount)
          await db.query(
            "INSERT INTO system_admin_events(id,username,action,ip_address,user_agent) VALUES($1,$2,'LOGOUT',$3,$4)",
            [
              randomUUID(),
              revoked.rows[0].username,
              req.ip,
              (req.get("user-agent") || "").slice(0, 512),
            ],
          );
      });
    }
    res.clearCookie("contentos_admin_session", adminCookieOptions());
    return { success: true, message: "System Admin logged out." };
  }

  @Public()
  @Get("me")
  async me(@Req() req: Request) {
    const session = await adminSession(req);
    if (!session)
      throw new UnauthorizedException("Not authenticated as Super Admin.");
    return {
      authenticated: true,
      role: "Super Admin",
      username: session.username,
    };
  }

  @Get("summary")
  async summary() {
    const [
      usersCount,
      verifiedUsers,
      activeUsers,
      suspendedUsers,
      deletedUsers,
      trialUsers,
      paidUsers,
      expiredUsers,
      workspacesCount,
      revenueMonthly,
      revenueAnnual,
      pendingPayments,
      expiringSoon,
      recentEvents,
      planDistribution,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS cnt FROM users"),
      pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE email_verified_at IS NOT NULL"),
      pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE account_status = 'ACTIVE'"),
      pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE account_status = 'SUSPENDED'"),
      pool.query("SELECT COUNT(*)::int AS cnt FROM users WHERE account_status = 'DELETED'"),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM workspace_subscriptions WHERE status = 'TRIALING' AND current_period_end > now()`),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM workspace_subscriptions WHERE status IN ('ACTIVE', 'ADMIN_GRANTED')`),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM workspace_subscriptions WHERE (status = 'EXPIRED') OR (status = 'TRIALING' AND current_period_end <= now())`),
      pool.query("SELECT COUNT(*)::int AS cnt FROM workspaces"),
      pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total FROM subscription_payments WHERE status = 'VERIFIED' AND billing_period = 'MONTHLY'`),
      pool.query(`SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total FROM subscription_payments WHERE status = 'VERIFIED' AND billing_period = 'YEARLY'`),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM subscription_payments WHERE status = 'PENDING'`),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM workspace_subscriptions WHERE current_period_end BETWEEN now() AND now() + interval '7 days' AND status IN ('ACTIVE', 'TRIALING')`),
      pool.query(
        `SELECT e.id, e.action, e.created_at, u.email
         FROM auth_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT 10`,
      ),
      pool.query(
        `SELECT COALESCE(p.name, 'Trial') AS plan_name, COUNT(ws.id)::int AS count
         FROM workspace_subscriptions ws
         LEFT JOIN subscription_plans p ON p.id = ws.plan_id
         GROUP BY COALESCE(p.name, 'Trial')
         ORDER BY count DESC`,
      ),
    ]);

    const totalRevenue =
      Number(revenueMonthly.rows[0]?.total || 0) +
      Number(revenueAnnual.rows[0]?.total || 0);

    return {
      metrics: {
        totalUsers: usersCount.rows[0]?.cnt || 0,
        verifiedUsers: verifiedUsers.rows[0]?.cnt || 0,
        activeUsers: activeUsers.rows[0]?.cnt || 0,
        suspendedUsers: suspendedUsers.rows[0]?.cnt || 0,
        deletedUsers: deletedUsers.rows[0]?.cnt || 0,
        trialUsers: trialUsers.rows[0]?.cnt || 0,
        paidSubscribers: paidUsers.rows[0]?.cnt || 0,
        expiredUsers: expiredUsers.rows[0]?.cnt || 0,
        activeWorkspaces: workspacesCount.rows[0]?.cnt || 0,
        monthlyRevenue: Number(revenueMonthly.rows[0]?.total || 0),
        annualRevenue: Number(revenueAnnual.rows[0]?.total || 0),
        totalVerifiedRevenue: totalRevenue,
        pendingPayments: pendingPayments.rows[0]?.cnt || 0,
        expiringSubscriptions: expiringSoon.rows[0]?.cnt || 0,
      },
      planDistribution: planDistribution.rows,
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
      `SELECT u.id, u.name, u.email, u.phone_number, u.phone_country_code,
              u.email_verified_at, u.created_at, u.account_status, u.admin_note, u.admin_version,
              (SELECT MAX(created_at) FROM auth_events WHERE user_id = u.id AND action = 'USER_LOGIN') AS last_login_at,
              (SELECT COUNT(*)::int FROM auth_events WHERE user_id = u.id AND action = 'USER_LOGIN') AS login_count,
              (SELECT COUNT(*)::int FROM content WHERE created_by = u.id) AS post_count,
              ws.status AS subscription_status,
              ws.billing_period,
              ws.start_at AS subscription_start,
              ws.current_period_end AS subscription_expiry,
              COALESCE(ws.custom_daily_limit, p.daily_post_limit, wt.daily_post_limit, 3) AS daily_posting_limit,
              p.code AS plan_code,
              p.name AS plan_name,
              wt.ends_at AS trial_expiry,
              wt.status AS trial_status,
              COALESCE(
                json_agg(
                  json_build_object(
                    'workspaceId', wm.workspace_id,
                    'workspaceName', w.name,
                    'role', CASE wm.role WHEN 'Owner' THEN 'Workspace manager' WHEN 'Admin' THEN 'Workspace admin' ELSE wm.role END
                  )
                ) FILTER (WHERE wm.workspace_id IS NOT NULL),
                '[]'
              ) AS memberships
       FROM users u
       LEFT JOIN workspace_members wm ON wm.user_id = u.id
       LEFT JOIN workspaces w ON w.id = wm.workspace_id
       LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = COALESCE(u.active_workspace_id,
         (SELECT workspace_id FROM workspace_members WHERE user_id=u.id ORDER BY workspace_id LIMIT 1))
       LEFT JOIN subscription_plans p ON p.id = ws.plan_id
       LEFT JOIN workspace_trials wt ON wt.workspace_id = COALESCE(u.active_workspace_id,
         (SELECT workspace_id FROM workspace_members WHERE user_id=u.id ORDER BY workspace_id LIMIT 1))
       GROUP BY u.id, ws.status, ws.billing_period, ws.start_at, ws.current_period_end,
                ws.custom_daily_limit, p.daily_post_limit, wt.daily_post_limit, p.code, p.name,
                wt.ends_at, wt.status
       ORDER BY u.created_at DESC`,
    );

    return {
      users: res.rows.map((u) => {
        // Calculate dynamic subscription status based on current timestamp
        let displayStatus = u.subscription_status || "EXPIRED";
        const now = new Date();
        if (displayStatus === "TRIALING") {
          if (!u.trial_expiry || new Date(u.trial_expiry) <= now || u.trial_status === "EXPIRED") {
            displayStatus = "EXPIRED";
          }
        } else if (["ACTIVE", "ADMIN_GRANTED"].includes(displayStatus)) {
          if ((displayStatus === "ACTIVE" && !u.subscription_expiry) || (u.subscription_expiry && new Date(u.subscription_expiry) <= now)) {
            displayStatus = "EXPIRED";
          }
        }

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone_number ? `${u.phone_country_code || "+91"} ${u.phone_number}` : "Not recorded",
          phoneNumber: u.phone_number || "",
          phoneCountryCode: u.phone_country_code || "+91",
          emailVerified: !!u.email_verified_at,
          createdAt: u.created_at,
          memberships: u.memberships,
          lastLoginAt: u.last_login_at,
          loginCount: u.login_count,
          postCount: u.post_count,
          accountStatus: u.account_status,
          subscriptionStatus: displayStatus,
          planName: u.plan_name || (displayStatus === "TRIALING" ? "Free Trial" : "No Plan"),
          planCode: u.plan_code || "NONE",
          trialExpiry: u.trial_expiry,
          subscriptionExpiry: u.subscription_expiry,
          dailyPostingLimit: Number(u.daily_posting_limit) || 3,
          adminNote: u.admin_note,
          adminVersion: u.admin_version,
        };
      }),
    };
  }

  @Get("users/:id/details")
  async userDetails(@Param("id") id: string) {
    return adminUserDetail(id);
  }

  @Get("users/:id/impact")
  async userImpact(@Param("id") id: string) {
    return adminUserImpact(id);
  }

  @Patch("users/:id")
  async editUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return mutateAdminUser(id, body, req);
  }

  @Delete("users/:id")
  async deleteUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return mutateAdminUser(id, body, req, true);
  }

  @Post("users/:id/password-reset")
  async resetPassword(
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return adminResetPassword(id, req);
  }

  // ==============================================================
  // SUBSCRIPTIONS MANAGEMENT
  // ==============================================================

  @Get("subscriptions")
  async getSubscriptions() {
    const res = await pool.query(
      `SELECT
         ws.id,
         ws.workspace_id,
         w.name AS workspace_name,
         u.email AS owner_email,
         u.name AS owner_name,
         ws.status,
         ws.billing_period,
         ws.start_at,
         ws.current_period_end,
         ws.cancel_at_period_end,
         ws.custom_daily_limit,
         ws.admin_override_note,
         p.id AS plan_id,
         p.code AS plan_code,
         p.name AS plan_name,
         p.monthly_price,
         p.yearly_price,
         COALESCE(ws.custom_daily_limit, p.daily_post_limit, 3) AS daily_limit,
         wt.ends_at AS trial_ends_at,
         wt.status AS trial_status
       FROM workspace_subscriptions ws
       JOIN workspaces w ON w.id = ws.workspace_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.role = 'Owner'
       LEFT JOIN users u ON u.id = wm.user_id
       LEFT JOIN subscription_plans p ON p.id = ws.plan_id
       LEFT JOIN workspace_trials wt ON wt.workspace_id = w.id
       ORDER BY ws.updated_at DESC`,
    );

    return {
      subscriptions: res.rows.map((s) => ({
        id: s.id,
        workspaceId: s.workspace_id,
        workspaceName: s.workspace_name,
        ownerEmail: s.owner_email || "System",
        ownerName: s.owner_name || "Workspace Manager",
        status: s.status,
        billingPeriod: s.billing_period,
        startAt: s.start_at,
        currentPeriodEnd: s.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        customDailyLimit: s.custom_daily_limit,
        dailyPostingLimit: Number(s.daily_limit),
        adminOverrideNote: s.admin_override_note,
        planId: s.plan_id,
        planCode: s.plan_code || "NONE",
        planName: s.plan_name || "Trial",
        monthlyPrice: s.monthly_price ? Number(s.monthly_price) : 0,
        yearlyPrice: s.yearly_price ? Number(s.yearly_price) : 0,
        trialEndsAt: s.trial_ends_at,
        trialStatus: s.trial_status,
      })),
    };
  }

  @Post("subscriptions/:id/activate")
  async activateSubscription(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        planCode: z.enum(["STARTER", "GROWTH", "SCALE"]).default("GROWTH"),
        billingPeriod: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
        months: z.number().int().min(1).max(36).default(1),
        complimentary: z.boolean().default(false),
        note: z.string().trim().max(500).optional(),
        customDailyLimit: z.number().int().min(1).max(50).optional(),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const plan = (
        await db.query(
          "SELECT id, code, name, daily_post_limit FROM subscription_plans WHERE code = $1",
          [v.planCode],
        )
      ).rows[0];

      if (!plan) throw new NotFoundException("Plan not found");

      const sub = (
        await db.query(
          "SELECT * FROM workspace_subscriptions WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];

      if (!sub) throw new NotFoundException("Subscription not found");

      const now = new Date();
      const currentEnd = sub.current_period_end && new Date(sub.current_period_end) > now
        ? new Date(sub.current_period_end)
        : now;

      const durationMs = v.billingPeriod === "YEARLY"
        ? 365 * 24 * 60 * 60 * 1000
        : v.months * 30 * 24 * 60 * 60 * 1000;

      const nextEnd = new Date(currentEnd.getTime() + durationMs);
      const nextStatus = v.complimentary ? "ADMIN_GRANTED" : "ACTIVE";

      await db.query(
        `UPDATE workspace_subscriptions
         SET plan_id = $2,
             billing_period = $3,
             status = $4,
             current_period_end = $5,
             custom_daily_limit = $6,
             admin_override_note = $7,
             cancel_at_period_end = false,
             updated_at = now()
         WHERE id = $1`,
        [
          id,
          plan.id,
          v.billingPeriod,
          nextStatus,
          nextEnd,
          v.customDailyLimit || null,
          v.note || (v.complimentary ? "Complimentary access granted by Super Admin" : "Subscription activated by Super Admin"),
        ],
      );

      // Audit log
      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'subscription', $3, 'SUBSCRIPTION_ACTIVATED', $4, $5, $6, $7)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify({ status: sub.status, current_period_end: sub.current_period_end }),
          JSON.stringify({ status: nextStatus, plan: plan.code, current_period_end: nextEnd, billingPeriod: v.billingPeriod }),
          v.note || "Super Admin activation",
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: `Subscription successfully ${v.complimentary ? "granted as complimentary" : "activated"} until ${nextEnd.toLocaleDateString()}.`,
      };
    });
  }

  @Post("subscriptions/:id/extend")
  async extendSubscription(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        days: z.number().int().min(1).max(365).default(5),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const sub = (
        await db.query(
          "SELECT * FROM workspace_subscriptions WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!sub) throw new NotFoundException("Subscription not found");

      const now = new Date();
      const currentEnd = sub.current_period_end && new Date(sub.current_period_end) > now
        ? new Date(sub.current_period_end)
        : now;

      const nextEnd = new Date(currentEnd.getTime() + v.days * 24 * 60 * 60 * 1000);

      await db.query(
        `UPDATE workspace_subscriptions
         SET current_period_end = $2,
             status = CASE WHEN status = 'EXPIRED' THEN 'ACTIVE' ELSE status END,
             admin_override_note = $3,
             updated_at = now()
         WHERE id = $1`,
        [id, nextEnd, `Extended by ${v.days} days: ${v.reason}`],
      );

      // Also extend workspace_trials if currently trialing
      await db.query(
        `UPDATE workspace_trials
         SET ends_at = $2,
             status = 'EXTENDED',
             extension_count = extension_count + 1,
             extension_reason = $3,
             updated_at = now()
         WHERE workspace_id = $1`,
        [sub.workspace_id, nextEnd, v.reason],
      );

      // Audit log
      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'subscription', $3, 'SUBSCRIPTION_EXTENDED', $4, $5, $6, $7)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify({ current_period_end: sub.current_period_end }),
          JSON.stringify({ current_period_end: nextEnd, daysAdded: v.days }),
          v.reason,
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: `Subscription extended by ${v.days} days until ${nextEnd.toLocaleDateString()}.`,
      };
    });
  }

  @Post("subscriptions/:id/suspend")
  async suspendSubscription(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        reason: z.string().trim().min(1).max(500),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const sub = (
        await db.query(
          "SELECT * FROM workspace_subscriptions WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!sub) throw new NotFoundException("Subscription not found");

      await db.query(
        `UPDATE workspace_subscriptions
         SET status = 'SUSPENDED',
             admin_override_note = $2,
             updated_at = now()
         WHERE id = $1`,
        [id, `Suspended: ${v.reason}`],
      );

      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'subscription', $3, 'SUBSCRIPTION_SUSPENDED', $4, $5, $6, $7)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify({ previousStatus: sub.status }),
          JSON.stringify({ status: "SUSPENDED" }),
          v.reason,
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: "Workspace subscription has been suspended.",
      };
    });
  }

  @Patch("subscriptions/:id")
  async updateSubscription(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        planCode: z.enum(["STARTER", "GROWTH", "SCALE"]).optional(),
        customDailyLimit: z.number().int().min(1).max(50).nullable().optional(),
        billingPeriod: z.enum(["MONTHLY", "YEARLY"]).optional(),
        currentPeriodEnd: z.string().datetime().optional(),
        adminOverrideNote: z.string().trim().max(500).optional(),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const sub = (
        await db.query(
          "SELECT * FROM workspace_subscriptions WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!sub) throw new NotFoundException("Subscription not found");

      let planId = sub.plan_id;
      if (v.planCode) {
        const p = (
          await db.query("SELECT id FROM subscription_plans WHERE code = $1", [v.planCode])
        ).rows[0];
        if (p) planId = p.id;
      }

      const nextEnd = v.currentPeriodEnd ? new Date(v.currentPeriodEnd) : sub.current_period_end;
      const nextLimit = v.customDailyLimit !== undefined ? v.customDailyLimit : sub.custom_daily_limit;
      const nextPeriod = v.billingPeriod || sub.billing_period;
      const nextNote = v.adminOverrideNote !== undefined ? v.adminOverrideNote : sub.admin_override_note;

      await db.query(
        `UPDATE workspace_subscriptions
         SET plan_id = $2,
             current_period_end = $3,
             custom_daily_limit = $4,
             billing_period = $5,
             admin_override_note = $6,
             updated_at = now()
         WHERE id = $1`,
        [id, planId, nextEnd, nextLimit, nextPeriod, nextNote],
      );

      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'subscription', $3, 'SUBSCRIPTION_UPDATED', $4, $5, 'Super Admin modified subscription attributes', $6)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify(sub),
          JSON.stringify({ planId, current_period_end: nextEnd, custom_daily_limit: nextLimit }),
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: "Subscription attributes updated successfully.",
      };
    });
  }

  // ==============================================================
  // PLANS MANAGEMENT
  // ==============================================================

  @Get("plans")
  async getPlans() {
    const res = await pool.query(
      `SELECT id, code, name, description, currency, monthly_price, yearly_price,
              daily_post_limit, is_active, features, updated_at
       FROM subscription_plans
       ORDER BY monthly_price ASC`,
    );

    return {
      plans: res.rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        currency: p.currency,
        monthlyPrice: Number(p.monthly_price),
        yearlyPrice: p.yearly_price ? Number(p.yearly_price) : null,
        dailyPostLimit: p.daily_post_limit,
        isActive: p.is_active,
        features: typeof p.features === "string" ? JSON.parse(p.features) : p.features,
        updatedAt: p.updated_at,
      })),
    };
  }

  @Patch("plans/:id")
  async updatePlan(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(300).optional(),
        monthlyPrice: z.number().positive().optional(),
        yearlyPrice: z.number().positive().nullable().optional(),
        dailyPostLimit: z.number().int().min(1).max(50).optional(),
        isActive: z.boolean().optional(),
        features: z.array(z.string()).optional(),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const plan = (
        await db.query("SELECT * FROM subscription_plans WHERE id = $1 FOR UPDATE", [id])
      ).rows[0];
      if (!plan) throw new NotFoundException("Plan not found");

      await db.query(
        `UPDATE subscription_plans
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             monthly_price = COALESCE($4, monthly_price),
             yearly_price = COALESCE($5, yearly_price),
             daily_post_limit = COALESCE($6, daily_post_limit),
             is_active = COALESCE($7, is_active),
             features = COALESCE($8::jsonb, features),
             updated_at = now()
         WHERE id = $1`,
        [
          id,
          v.name,
          v.description,
          v.monthlyPrice,
          v.yearlyPrice,
          v.dailyPostLimit,
          v.isActive,
          v.features ? JSON.stringify(v.features) : null,
        ],
      );

      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'plan', $3, 'PLAN_UPDATED', $4, $5, 'Super Admin updated pricing/features', $6)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify(plan),
          JSON.stringify(v),
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: "Plan updated successfully.",
      };
    });
  }

  // ==============================================================
  // PAYMENTS & APPROVALS MANAGEMENT
  // ==============================================================

  @Get("payments")
  async getPayments(@Query("status") status?: string) {
    const filterStatus = status || "";
    const res = await pool.query(
      `SELECT
         sp.id,
         sp.workspace_id,
         w.name AS workspace_name,
         u.email AS user_email,
         u.name AS user_name,
         sp.amount,
         sp.currency,
         sp.billing_period,
         sp.provider,
         sp.provider_reference,
         sp.status,
         sp.payment_notes,
         sp.verified_by,
         sp.verified_at,
         sp.created_at,
         p.name AS plan_name,
         p.code AS plan_code
       FROM subscription_payments sp
       JOIN workspaces w ON w.id = sp.workspace_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.role = 'Owner'
       LEFT JOIN users u ON u.id = wm.user_id
       LEFT JOIN subscription_plans p ON p.id = sp.plan_id
       WHERE ($1 = '' OR sp.status = $1)
       ORDER BY sp.created_at DESC LIMIT 100`,
      [filterStatus],
    );

    return {
      payments: res.rows.map((p) => ({
        id: p.id,
        workspaceId: p.workspace_id,
        workspaceName: p.workspace_name,
        userEmail: p.user_email || "System",
        userName: p.user_name || "Manager",
        amount: Number(p.amount),
        currency: p.currency,
        billingPeriod: p.billing_period,
        provider: p.provider,
        providerReference: p.provider_reference || "None",
        status: p.status,
        paymentNotes: p.payment_notes || "",
        verifiedBy: p.verified_by,
        verifiedAt: p.verified_at,
        createdAt: p.created_at,
        planName: p.plan_name || "Custom",
        planCode: p.plan_code || "NONE",
      })),
    };
  }

  @Post("payments/:id/verify")
  async verifyPayment(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        note: z.string().trim().max(500).optional(),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const payment = (
        await db.query(
          "SELECT * FROM subscription_payments WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];

      if (!payment) throw new NotFoundException("Payment record not found");
      if (payment.status === "VERIFIED")
        throw new HttpException("Payment has already been verified.", 409);

      const now = new Date();
      await db.query(
        `UPDATE subscription_payments
         SET status = 'VERIFIED',
             verified_by = $2,
             verified_at = now(),
             payment_notes = COALESCE(payment_notes, '') || ' ' || $3,
             updated_at = now()
         WHERE id = $1`,
        [id, actorUsername, v.note ? `[Verified by Admin: ${v.note}]` : "[Verified by Admin]"],
      );

      // Automatically activate workspace subscription
      const sub = (
        await db.query(
          "SELECT * FROM workspace_subscriptions WHERE id = $1 OR workspace_id = $2 FOR UPDATE LIMIT 1",
          [payment.subscription_id, payment.workspace_id],
        )
      ).rows[0];

      const durationMs = payment.billing_period === "YEARLY"
        ? 365 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;

      const currentEnd = sub?.current_period_end && new Date(sub.current_period_end) > now
        ? new Date(sub.current_period_end)
        : now;

      const nextEnd = new Date(currentEnd.getTime() + durationMs);

      if (sub) {
        await db.query(
          `UPDATE workspace_subscriptions
           SET plan_id = COALESCE($2, plan_id),
               billing_period = $3,
               status = 'ACTIVE',
               current_period_end = $4,
               cancel_at_period_end = false,
               admin_override_note = 'Activated via verified manual payment',
               updated_at = now()
           WHERE id = $1`,
          [sub.id, payment.plan_id, payment.billing_period, nextEnd],
        );
      } else {
        await db.query(
          `INSERT INTO workspace_subscriptions(id, workspace_id, plan_id, billing_period, status, start_at, current_period_end, admin_override_note)
           VALUES($1, $2, $3, $4, 'ACTIVE', now(), $5, 'Activated via verified manual payment')`,
          [randomUUID(), payment.workspace_id, payment.plan_id, payment.billing_period, nextEnd],
        );
      }

      // Record administrative audit log
      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'payment', $3, 'PAYMENT_VERIFIED', $4, $5, $6, $7)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify({ status: payment.status }),
          JSON.stringify({ status: "VERIFIED", activatedUntil: nextEnd }),
          v.note || "Super Admin approved payment",
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: `Payment verified. Workspace subscription is now active until ${nextEnd.toLocaleDateString()}.`,
      };
    });
  }

  @Post("payments/:id/reject")
  async rejectPayment(
    @Param("id") id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    const v = z
      .object({
        reason: z.string().trim().min(1).max(500),
      })
      .parse(input);

    const session = await adminSession(req);
    const actorUsername = session?.username || "admin";

    return transaction(async (db) => {
      const payment = (
        await db.query(
          "SELECT * FROM subscription_payments WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];

      if (!payment) throw new NotFoundException("Payment record not found");

      await db.query(
        `UPDATE subscription_payments
         SET status = 'REJECTED',
             verified_by = $2,
             verified_at = now(),
             payment_notes = COALESCE(payment_notes, '') || ' ' || $3,
             updated_at = now()
         WHERE id = $1`,
        [id, actorUsername, `[Rejected: ${v.reason}]`],
      );

      await db.query(
        `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
         VALUES($1, $2, 'payment', $3, 'PAYMENT_REJECTED', $4, $5, $6, $7)`,
        [
          randomUUID(),
          actorUsername,
          id,
          JSON.stringify({ status: payment.status }),
          JSON.stringify({ status: "REJECTED", reason: v.reason }),
          v.reason,
          req.ip || "unknown",
        ],
      );

      return {
        success: true,
        message: "Payment request rejected.",
      };
    });
  }

  // ==============================================================
  // AUDIT LOGS
  // ==============================================================

  @Get("audit-logs")
  async getAuditLogs(@Query() input: unknown) {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        search: z.string().max(100).default(""),
        targetType: z.string().max(50).default(""),
      })
      .parse(input);

    const where =
      "WHERE ($1 = '' OR target_type = $1) AND ($2 = '' OR actor_username ILIKE $3 OR action ILIKE $3 OR reason ILIKE $3)";
    const args = [q.targetType, q.search, `%${q.search}%`];

    const [count, rows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM administrative_audit_logs ${where}`,
        args,
      ),
      pool.query(
        `SELECT id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address, created_at
         FROM administrative_audit_logs
         ${where}
         ORDER BY created_at DESC LIMIT 25 OFFSET $4`,
        [...args, (q.page - 1) * 25],
      ),
    ]);

    return {
      logs: rows.rows,
      total: count.rows[0].total,
      page: q.page,
      pageSize: 25,
    };
  }

  @Get("workspaces")
  async workspaces() {
    const res = await pool.query(
      `SELECT w.id, w.name, w.timezone, w.created_at,
              (SELECT COUNT(*)::int FROM workspace_members WHERE workspace_id = w.id) AS member_count,
              (SELECT COUNT(*)::int FROM content WHERE workspace_id = w.id) AS content_count,
              (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = w.id AND state = 'Connected') AS account_count,
              (SELECT string_agg(u.email, ', ' ORDER BY u.email) FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=w.id AND wm.role='Owner' AND u.account_status='ACTIVE') AS owner_email,
              ws.status AS subscription_status,
              p.name AS plan_name
       FROM workspaces w
       LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
       LEFT JOIN subscription_plans p ON p.id = ws.plan_id
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
        owner: w.owner_email || getAdminConfig()?.username || "Platform administrator",
        status: w.subscription_status || (w.member_count ? "Active" : "No members"),
        planName: w.plan_name || "Trial",
      })),
    };
  }

  @Get("posts")
  async posts(@Query() input: unknown) {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        search: z.string().max(100).default(""),
        status: z
          .enum([
            "",
            "DRAFT",
            "NEEDS_REVIEW",
            "APPROVED",
            "SCHEDULED",
            "PUBLISHING",
            "PUBLISHED",
            "FAILED",
            "UNCERTAIN",
          ])
          .default(""),
      })
      .parse(input);
    const args = [`%${q.search}%`, q.status];
    const where =
      "WHERE (c.title ILIKE $1 OR w.name ILIKE $1 OR u.email ILIKE $1) AND ($2='' OR c.status=$2)";
    const [count, rows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM content c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.created_by ${where}`,
        args,
      ),
      pool.query(
        `SELECT c.id,c.title,c.body,c.status,c.platforms,c.created_at,c.updated_at,c.scheduled_at,w.name AS workspace,u.email AS creator FROM content c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.created_by ${where} ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET $3`,
        [...args, (q.page - 1) * 25],
      ),
    ]);
    return {
      posts: rows.rows,
      total: count.rows[0].total,
      page: q.page,
      pageSize: 25,
    };
  }

  @Get("analytics")
  async analytics() {
    const [users, statuses, platforms, daily, workspaces, logins] =
      await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE email_verified_at IS NOT NULL)::int AS verified,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM auth_events e WHERE e.user_id=users.id AND e.action='USER_LOGIN'))::int AS logged_in FROM users`,
        ),
        pool.query(
          "SELECT status,COUNT(*)::int AS count FROM content GROUP BY status ORDER BY count DESC",
        ),
        pool.query(
          "SELECT p.platform,COUNT(*)::int AS count FROM content c CROSS JOIN LATERAL jsonb_array_elements_text(c.platforms) p(platform) GROUP BY p.platform ORDER BY count DESC",
        ),
        pool.query(
          "SELECT d.day::date::text AS day,COUNT(c.id)::int AS count FROM generate_series(current_date-13,current_date,interval '1 day') d(day) LEFT JOIN content c ON c.created_at>=d.day AND c.created_at<d.day+interval '1 day' GROUP BY d.day ORDER BY d.day",
        ),
        pool.query(
          "SELECT w.id,w.name,COUNT(c.id)::int AS posts,COUNT(c.id) FILTER(WHERE c.status='PUBLISHED')::int AS published FROM workspaces w LEFT JOIN content c ON c.workspace_id=w.id GROUP BY w.id ORDER BY posts DESC,w.name LIMIT 10",
        ),
        pool.query(
          "SELECT COUNT(*)::int AS events,COUNT(DISTINCT user_id)::int AS users FROM auth_events WHERE action='USER_LOGIN' AND created_at>now()-interval '30 days'",
        ),
      ]);
    return {
      users: users.rows[0],
      statuses: statuses.rows,
      platforms: platforms.rows,
      daily: daily.rows,
      workspaces: workspaces.rows,
      logins: logins.rows[0],
      engagementAvailable: false,
    };
  }

  @Get("events")
  async events(@Query() input: unknown) {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        kind: z.enum(["all", "login", "workspace", "admin"]).default("all"),
        search: z.string().max(100).default(""),
      })
      .parse(input);
    const union = `SELECT e.id,e.action,e.created_at,u.email AS actor,'login' AS kind,NULL::text AS workspace,NULL::text AS detail,NULL::text AS ip,NULL::text AS device FROM auth_events e LEFT JOIN users u ON u.id=e.user_id
      UNION ALL SELECT a.id,a.action,a.created_at,u.email,'workspace',w.name,a.entity,NULL::text,NULL::text FROM activity_logs a LEFT JOIN users u ON u.id=a.actor_id JOIN workspaces w ON w.id=a.workspace_id
      UNION ALL SELECT e.id,e.action,e.created_at,e.username,'admin',NULL::text,u.email,e.ip_address,e.user_agent FROM system_admin_events e LEFT JOIN users u ON u.id=e.target_user_id`;
    const where =
      "WHERE ($1='all' OR kind=$1) AND (COALESCE(actor,'System') ILIKE $2 OR action ILIKE $2 OR COALESCE(workspace,'') ILIKE $2 OR COALESCE(detail,'') ILIKE $2)";
    const args = [q.kind, `%${q.search}%`];
    const [count, rows] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM (${union}) events ${where}`,
        args,
      ),
      pool.query(
        `SELECT * FROM (${union}) events ${where} ORDER BY created_at DESC,id LIMIT 25 OFFSET $3`,
        [...args, (q.page - 1) * 25],
      ),
    ]);
    return {
      events: rows.rows,
      total: count.rows[0].total,
      page: q.page,
      pageSize: 25,
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

    const smtpConfigured =
      !!process.env.MAIL_HOST && !!process.env.MAIL_USERNAME;

    return {
      services: {
        postgres: { status: pgStatus, note: "Configured application database" },
        redis: {
          status:
            queueBackend() === "postgres" ? "disabled" : redisStatus,
          note: "Selected queue backend: " + queueBackend(),
        },
        queue: {
          status: "not_checked",
          backend: queueBackend(),
          note: "Inspect cron heartbeat and queue jobs to verify processing",
        },
        smtp: {
          status: smtpConfigured ? "configured" : "not_configured",
          note: process.env.MAIL_HOST || "Not set",
        },
      },
    };
  }
}
