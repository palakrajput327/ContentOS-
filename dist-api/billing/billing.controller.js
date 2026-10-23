var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Body, Req, NotFoundException, } from "@nestjs/common";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db.js";
import { WorkspaceRequired, assertPermission, Public, } from "../security.js";
import { getWorkspaceEntitlement, } from "./entitlement.service.js";
const paymentRequestSchema = z.object({
    planCode: z.preprocess((v) => (typeof v === "string" ? v.toUpperCase() : v), z.enum(["STARTER", "GROWTH", "SCALE"])),
    billingPeriod: z.preprocess((v) => (typeof v === "string" ? v.toUpperCase() : v), z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY")),
    provider: z.string().trim().max(50).optional().default("MANUAL"),
    providerReference: z.string().trim().max(100).optional(),
    paymentNotes: z.string().trim().max(500).optional(),
    proofUrl: z.string().url().max(1000).optional().or(z.literal("")),
});
let BillingController = class BillingController {
    /**
     * GET /api/v1/billing/plans
     * Available subscription plans with monthly & yearly pricing
     */
    async getPlans() {
        const res = await pool.query(`SELECT id, code, name, description, currency, monthly_price, yearly_price,
              daily_post_limit, is_active, features
       FROM subscription_plans
       WHERE is_active = true
       ORDER BY monthly_price ASC`);
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
                features: typeof p.features === "string" ? JSON.parse(p.features) : p.features,
            })),
        };
    }
    /**
     * GET /api/v1/billing/current
     * Workspace subscription details, trial status, and daily usage
     */
    async getCurrent(r) {
        const wid = r.workspace.id;
        const entitlement = await getWorkspaceEntitlement(wid);
        // Get workspace timezone
        const ws = (await pool.query("SELECT timezone FROM workspaces WHERE id = $1", [wid])).rows[0] || { timezone: "Asia/Kolkata" };
        const timezone = ws.timezone || "Asia/Kolkata";
        // Format current date in workspace timezone
        const todayStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
        // Count distinct posts scheduled/published today in workspace timezone
        const usageRow = (await pool.query(`SELECT COUNT(DISTINCT c.id)::int AS count
         FROM content c
         JOIN scheduled_posts s ON s.content_id = c.id AND s.workspace_id = c.workspace_id
         WHERE c.workspace_id = $1
           AND (s.execute_at AT TIME ZONE $2)::date = $3::date
           AND s.state <> 'CANCELLED'`, [wid, timezone, todayStr])).rows[0];
        const postsUsedToday = usageRow?.count || 0;
        const dailyLimit = entitlement.dailyPostingLimit;
        const postsRemainingToday = Math.max(0, dailyLimit - postsUsedToday);
        return {
            entitlement,
            usage: {
                date: todayStr,
                timezone,
                postsUsedToday,
                dailyLimit,
                postsRemainingToday,
                usagePercentage: Math.min(100, Math.round((postsUsedToday / Math.max(1, dailyLimit)) * 100)),
            },
        };
    }
    /**
     * GET /api/v1/billing/usage
     * Quota usage history for the past 7 days
     */
    async getUsageHistory(r) {
        const wid = r.workspace.id;
        const ws = (await pool.query("SELECT timezone FROM workspaces WHERE id = $1", [wid])).rows[0] || { timezone: "Asia/Kolkata" };
        const timezone = ws.timezone || "Asia/Kolkata";
        const historyRes = await pool.query(`SELECT
         d.day::date::text AS date,
         COUNT(DISTINCT c.id)::int AS post_count
       FROM generate_series(current_date - 6, current_date, interval '1 day') d(day)
       LEFT JOIN scheduled_posts s ON (s.execute_at AT TIME ZONE $2)::date = d.day::date
         AND s.workspace_id = $1
         AND s.state <> 'CANCELLED'
       LEFT JOIN content c ON c.id = s.content_id AND c.workspace_id = s.workspace_id
       GROUP BY d.day
       ORDER BY d.day ASC`, [wid, timezone]);
        return {
            history: historyRes.rows.map((row) => ({
                date: row.date,
                postCount: row.post_count,
            })),
        };
    }
    /**
     * GET /api/v1/billing/history
     * Invoices and payment transactions
     */
    async getBillingHistory(r) {
        const wid = r.workspace.id;
        const paymentsRes = await pool.query(`SELECT
         sp.id,
         sp.amount,
         sp.currency,
         sp.billing_period,
         sp.provider,
         sp.provider_reference,
         sp.status,
         sp.payment_notes,
         sp.created_at,
         sp.verified_at,
         p.name AS plan_name,
         p.code AS plan_code
       FROM subscription_payments sp
       LEFT JOIN subscription_plans p ON p.id = sp.plan_id
       WHERE sp.workspace_id = $1
       ORDER BY sp.created_at DESC`, [wid]);
        return {
            payments: paymentsRes.rows.map((p) => ({
                id: p.id,
                amount: Number(p.amount),
                currency: p.currency,
                billingPeriod: p.billing_period,
                provider: p.provider,
                providerReference: p.provider_reference || null,
                status: p.status,
                paymentNotes: p.payment_notes || null,
                planName: p.plan_name || "Custom Plan",
                planCode: p.plan_code || "CUSTOM",
                createdAt: p.created_at,
                verifiedAt: p.verified_at || null,
            })),
        };
    }
    /**
     * POST /api/v1/billing/payment-request
     * Submit a payment confirmation request for Super Admin activation
     */
    async createPaymentRequest(r, input) {
        assertPermission(r.workspace.role, "manage");
        const v = paymentRequestSchema.parse(input);
        const wid = r.workspace.id;
        // Lookup plan
        const plan = (await pool.query("SELECT id, code, name, monthly_price, yearly_price, currency, daily_post_limit FROM subscription_plans WHERE code = $1 AND is_active = true", [v.planCode])).rows[0];
        if (!plan) {
            throw new NotFoundException(`Plan ${v.planCode} not found.`);
        }
        const amount = v.billingPeriod === "YEARLY"
            ? (plan.yearly_price ? Number(plan.yearly_price) : Number(plan.monthly_price) * 10)
            : Number(plan.monthly_price);
        const paymentId = randomUUID();
        const result = await transaction(async (db) => {
            // Find or create workspace subscription record
            let sub = (await db.query("SELECT id FROM workspace_subscriptions WHERE workspace_id = $1", [wid])).rows[0];
            if (!sub) {
                const newSubId = randomUUID();
                await db.query(`INSERT INTO workspace_subscriptions(id, workspace_id, plan_id, billing_period, status)
           VALUES($1, $2, $3, $4, 'TRIALING')`, [newSubId, wid, plan.id, v.billingPeriod]);
                sub = { id: newSubId };
            }
            await db.query(`INSERT INTO subscription_payments(
           id, workspace_id, subscription_id, plan_id, billing_period, amount, currency,
           provider, provider_reference, status, payment_notes, payment_proof_url
         )
         VALUES($1, $2, $3, $4, $5, $6, $7, 'MANUAL', $8, 'PENDING', $9, $10)`, [
                paymentId,
                wid,
                sub.id,
                plan.id,
                v.billingPeriod,
                amount,
                plan.currency,
                v.providerReference || `REQ-${Date.now().toString(36).toUpperCase()}`,
                v.paymentNotes || "",
                v.proofUrl || null,
            ]);
            // Record subscription event
            await db.query(`INSERT INTO subscription_events(id, workspace_id, subscription_id, event_type, actor_id, details)
         VALUES($1, $2, $3, 'PAYMENT_REQUESTED', $4, $5)`, [
                randomUUID(),
                wid,
                sub.id,
                r.user.id,
                JSON.stringify({
                    paymentId,
                    planCode: plan.code,
                    amount,
                    billingPeriod: v.billingPeriod,
                    reference: v.providerReference,
                }),
            ]);
            return {
                paymentId,
                amount,
                currency: plan.currency,
                planName: plan.name,
                billingPeriod: v.billingPeriod,
                status: "PENDING",
                instructions: {
                    accountName: "Hindustan Social Network (ContentOS)",
                    bankName: "HDFC Bank",
                    accountNumber: "50200084920194",
                    ifscCode: "HDFC0001234",
                    upiId: "hindustansocial@hdfcbank",
                    supportEmail: "billing@hidustansocialnetwork.in",
                },
            };
        });
        return {
            success: true,
            message: "Payment request submitted successfully. Once your transfer is verified by the Super Admin, your workspace subscription will be activated.",
            payment: result,
        };
    }
    /**
     * POST /api/v1/billing/cancel
     * Request cancellation at current period end
     */
    async cancelSubscription(r) {
        assertPermission(r.workspace.role, "manage");
        const wid = r.workspace.id;
        await transaction(async (db) => {
            const sub = (await db.query("SELECT id, status, current_period_end FROM workspace_subscriptions WHERE workspace_id = $1 FOR UPDATE", [wid])).rows[0];
            if (!sub) {
                throw new NotFoundException("No subscription found for this workspace.");
            }
            await db.query("UPDATE workspace_subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = $1", [sub.id]);
            await db.query(`INSERT INTO subscription_events(id, workspace_id, subscription_id, event_type, actor_id, details)
         VALUES($1, $2, $3, 'CANCELLATION_REQUESTED', $4, $5)`, [
                randomUUID(),
                wid,
                sub.id,
                r.user.id,
                JSON.stringify({ currentPeriodEnd: sub.current_period_end }),
            ]);
        });
        return {
            success: true,
            message: "Your subscription will not renew after the current period ends. Access will remain active until your expiration date.",
        };
    }
};
__decorate([
    Public(),
    Get("plans"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getPlans", null);
__decorate([
    Get("current"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getCurrent", null);
__decorate([
    Get("usage"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getUsageHistory", null);
__decorate([
    Get("history"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getBillingHistory", null);
__decorate([
    Post("payment-request"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "createPaymentRequest", null);
__decorate([
    Post("cancel"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "cancelSubscription", null);
BillingController = __decorate([
    WorkspaceRequired(),
    Controller("billing")
], BillingController);
export { BillingController };
