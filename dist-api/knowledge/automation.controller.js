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
import { Body, Controller, Get, Param, Patch, Post, Req, BadRequestException, NotFoundException, } from "@nestjs/common";
import { z } from "zod";
import { pool, transaction, audit } from "../db.js";
import { assertPermission, WorkspaceRequired, } from "../security.js";
import { knowledgePool } from "./automation.service.js";
export function normalizePostingTime(input) {
    if (typeof input !== "string")
        return "10:00";
    const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
    const normalized = parts
        .map((part) => {
        const match = part.match(/^([01]?\d|2[0-3]):([0-5]?\d)$/);
        if (!match)
            return null;
        const h = match[1].padStart(2, "0");
        const m = match[2].padStart(2, "0");
        return `${h}:${m}`;
    })
        .filter((p) => p !== null);
    return normalized.length > 0 ? normalized.join(", ") : "10:00";
}
export const automationSettingsSchema = z
    .object({
    enabled: z.boolean(),
    horizonDays: z.number().int().min(1).max(14),
    cooldownDays: z.number().int().min(1).max(365),
    platforms: z
        .array(z.enum(["LinkedIn", "Telegram", "X", "Facebook", "Instagram"]))
        .min(1)
        .max(5)
        .refine((p) => new Set(p).size === p.length, "Choose each platform once."),
    postingTime: z
        .string()
        .trim()
        .transform(normalizePostingTime)
        .refine((val) => /^([01]\d|2[0-3]):[0-5]\d(,\s*([01]\d|2[0-3]):[0-5]\d)*$/.test(val), "Invalid time format. Use HH:MM like 07:07 or comma-separated times like 07:07, 13:15.")
        .default("10:00")
        .optional(),
    posterStyle: z.enum(["DIRECT", "BRANDED_CANVAS", "AI_POSTER"]).default("AI_POSTER").optional(),
})
    .strict();
let KnowledgeAutomationController = class KnowledgeAutomationController {
    async overview(r) {
        const workspaceId = r.workspace.id;
        const [topics, settings, plans, workspace, accounts, docsRes, graphicsRes] = await Promise.all([
            knowledgePool(pool, workspaceId),
            pool.query("SELECT * FROM knowledge_automation_settings WHERE workspace_id=$1", [workspaceId]),
            pool.query(`SELECT * FROM (
          SELECT DISTINCT ON (c.id)
            p.id AS id,
            p.id AS plan_id,
            c.id AS content_id,
            c.workspace_id,
            c.title,
            c.body,
            c.variants,
            c.platforms,
            c.status AS content_status,
            c.scheduled_at,
            c.created_at,
            p.source_snapshot,
            p.proposed_at,
            s.id AS scheduled_post_id,
            s.state AS publish_state,
            s.execute_at,
            s.provider_post_id,
            s.error_code,
            sa.platform AS social_platform,
            sa.name AS social_account_name,
            COALESCE(d.original_filename, (p.source_snapshot->'sources'->0->>'documentName'), 'Redhash.pdf') AS document_name
          FROM knowledge_content_plans p
          JOIN content c ON c.id=p.content_id AND c.workspace_id=p.workspace_id
          LEFT JOIN scheduled_posts s ON s.content_id=c.id AND s.workspace_id=c.workspace_id
          LEFT JOIN social_accounts sa ON sa.id=s.account_id
          LEFT JOIN document_knowledge dk ON dk.id=p.knowledge_id
          LEFT JOIN documents d ON d.id=dk.document_id
          WHERE p.workspace_id=$1
            AND (s.state IN ('ENQUEUED', 'SCHEDULED', 'FAILED') OR c.status = 'SCHEDULED')
            AND (s.state IS NULL OR s.state <> 'CANCELLED')
          ORDER BY c.id, (CASE WHEN s.state = 'FAILED' THEN 1 WHEN s.state = 'ENQUEUED' THEN 2 WHEN s.state = 'SCHEDULED' THEN 3 ELSE 4 END)
        ) sub
        ORDER BY execute_at ASC, created_at DESC LIMIT 30`, [workspaceId]),
            pool.query(`SELECT timezone, daily_posting_target, festival_automation_enabled, 
                festival_auto_publish_enabled, festival_approval_mode, 
                festival_post_time, festival_region, festival_language 
         FROM workspaces WHERE id=$1`, [workspaceId]),
            pool.query("SELECT platform,name FROM social_accounts WHERE workspace_id=$1 AND lower(state)='connected'", [workspaceId]),
            pool.query("SELECT id, original_filename, status, page_count, created_at FROM documents WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 5", [workspaceId]),
            pool.query("SELECT COUNT(*)::int AS count FROM document_source_media WHERE workspace_id=$1", [workspaceId]),
        ]);
        return {
            topics,
            settings: settings.rows[0] || {
                enabled: false,
                horizon_days: 14,
                cooldown_days: 90,
                platforms: ["LinkedIn"],
                posting_time: "10:00",
                poster_style: "AI_POSTER",
            },
            plans: plans.rows,
            documents: docsRes.rows,
            graphicsCount: graphicsRes.rows[0]?.count || 0,
            workspace: workspace.rows[0],
            accounts: accounts.rows,
            canManage: ["Owner", "Admin"].includes(r.workspace.role),
            canEdit: ["Owner", "Admin", "Content Manager", "Editor"].includes(r.workspace.role),
            mode: "REVIEW",
        };
    }
    async settings(r, input) {
        assertPermission(r.workspace.role, "manage");
        const value = automationSettingsSchema.parse(input);
        return transaction(async (db) => {
            await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
                r.workspace.id,
            ]);
            const previous = (await db.query("SELECT * FROM knowledge_automation_settings WHERE workspace_id=$1", [r.workspace.id])).rows[0];
            const result = (await db.query(`INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled,horizon_days,cooldown_days,platforms,posting_time,poster_style)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,'10:00'),COALESCE($8,'AI_POSTER')) 
        ON CONFLICT(workspace_id) DO UPDATE SET actor_id=$2,enabled=$3,horizon_days=$4,cooldown_days=$5,platforms=$6,posting_time=COALESCE($7,knowledge_automation_settings.posting_time,'10:00'),poster_style=COALESCE($8,knowledge_automation_settings.poster_style,'AI_POSTER'),next_run_at=now(),updated_at=now() RETURNING *`, [
                r.workspace.id,
                r.user.id,
                value.enabled,
                value.horizonDays,
                value.cooldownDays,
                JSON.stringify(value.platforms),
                value.postingTime || "10:00",
                value.posterStyle || "AI_POSTER",
            ])).rows[0];
            await audit(db, r.workspace.id, r.user.id, value.enabled
                ? "KNOWLEDGE_AUTOMATION_ENABLED"
                : "KNOWLEDGE_AUTOMATION_PAUSED", "workspace", r.workspace.id, "Knowledge automation", previous, result);
            return result;
        });
    }
    async run(r) {
        assertPermission(r.workspace.role, "manage");
        const config = (await pool.query("SELECT enabled FROM knowledge_automation_settings WHERE workspace_id=$1", [r.workspace.id])).rows[0];
        if (!config?.enabled)
            throw new BadRequestException("Enable and save automation before running the planner.");
        // Request work durably; the dedicated worker performs AI calls asynchronously.
        await pool.query("UPDATE knowledge_automation_settings SET next_run_at=now() WHERE workspace_id=$1", [r.workspace.id]);
        return { requested: true };
    }
    async autoPilot(r, input) {
        assertPermission(r.workspace.role, "edit");
        const { KnowledgeAutomationService } = await import("./automation.service.js");
        const service = new KnowledgeAutomationService(pool);
        assertPermission(r.workspace.role, "manage");
        const value = z.object({ documentId: z.string().uuid().optional() }).strict().parse(input || {});
        // Trigger runAutoPilot asynchronously in the background so the UI never hangs
        void service.runAutoPilot(r.workspace.id, r.user.id, value.documentId).catch((err) => {
            console.error("[AutoPilot Background Task Error]:", err?.message || err);
        });
        return {
            success: true,
            generated: 1,
            festivalEnabled: true,
            requested: true,
            message: "⚡ 100% Zero-Touch Auto-Pilot activated! AI is generating and scheduling your posts in the background.",
        };
    }
    async retry(r, rawId) {
        assertPermission(r.workspace.role, "manage");
        const id = z.string().uuid().parse(rawId);
        return transaction(async (db) => {
            await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
                r.workspace.id,
            ]);
            const plan = (await db.query("SELECT * FROM knowledge_content_plans WHERE id=$1 AND workspace_id=$2 AND state='FAILED' AND content_id IS NULL", [id, r.workspace.id])).rows[0];
            if (!plan)
                throw new NotFoundException("Retry is available only for failed generation in this workspace.");
            await db.query("UPDATE knowledge_content_plans SET attempts=0,updated_at=now()-interval '16 minutes' WHERE workspace_id=$1 AND topic_hash=$2 AND state='FAILED' AND content_id IS NULL", [r.workspace.id, plan.topic_hash]);
            await db.query("UPDATE knowledge_automation_settings SET next_run_at=now() WHERE workspace_id=$1", [r.workspace.id]);
            await audit(db, r.workspace.id, r.user.id, "KNOWLEDGE_GENERATION_RETRY", "knowledge_plan", id, "Knowledge proposal");
            return { requested: true };
        });
    }
    async dismiss(r, rawId) {
        assertPermission(r.workspace.role, "manage");
        const id = z.string().uuid().parse(rawId);
        return transaction(async (db) => {
            await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
                r.workspace.id,
            ]);
            const plan = (await db.query(`SELECT p.* FROM knowledge_content_plans p JOIN content c ON c.id=p.content_id AND c.workspace_id=p.workspace_id
        WHERE p.id=$1 AND p.workspace_id=$2 AND p.state='REVIEW' AND c.status IN ('DRAFT','NEEDS_REVIEW') FOR UPDATE OF c,p`, [id, r.workspace.id])).rows[0];
            if (!plan)
                throw new BadRequestException("Only unapproved proposals can be dismissed.");
            await db.query("UPDATE knowledge_content_plans SET state='DISMISSED',updated_at=now() WHERE id=$1", [id]);
            await db.query("UPDATE content SET status='DRAFT',version=version+1,updated_by=$2,updated_at=now() WHERE id=$1", [plan.content_id, r.user.id]);
            await audit(db, r.workspace.id, r.user.id, "KNOWLEDGE_PROPOSAL_DISMISSED", "content", plan.content_id, "Knowledge proposal");
            return { dismissed: true };
        });
    }
    async publishPlanNow(r, id) {
        assertPermission(r.workspace.role, "schedule");
        let contentId = null;
        const plan = (await pool.query("SELECT * FROM knowledge_content_plans WHERE id = $1 AND workspace_id = $2", [id, r.workspace.id])).rows[0];
        if (plan?.content_id) {
            contentId = plan.content_id;
        }
        else {
            const content = (await pool.query("SELECT id FROM content WHERE id = $1 AND workspace_id = $2", [id, r.workspace.id])).rows[0];
            if (content)
                contentId = content.id;
        }
        if (!contentId) {
            throw new NotFoundException("Plan or content not found.");
        }
        const scheduledPosts = (await pool.query("SELECT id FROM scheduled_posts WHERE content_id = $1 AND workspace_id = $2 AND state IN ('ENQUEUED', 'PENDING', 'FAILED')", [contentId, r.workspace.id])).rows;
        if (!scheduledPosts.length) {
            throw new BadRequestException("No pending or failed scheduled posts found for this content.");
        }
        const { executePublishRecord } = await import("../publishing.js");
        const results = [];
        for (const sp of scheduledPosts) {
            await pool.query("UPDATE scheduled_posts SET state='ENQUEUED', error_code=null, attempt_started_at=null WHERE id=$1", [sp.id]);
            const res = await executePublishRecord(sp.id, { attemptsMade: 0, maxAttempts: 3 });
            results.push(res);
        }
        const { deliverEmails } = await import("../mail.js");
        await deliverEmails({ limit: 10 });
        return { success: true, count: results.length, results };
    }
    async refreshPrompt(r, rawId) {
        assertPermission(r.workspace.role, "edit");
        const id = z.string().uuid().parse(rawId);
        const plan = (await pool.query("SELECT * FROM knowledge_content_plans WHERE id = $1 AND workspace_id = $2", [id, r.workspace.id])).rows[0];
        if (!plan) {
            throw new NotFoundException("Plan not found in this workspace.");
        }
        const { ClipdropService } = await import("../clipdrop/clipdrop.service.js");
        const clipdropService = new ClipdropService();
        const brandRow = (await pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [r.workspace.id])).rows[0];
        const brand = brandRow?.data || {};
        const snapshot = (typeof plan.source_snapshot === "string" ? JSON.parse(plan.source_snapshot) : plan.source_snapshot) || {};
        let concept = snapshot.concept || snapshot.value || snapshot.key || "";
        let excerpt = snapshot.excerpt || snapshot.source_excerpt || "";
        let title = snapshot.headline || snapshot.title || plan.title || "Insight";
        if (plan.knowledge_id) {
            const kRow = (await pool.query("SELECT knowledge_key, value, source_excerpt FROM document_knowledge WHERE id = $1", [plan.knowledge_id])).rows[0];
            if (kRow) {
                if (!concept)
                    concept = typeof kRow.value === "string" ? kRow.value : JSON.stringify(kRow.value);
                if (!excerpt)
                    excerpt = kRow.source_excerpt || "";
                if (!title || title === "Insight")
                    title = kRow.knowledge_key || title;
            }
        }
        if (plan.content_id && (!title || title === "Insight")) {
            const cRow = (await pool.query("SELECT title FROM content WHERE id=$1", [plan.content_id])).rows[0];
            if (cRow?.title)
                title = cRow.title;
        }
        if (!concept || concept === "Insight")
            concept = title || "Strategic Business Insight";
        const res = await clipdropService.suggestPosterPrompt({
            knowledgeConcept: typeof concept === "string" ? concept : JSON.stringify(concept),
            excerpt: typeof excerpt === "string" ? excerpt : "",
            title: typeof title === "string" ? title : "Insight",
            brand,
        });
        let newMediaUrl = snapshot.mediaUrl || null;
        let newAssetId = snapshot.mediaAssetId || null;
        try {
            const imgRes = await clipdropService.generateImage({
                workspaceId: r.workspace.id,
                userId: r.user.id,
                prompt: res.prompt,
                engine: "clipdrop",
                headline: res.headline || title,
                aspectRatio: "1:1",
                contentId: plan.content_id || undefined,
                idempotencyKey: `refresh:${id}:${Date.now()}`,
            });
            if (imgRes?.url) {
                newMediaUrl = imgRes.url;
                newAssetId = imgRes.assetId;
            }
        }
        catch (imgErr) {
            console.warn("Could not auto-generate refreshed visual image:", imgErr);
        }
        const updatedSnapshot = {
            ...snapshot,
            posterPrompt: res.prompt,
            headline: res.headline || title,
            mediaUrl: newMediaUrl,
            mediaAssetId: newAssetId,
        };
        await pool.query(`UPDATE knowledge_content_plans 
       SET source_snapshot = $1::jsonb, updated_at = now() 
       WHERE id = $2 AND workspace_id = $3`, [JSON.stringify(updatedSnapshot), id, r.workspace.id]);
        if (plan.content_id && newMediaUrl) {
            const contentRow = (await pool.query("SELECT variants FROM content WHERE id=$1", [plan.content_id])).rows[0];
            if (contentRow?.variants) {
                const variants = typeof contentRow.variants === "string" ? JSON.parse(contentRow.variants) : contentRow.variants;
                for (const platform of Object.keys(variants)) {
                    if (variants[platform]) {
                        variants[platform].mediaUrl = newMediaUrl;
                        variants[platform].mediaAssetId = newAssetId;
                    }
                }
                await pool.query("UPDATE content SET variants=$1::jsonb, updated_at=now() WHERE id=$2", [JSON.stringify(variants), plan.content_id]);
            }
        }
        return {
            success: true,
            planId: id,
            posterPrompt: res.prompt,
            headline: res.headline || title,
            mediaUrl: newMediaUrl,
            assetId: newAssetId,
        };
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "overview", null);
__decorate([
    Patch("settings"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "settings", null);
__decorate([
    Post("run"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "run", null);
__decorate([
    Post("auto-pilot"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "autoPilot", null);
__decorate([
    Post("plans/:id/retry"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "retry", null);
__decorate([
    Post("plans/:id/dismiss"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "dismiss", null);
__decorate([
    Post("plans/:id/publish-now"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "publishPlanNow", null);
__decorate([
    Post("plans/:id/refresh-prompt"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeAutomationController.prototype, "refreshPrompt", null);
KnowledgeAutomationController = __decorate([
    WorkspaceRequired(),
    Controller("knowledge-automation")
], KnowledgeAutomationController);
export { KnowledgeAutomationController };
