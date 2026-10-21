import { pool, type DB } from "../db.js";
import { HttpException, ForbiddenException } from "@nestjs/common";

export type EffectiveAccessState =
  | "TRIAL_ACTIVE"
  | "PAID_ACTIVE"
  | "ADMIN_GRANTED"
  | "LOCKED"
  | "SUSPENDED";

export interface WorkspaceEntitlement {
  workspaceId: string;
  effectiveState: EffectiveAccessState;
  isLocked: boolean;
  canCreateContent: boolean;
  canPublish: boolean;
  canUseAI: boolean;
  dailyPostingLimit: number;
  plan: {
    id: string | null;
    code: string;
    name: string;
    monthlyPrice: number;
    yearlyPrice: number | null;
    billingPeriod: "MONTHLY" | "YEARLY";
  };
  trial: {
    active: boolean;
    startedAt: string | null;
    endsAt: string | null;
    remainingSeconds: number;
    daysRemaining: number;
    hoursRemaining: number;
    extensionCount: number;
  };
  subscription: {
    id: string | null;
    status: string;
    startAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    customDailyLimit: number | null;
    adminOverrideNote: string | null;
  };
  reason: string;
}

export async function getWorkspaceEntitlement(
  workspaceId: string,
  db: DB = pool,
): Promise<WorkspaceEntitlement> {
  // Query workspace subscription, plan, and trial in a single round-trip
  const subQuery = await db.query(
    `SELECT
       ws.id AS sub_id,
       ws.status AS sub_status,
       ws.billing_period,
       ws.start_at AS sub_start_at,
       ws.current_period_end,
       ws.cancel_at_period_end,
       ws.custom_daily_limit,
       ws.admin_override_note,
       p.id AS plan_id,
       p.code AS plan_code,
       p.name AS plan_name,
       p.monthly_price,
       p.yearly_price,
       p.daily_post_limit AS plan_daily_limit,
       wt.started_at AS trial_start,
       wt.ends_at AS trial_end,
       wt.status AS trial_status,
       wt.extension_count,
       wt.daily_post_limit AS trial_daily_limit,
       w.daily_posting_target AS ws_daily_target
     FROM workspaces w
     LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
     LEFT JOIN subscription_plans p ON p.id = ws.plan_id
     LEFT JOIN workspace_trials wt ON wt.workspace_id = w.id
     WHERE w.id = $1`,
    [workspaceId],
  );

  const row = subQuery.rows[0];
  const now = new Date();

  // Fallbacks if tables were empty for some reason
  const subStatus = row?.sub_status || "TRIALING";
  const periodEnd = row?.current_period_end ? new Date(row.current_period_end) : null;
  const trialEnd = row?.trial_end ? new Date(row.trial_end) : null;
  const trialStatus = row?.trial_status || "ACTIVE";

  let effectiveState: EffectiveAccessState = "LOCKED";
  let reason = "Your ContentOS free trial has ended. Select a plan to continue.";

  // 1. Suspension takes precedence
  if (subStatus === "SUSPENDED") {
    effectiveState = "SUSPENDED";
    reason = "Workspace access has been suspended by platform administration.";
  }
  // 2. Complimentary or Administrative Override
  else if (subStatus === "ADMIN_GRANTED" && (!periodEnd || periodEnd.getTime() > now.getTime())) {
    effectiveState = "ADMIN_GRANTED";
    reason = "Platform complimentary access active.";
  }
  // 3. Paid Active Subscription
  else if (subStatus === "ACTIVE" && periodEnd && periodEnd.getTime() > now.getTime()) {
    effectiveState = "PAID_ACTIVE";
    reason = `Active paid subscription (${row?.plan_name || "Custom"}).`;
  }
  // 4. Trial Active (within exact 120-hour window)
  else if (
    (subStatus === "TRIALING" || !row?.sub_id) &&
    trialEnd &&
    trialEnd.getTime() > now.getTime() &&
    trialStatus !== "EXPIRED"
  ) {
    effectiveState = "TRIAL_ACTIVE";
    reason = "Free trial active.";
  }
  // 5. Otherwise locked
  else {
    effectiveState = "LOCKED";
    if (["ACTIVE", "ADMIN_GRANTED"].includes(subStatus) && periodEnd && periodEnd.getTime() <= now.getTime()) {
      reason = "Your subscription period has ended. Please renew to continue.";
    } else if (subStatus === "CANCELED") {
      reason = "Your subscription was canceled.";
    } else if (subStatus === "PAST_DUE") {
      reason = "Your payment is past due. Please update your billing information.";
    } else {
      reason = "Your free trial has ended. Choose a plan to unlock all features.";
    }
  }

  // Calculate remaining trial seconds
  let remainingSeconds = 0;
  if (trialEnd && trialEnd.getTime() > now.getTime()) {
    remainingSeconds = Math.max(0, Math.floor((trialEnd.getTime() - now.getTime()) / 1000));
  }
  const daysRemaining = Math.floor(remainingSeconds / 86400);
  const hoursRemaining = Math.floor((remainingSeconds % 86400) / 3600);

  // Daily posting allowance determination:
  // Custom limit overrides -> Plan limit -> Trial limit -> Workspace setting -> Default 3
  let dailyPostingLimit = 3;
  if (row?.custom_daily_limit && row.custom_daily_limit > 0) {
    dailyPostingLimit = row.custom_daily_limit;
  } else if (effectiveState === "PAID_ACTIVE" && row?.plan_daily_limit) {
    dailyPostingLimit = row.plan_daily_limit;
  } else if (effectiveState === "ADMIN_GRANTED") {
    dailyPostingLimit = row?.plan_daily_limit || row?.ws_daily_target || 10;
  } else if (effectiveState === "TRIAL_ACTIVE") {
    dailyPostingLimit = row?.trial_daily_limit || 3;
  }

  const isAccessible = ["TRIAL_ACTIVE", "PAID_ACTIVE", "ADMIN_GRANTED"].includes(effectiveState);

  return {
    workspaceId,
    effectiveState,
    isLocked: !isAccessible,
    canCreateContent: isAccessible,
    canPublish: isAccessible,
    canUseAI: isAccessible,
    dailyPostingLimit,
    plan: {
      id: row?.plan_id || null,
      code: row?.plan_code || (effectiveState === "TRIAL_ACTIVE" ? "TRIAL" : "STARTER"),
      name: row?.plan_name || (effectiveState === "TRIAL_ACTIVE" ? "Free Trial" : "Starter"),
      monthlyPrice: row?.monthly_price ? Number(row.monthly_price) : 15000,
      yearlyPrice: row?.yearly_price ? Number(row.yearly_price) : 150000,
      billingPeriod: (row?.billing_period as "MONTHLY" | "YEARLY") || "MONTHLY",
    },
    trial: {
      active: effectiveState === "TRIAL_ACTIVE",
      startedAt: row?.trial_start ? new Date(row.trial_start).toISOString() : null,
      endsAt: row?.trial_end ? new Date(row.trial_end).toISOString() : null,
      remainingSeconds,
      daysRemaining,
      hoursRemaining,
      extensionCount: row?.extension_count || 0,
    },
    subscription: {
      id: row?.sub_id || null,
      status: subStatus,
      startAt: row?.sub_start_at ? new Date(row.sub_start_at).toISOString() : null,
      currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
      cancelAtPeriodEnd: !!row?.cancel_at_period_end,
      customDailyLimit: row?.custom_daily_limit || null,
      adminOverrideNote: row?.admin_override_note || null,
    },
    reason,
  };
}

/**
 * Asserts that the workspace has active subscription or trial privileges.
 * Throws 402 Payment Required if expired/locked, or 403 Forbidden if suspended.
 */
export async function assertWorkspaceActive(
  workspaceId: string,
  actionName = "this operation",
  db: DB = pool,
): Promise<WorkspaceEntitlement> {
  const entitlement = await getWorkspaceEntitlement(workspaceId, db);
  if (entitlement.effectiveState === "SUSPENDED") {
    throw new ForbiddenException(
      `Workspace is suspended. ${entitlement.reason}`,
    );
  }
  if (entitlement.isLocked) {
    throw new HttpException(
      {
        statusCode: 402,
        error: "SUBSCRIPTION_REQUIRED",
        message: `Subscription required for ${actionName}. ${entitlement.reason}`,
        effectiveState: entitlement.effectiveState,
        plan: entitlement.plan,
        upgradeUrl: "/app/billing",
      },
      402,
    );
  }
  return entitlement;
}
