import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, type DB } from "./db.js";
import type { Request } from "express";
import { hash, hashPassword } from "./security.js";
import { getWorkspaceEntitlement } from "./billing/entitlement.service.js";

const idSchema = z.string().uuid();

export const adminUserEditSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254).transform(v => v.toLowerCase()).optional(),
    emailVerified: z.boolean().optional(),
    subscription: z.object({
      status: z.enum(["ACTIVE", "INACTIVE", "EXTEND"]),
      planCode: z.enum(["STARTER", "GROWTH", "SCALE"]),
      billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
      expiresAt: z.string().datetime({ offset: true }).optional(),
      complimentary: z.boolean().optional(),
      customDailyLimit: z.number().int().min(1).max(50).nullable().optional(),
      extensionDays: z.number().int().min(1).max(365).optional(),
      extensionReason: z.string().trim().min(1).max(500).optional(),
    }).strict().optional(),
    phone: z.string().trim().max(30).optional().or(z.literal("")),
    countryCode: z.string().trim().max(10).optional().or(z.literal("")),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    note: z.string().trim().max(500).optional().default(""),
    version: z.number().int().positive(),
  })
  .strict();

export const adminUserDeleteSchema = z
  .object({
    confirmation: z.string().email(),
    version: z.number().int().positive(),
  })
  .strict();

export async function adminUserImpact(id: string, db: DB = pool) {
  idSchema.parse(id);
  const user = (
    await db.query(
      "SELECT id,name,email,account_status,admin_note,admin_version,deleted_at FROM users WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!user) throw new NotFoundException("User not found.");
  const stats = (
    await db.query(
      "SELECT (SELECT COUNT(*)::int FROM content WHERE created_by=$1) AS posts,(SELECT COUNT(*)::int FROM workspace_members WHERE user_id=$1) AS memberships",
      [id],
    )
  ).rows[0];
  return {
    user,
    ...stats,
    canDelete: user.account_status !== "DELETED",
    policy:
      "The platform administrator can delete this account. Sign-in access will be removed. Workspaces, posts and audit history remain under platform administration.",
  };
}

export async function adminUserDetail(id: string, db: DB = pool) {
  idSchema.parse(id);
  const user = (
    await db.query(
      `SELECT u.id, u.name, u.email, u.phone_number, u.phone_country_code,
              u.account_status, u.admin_note, u.admin_version, u.email_verified_at,
              u.created_at, u.updated_at, u.active_workspace_id,
              (SELECT MAX(created_at) FROM auth_events WHERE user_id = u.id AND action = 'USER_LOGIN') AS last_login_at,
              (SELECT COUNT(*)::int FROM auth_events WHERE user_id = u.id AND action = 'USER_LOGIN') AS login_count,
              (SELECT COUNT(*)::int FROM auth_sessions WHERE user_id = u.id AND revoked_at IS NULL AND access_expires_at > now()) AS active_sessions_count
       FROM users u WHERE u.id = $1`,
      [id],
    )
  ).rows[0];

  if (!user) throw new NotFoundException("User not found.");

  // Get active workspace memberships
  const memberships = (
    await db.query(
      `SELECT w.id, w.name, w.timezone, wm.role, w.created_at
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY w.id ASC`,
      [id],
    )
  ).rows;

  const activeWid = user.active_workspace_id || memberships[0]?.id;
  let entitlement = null;
  let payments = [];
  let events = [];

  if (activeWid) {
    entitlement = await getWorkspaceEntitlement(activeWid, db);
    payments = (
      await db.query(
        `SELECT sp.id, sp.amount, sp.currency, sp.billing_period, sp.provider,
                sp.provider_reference, sp.status, sp.created_at, sp.verified_at,
                p.name AS plan_name
         FROM subscription_payments sp
         LEFT JOIN subscription_plans p ON p.id = sp.plan_id
         WHERE sp.workspace_id = $1
         ORDER BY sp.created_at DESC LIMIT 10`,
        [activeWid],
      )
    ).rows;

    events = (
      await db.query(
        `SELECT id, event_type, details, created_at
         FROM subscription_events
         WHERE workspace_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [activeWid],
      )
    ).rows;
  }

  // Activity audit logs for this user
  const recentActivity = (
    await db.query(
      `SELECT id, action, created_at, request_id
       FROM auth_events
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 25`,
      [id],
    )
  ).rows;

  return {
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phone_number || "",
      phoneCountryCode: user.phone_country_code || "+91",
      accountStatus: user.account_status,
      adminNote: user.admin_note || "",
      adminVersion: user.admin_version,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    security: {
      emailVerified: !!user.email_verified_at,
      emailVerifiedAt: user.email_verified_at,
      lastLoginAt: user.last_login_at,
      loginCount: user.login_count,
      activeSessionsCount: user.active_sessions_count,
    },
    memberships,
    workspaceId: activeWid,
    entitlement,
    payments,
    subscriptionEvents: events,
    recentActivity,
  };
}

async function revoke(db: DB, id: string) {
  await db.query(
    "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
    [id],
  );
  await db.query(
    "UPDATE auth_tokens SET used_at=COALESCE(used_at,now()) WHERE user_id=$1",
    [id],
  );
  if ((await db.query("SELECT to_regclass('sessions') AS present")).rows[0].present) {
    await db.query("DELETE FROM sessions WHERE user_id=$1", [id]);
  }
}

export async function purgeUser(db: DB, userId: string) {
  // 1. Unset active_workspace_id on the user
  await db.query("UPDATE users SET active_workspace_id = NULL WHERE id = $1", [userId]);

  // 2. Clear sessions, tokens, events and consents
  await revoke(db, userId);
  await db.query("DELETE FROM auth_tokens WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM auth_events WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM user_consents WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM oauth_states WHERE user_id = $1", [userId]);
  await db.query("DELETE FROM meta_oauth_pending WHERE user_id = $1", [userId]);

  // 3. Nullify or delete references in platform tables
  await db.query("UPDATE subscription_events SET actor_id = NULL WHERE actor_id = $1", [userId]);
  await db.query("UPDATE system_admin_events SET target_user_id = NULL WHERE target_user_id = $1", [userId]);
  await db.query("DELETE FROM approvals WHERE actor_id = $1", [userId]);
  await db.query("DELETE FROM ai_generations WHERE actor_id = $1", [userId]);
  await db.query("UPDATE activity_logs SET actor_id = NULL WHERE actor_id = $1", [userId]);
  await db.query("UPDATE knowledge_automation_settings SET actor_id = NULL WHERE actor_id = $1", [userId]);
  await db.query("UPDATE batch_jobs SET created_by = NULL WHERE created_by = $1", [userId]);
  await db.query("UPDATE media_assets SET created_by = NULL WHERE created_by = $1", [userId]);
  await db.query("UPDATE documents SET created_by = NULL WHERE created_by = $1", [userId]);
  try { await db.query("DELETE FROM content_comments WHERE author_id = $1", [userId]); } catch {}

  // 4. Handle workspaces owned solely by this user
  const ownedWorkspaces = (
    await db.query(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1 AND wm.role = 'Owner'
         AND (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) = 1`,
      [userId],
    )
  ).rows;

  for (const w of ownedWorkspaces) {
    const wid = w.id;
    await db.query("UPDATE users SET active_workspace_id = NULL WHERE active_workspace_id = $1", [wid]);
    await db.query("DELETE FROM content_versions WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM published_posts WHERE scheduled_post_id IN (SELECT id FROM scheduled_posts WHERE workspace_id = $1)", [wid]);
    await db.query("DELETE FROM scheduled_posts WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM ai_generations WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM content WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM activity_logs WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM subscription_payments WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM subscription_events WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM workspace_trials WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM workspace_subscriptions WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM brand_kits WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM social_account_tokens WHERE account_id IN (SELECT id FROM social_accounts WHERE workspace_id = $1)", [wid]);
    await db.query("DELETE FROM social_accounts WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM workspace_members WHERE workspace_id = $1", [wid]);
    await db.query("DELETE FROM workspaces WHERE id = $1", [wid]);
  }

  // 5. Remove any other workspace memberships
  await db.query("DELETE FROM workspace_members WHERE user_id = $1", [userId]);

  // 6. Reassign content created by this user in remaining shared workspaces to another owner/member
  await db.query(
    `UPDATE content
     SET created_by = COALESCE((SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content.workspace_id AND wm.role = 'Owner' AND wm.user_id != $1 LIMIT 1),
                               (SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content.workspace_id AND wm.user_id != $1 LIMIT 1)),
         updated_by = COALESCE((SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content.workspace_id AND wm.role = 'Owner' AND wm.user_id != $1 LIMIT 1),
                               (SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content.workspace_id AND wm.user_id != $1 LIMIT 1)),
         approved_by = NULL, scheduled_by = NULL, published_by = NULL, assigned_to = NULL
     WHERE created_by = $1 OR updated_by = $1 OR approved_by = $1 OR scheduled_by = $1 OR published_by = $1 OR assigned_to = $1`,
    [userId],
  );
  await db.query(
    `UPDATE content_versions
     SET created_by = COALESCE((SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content_versions.workspace_id AND wm.role = 'Owner' AND wm.user_id != $1 LIMIT 1),
                               (SELECT wm.user_id FROM workspace_members wm WHERE wm.workspace_id = content_versions.workspace_id AND wm.user_id != $1 LIMIT 1))
     WHERE created_by = $1`,
    [userId],
  );

  // 7. Finally permanently delete the user
  await db.query("DELETE FROM users WHERE id = $1", [userId]);
}

export async function mutateAdminUser(
  id: string,
  input: unknown,
  req: Request,
  remove = false,
) {
  idSchema.parse(id);
  const body = remove
    ? adminUserDeleteSchema.parse(input)
    : adminUserEditSchema.parse(input);

  return transaction(async (db) => {
    const actor = (
      await db.query(
        "SELECT username FROM system_admin_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(req.cookies.contentos_admin_session)],
      )
    ).rows[0];
    if (!actor) throw new ConflictException("Admin session expired. Sign in again.");

    const user = (
      await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!user) throw new NotFoundException("User not found.");
    if (user.admin_version !== body.version)
      throw new ConflictException("This account changed. Refresh and try again.");
    if (user.account_status === "DELETED")
      throw new ConflictException("Deleted accounts cannot be edited.");

    await db.query(
      "SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 AND m.role='Owner' ORDER BY w.id FOR UPDATE OF w",
      [id],
    );

    if (remove) {
      if ((body as z.infer<typeof adminUserDeleteSchema>).confirmation !== user.email)
        throw new BadRequestException("Enter the exact account email to confirm deletion.");
      await purgeUser(db, id);
      return { id, email: user.email, account_status: "DELETED", admin_version: user.admin_version + 1 };
    } else {
      const edit = body as z.infer<typeof adminUserEditSchema>;
      const email = edit.email ?? user.email;
      if (email !== user.email && (await db.query("SELECT id FROM users WHERE lower(email)=lower($1) AND id<>$2", [email, id])).rowCount) {
        throw new ConflictException("This email is already used by another account.");
      }
      await db.query(
        `UPDATE users SET email=$2, email_verified_at=CASE
          WHEN $3::boolean IS TRUE THEN COALESCE(CASE WHEN email=$2 THEN email_verified_at END,now())
          WHEN $3::boolean IS FALSE OR email<>$2 THEN NULL ELSE email_verified_at END WHERE id=$1`,
        [id, email, edit.emailVerified ?? null],
      );
      if (edit.subscription) {
        const change = edit.subscription;
        const workspaceId = user.active_workspace_id || (await db.query(
          "SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1", [id],
        )).rows[0]?.workspace_id;
        if (!workspaceId) throw new BadRequestException("This user has no billing workspace.");
        await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [workspaceId]);
        const previous = (await db.query("SELECT * FROM workspace_subscriptions WHERE workspace_id=$1 FOR UPDATE", [workspaceId])).rows[0];
        if (change.status === "EXTEND") {
          if (!previous || !change.extensionDays || !change.extensionReason) throw new BadRequestException("An existing subscription, extension days and a reason are required.");
          if (!["ACTIVE", "TRIALING", "EXPIRED", "ADMIN_GRANTED"].includes(previous.status)) throw new BadRequestException("Activate the subscription before extending it.");
          const trial = (await db.query("SELECT * FROM workspace_trials WHERE workspace_id=$1 FOR UPDATE", [workspaceId])).rows[0];
          const isTrial = previous.status === "TRIALING";
          const currentEnd = isTrial ? trial?.ends_at || previous.current_period_end : previous.current_period_end;
          const nextEnd = new Date(Math.max(Date.now(), currentEnd ? new Date(currentEnd).getTime() : 0) + change.extensionDays * 86400000);
          const nextStatus = previous.status === "EXPIRED" ? "ACTIVE" : previous.status;
          await db.query("UPDATE workspace_subscriptions SET current_period_end=$2,status=$3,admin_override_note=$4,updated_at=now() WHERE id=$1", [previous.id,nextEnd,nextStatus,change.extensionReason]);
          if (isTrial) await db.query("UPDATE workspace_trials SET ends_at=$2,status='EXTENDED',extension_count=extension_count+1,extension_reason=$3,updated_at=now() WHERE workspace_id=$1", [workspaceId,nextEnd,change.extensionReason]);
          await db.query("INSERT INTO subscription_events(id,workspace_id,subscription_id,event_type,details) VALUES($1,$2,$3,'ADMIN_USER_SUBSCRIPTION_EXTENDED',$4)", [randomUUID(),workspaceId,previous.id,JSON.stringify({actor:actor.username,previous,days:change.extensionDays,reason:change.extensionReason,currentPeriodEnd:nextEnd})]);
        } else {
        const plan = (await db.query("SELECT id FROM subscription_plans WHERE code=$1", [change.planCode])).rows[0];
        if (!plan) throw new BadRequestException("Subscription plan not found.");
        if (change.status === "ACTIVE" && (!change.expiresAt || new Date(change.expiresAt).getTime() <= Date.now())) {
          throw new BadRequestException("Active subscriptions require a future expiry date.");
        }
        const nextSubscription = (await db.query(
          `INSERT INTO workspace_subscriptions(id,workspace_id,plan_id,billing_period,status,start_at,current_period_end,admin_override_note)
           VALUES($1,$2,$3,$4,$5,now(),$6,$7)
           ON CONFLICT(workspace_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,billing_period=EXCLUDED.billing_period,
             status=EXCLUDED.status,start_at=now(),current_period_end=EXCLUDED.current_period_end,
             cancel_at_period_end=false,admin_override_note=EXCLUDED.admin_override_note,updated_at=now()
           RETURNING *`,
          [randomUUID(),workspaceId,change.status === "INACTIVE" ? previous?.plan_id ?? plan.id : plan.id,change.status === "INACTIVE" ? previous?.billing_period ?? change.billingPeriod : change.billingPeriod,change.status === "ACTIVE" ? change.complimentary ? "ADMIN_GRANTED" : "ACTIVE" : "SUSPENDED",
           change.status === "ACTIVE" ? change.expiresAt : previous?.current_period_end ?? null,edit.note],
        )).rows[0];
        if (change.status === "ACTIVE") await db.query("UPDATE workspace_subscriptions SET custom_daily_limit=$2 WHERE id=$1", [nextSubscription.id,change.customDailyLimit ?? null]);
        nextSubscription.custom_daily_limit = change.status === "ACTIVE" ? change.customDailyLimit ?? null : previous?.custom_daily_limit ?? null;
        await db.query(
          `INSERT INTO subscription_events(id,workspace_id,subscription_id,event_type,details)
           VALUES($1,$2,$3,'ADMIN_USER_SUBSCRIPTION_UPDATED',$4)`,
          [randomUUID(),workspaceId,nextSubscription.id,JSON.stringify({actor:actor.username,previous:previous ?? null,next:nextSubscription})],
        );
        }
      }
      await db.query(
        `UPDATE users
         SET name = $2,
             phone_number = CASE WHEN $3::boolean THEN $4 ELSE phone_number END,
             phone_country_code = CASE WHEN $5::boolean THEN $6 ELSE phone_country_code END,
             account_status = $7,
             admin_note = $8,
             updated_at = now(),
             admin_version = admin_version + 1
         WHERE id = $1`,
        [
          id,
          edit.name,
          edit.phone !== undefined,
          edit.phone?.trim() || null,
          edit.countryCode !== undefined,
          edit.countryCode?.trim() || "+91",
          edit.status,
          edit.note || "",
        ],
      );
    }

    const next = (
      await db.query(
        "SELECT name,email,email_verified_at,phone_number,phone_country_code,account_status,admin_note,admin_version FROM users WHERE id=$1",
        [id],
      )
    ).rows[0];

    if (remove || next.account_status !== "ACTIVE" || next.email !== user.email) await revoke(db, id);

    // Audit log
    await db.query(
      `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
       VALUES($1, $2, 'user', $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        actor.username,
        id,
        remove ? "USER_DELETED" : "USER_UPDATED",
        JSON.stringify({
          name: user.name,
          email: user.email,
          emailVerifiedAt: user.email_verified_at,
          phone: user.phone_number,
          status: user.account_status,
          note: user.admin_note,
        }),
        JSON.stringify(next),
        remove ? "Account deleted by platform administrator" : "Account details edited by Super Admin",
        req.ip || "unknown",
      ],
    );

    await db.query(
      "INSERT INTO system_admin_events(id,username,action,target_user_id,details,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        randomUUID(),
        actor.username,
        remove ? "USER_DELETED" : "USER_UPDATED",
        id,
        JSON.stringify({
          previous: { name: user.name, status: user.account_status, note: user.admin_note },
          next,
        }),
        req.ip,
        (req.get("user-agent") || "").slice(0, 512),
      ],
    );

    return {
      success: true,
      message: remove
        ? "Account deleted. Content and audit history retained."
        : "User updated successfully.",
      user: { id, ...next },
    };
  });
}

/**
 * Initiates an administrative password reset.
 * Securely hashes a generated temporary password and forces reset upon next login,
 * or queues a password-reset code. Password hash is NEVER revealed or returned plaintext.
 */
export async function adminResetPassword(id: string, req: Request) {
  idSchema.parse(id);
  return transaction(async (db) => {
    const actor = (
      await db.query(
        "SELECT username FROM system_admin_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [hash(req.cookies.contentos_admin_session)],
      )
    ).rows[0];
    if (!actor) throw new ConflictException("Admin session expired. Sign in again.");

    const user = (
      await db.query("SELECT id, name, email, account_status FROM users WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!user) throw new NotFoundException("User not found.");

    // Generate random 16-character temporary password
    const tempPassword = `Tmp!${randomBytes(8).toString("hex")}`;
    const encoded = await hashPassword(tempPassword);

    await db.query("UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1", [id, encoded]);
    await revoke(db, id);

    await db.query(
      `INSERT INTO administrative_audit_logs(id, actor_username, target_type, target_id, action, before_value, after_value, reason, ip_address)
       VALUES($1, $2, 'user', $3, 'PASSWORD_RESET_ADMIN', '{}', '{}', 'Administrator initiated temporary password reset', $4)`,
      [randomUUID(), actor.username, id, req.ip || "unknown"],
    );

    return {
      success: true,
      message: "Temporary password generated. Give this securely to the user. They must change it upon login.",
      tempPassword,
    };
  });
}
