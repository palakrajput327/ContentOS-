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
import { Controller, Get, Post, Body, Param, Query, Req, BadRequestException, } from "@nestjs/common";
import { assertPermission, WorkspaceRequired, } from "../security.js";
import { pool } from "../db.js";
import { FestivalService } from "./festival.service.js";
import { z } from "zod";
import { transaction, audit } from "../db.js";
import { validateTimezone } from "../security.js";
import { FestivalAutoSchedulerService } from "./festival-auto-scheduler.js";
import { getDailyCapacity, assertDailySlot } from "./daily-posting.js";
import { randomUUID } from "node:crypto";
let FestivalController = class FestivalController {
    /**
     * GET /api/v1/calendar/festivals
     * Returns list of Indian festivals for specified year (default: current year)
     */
    async getFestivals(yearStr, region, category) {
        const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
        if (isNaN(year) || year < 2020 || year > 2035) {
            throw new BadRequestException("Invalid year parameter.");
        }
        const festivals = FestivalService.listFestivals(year, { region, category });
        return { year, count: festivals.length, festivals };
    }
    /**
     * POST /api/v1/calendar/festivals/:id/preview
     * Previews a festival poster SVG and image details without persisting to DB
     */
    async previewFestivalPoster(req, festivalId, body) {
        if (!festivalId) {
            throw new BadRequestException("Festival ID parameter is required.");
        }
        const brand = (await pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [
            req.workspace.id,
        ])).rows[0]?.data;
        if (!brand?.companyName && !brand?.name)
            throw new BadRequestException("Add your company name in the brand kit first.");
        const preview = await FestivalService.previewPoster(festivalId, {
            year: body.year,
            language: body.language,
            customWish: body.customWish,
            brandKit: { ...brand, companyName: brand.companyName || brand.name },
        });
        return {
            festivalId,
            name: preview.festival.name,
            date: preview.date,
            titleText: preview.titleText,
            wishText: preview.wishText,
            svg: preview.svg,
        };
    }
    /**
     * POST /api/v1/calendar/festivals/:id/generate-draft
     * Generates a brand-framed festival poster JPEG, uploads to storage, and creates content draft in DB.
     * NEVER auto-publishes immediately.
     */
    async generateFestivalDraft(req, festivalId, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "edit");
        if (!festivalId) {
            throw new BadRequestException("Festival ID parameter is required.");
        }
        const draft = await FestivalService.generateDraft(pool, {
            workspaceId: ws.id,
            userId: req.user.id,
            festivalId,
            year: body.year,
            language: body.language,
            customWish: body.customWish,
            targetPlatforms: body.targetPlatforms,
            targetDate: body.targetDate,
        });
        return {
            success: true,
            message: "Festival poster draft generated successfully.",
            draft,
        };
    }
    /**
     * GET /api/v1/calendar/festivals/settings
     * Retrieves festival automation and auto-publish settings for the active workspace
     */
    async getSettings(req) {
        const ws = req.workspace;
        const res = await pool.query(`SELECT id, name, timezone, festival_automation_enabled, festival_prep_days,
              festival_region, festival_language, festival_post_time,
              festival_auto_publish_enabled, festival_approval_mode, festival_social_account_ids, daily_posting_target
       FROM workspaces WHERE id = $1`, [ws.id]);
        return res.rows[0];
    }
    /**
     * PATCH /api/v1/calendar/festivals/settings
     * Updates festival automation and auto-publish settings for the active workspace
     */
    async updateSettings(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "manage");
        return transaction(async (db) => {
            body = z
                .object({
                festival_automation_enabled: z.boolean().optional(),
                festival_auto_publish_enabled: z.boolean().optional(),
                festival_prep_days: z.number().int().min(1).max(30).optional(),
                festival_region: z
                    .enum(["ALL", "NORTH", "SOUTH", "EAST", "WEST"])
                    .optional(),
                festival_language: z.enum(["EN", "HI", "HINGLISH"]).optional(),
                festival_post_time: z
                    .string()
                    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
                    .optional(),
                festival_approval_mode: z
                    .enum(["MANUAL_APPROVAL", "AUTO_APPROVAL"])
                    .optional(),
                festival_social_account_ids: z
                    .array(z.string().uuid())
                    .max(50)
                    .optional(),
                timezone: z.string().optional(),
                daily_posting_target: z.number().int().min(1).max(50).optional(),
            })
                .strict()
                .parse(body);
            if (body.timezone)
                validateTimezone(body.timezone);
            if (body.festival_approval_mode &&
                !["MANUAL_APPROVAL", "AUTO_APPROVAL"].includes(body.festival_approval_mode)) {
                throw new BadRequestException("Invalid festival_approval_mode.");
            }
            const currentRes = await db.query(`SELECT festival_automation_enabled, festival_prep_days, festival_region,
              festival_language, festival_post_time, festival_auto_publish_enabled,
              festival_approval_mode, festival_social_account_ids, timezone, daily_posting_target
       FROM workspaces WHERE id = $1 FOR UPDATE`, [ws.id]);
            const curr = currentRes.rows[0] || {};
            const updated = {
                timezone: body.timezone || curr.timezone,
                daily_posting_target: body.daily_posting_target ?? curr.daily_posting_target,
                festival_automation_enabled: body.festival_automation_enabled !== undefined
                    ? Boolean(body.festival_automation_enabled)
                    : curr.festival_automation_enabled,
                festival_prep_days: body.festival_prep_days !== undefined
                    ? Math.max(1, Math.min(30, Number(body.festival_prep_days)))
                    : curr.festival_prep_days,
                festival_region: body.festival_region || curr.festival_region || "ALL",
                festival_language: body.festival_language || curr.festival_language || "HINGLISH",
                festival_post_time: body.festival_post_time || curr.festival_post_time || "09:00",
                festival_auto_publish_enabled: body.festival_auto_publish_enabled !== undefined
                    ? Boolean(body.festival_auto_publish_enabled)
                    : curr.festival_auto_publish_enabled,
                festival_approval_mode: body.festival_approval_mode ||
                    curr.festival_approval_mode ||
                    "MANUAL_APPROVAL",
                festival_social_account_ids: body.festival_social_account_ids !== undefined
                    ? body.festival_social_account_ids
                    : curr.festival_social_account_ids || [],
            };
            const ids = [...new Set(updated.festival_social_account_ids)];
            const eligible = await FestivalAutoSchedulerService.getEligibleSocialAccounts(db, ws.id, ids);
            if (eligible.length !== ids.length)
                throw new BadRequestException("Select only connected accounts with valid publishing credentials in this workspace.");
            if (updated.festival_auto_publish_enabled &&
                (!updated.festival_automation_enabled || !ids.length))
                throw new BadRequestException("Enable festival generation and select connected accounts before enabling publishing.");
            const updateRes = await db.query(`UPDATE workspaces
       SET festival_automation_enabled = $2,
           festival_prep_days = $3,
           festival_region = $4,
           festival_language = $5,
           festival_post_time = $6,
           festival_auto_publish_enabled = $7,
           festival_approval_mode = $8,
           festival_social_account_ids = $9, timezone = $10, daily_posting_target = $11
       WHERE id = $1
       RETURNING id, name, festival_automation_enabled, festival_prep_days,
                 festival_region, festival_language, festival_post_time,
                 festival_auto_publish_enabled, festival_approval_mode, festival_social_account_ids`, [
                ws.id,
                updated.festival_automation_enabled,
                updated.festival_prep_days,
                updated.festival_region,
                updated.festival_language,
                updated.festival_post_time,
                updated.festival_auto_publish_enabled,
                updated.festival_approval_mode,
                updated.festival_social_account_ids,
                updated.timezone,
                updated.daily_posting_target,
            ]);
            return {
                success: true,
                message: "Festival automation settings updated successfully.",
                settings: updateRes.rows[0],
            };
        });
    }
    async monitor(req) {
        const workspaceId = req.workspace.id;
        const [posts, accounts, brand] = await Promise.all([
            pool.query(`SELECT f.*, c.title, c.status AS content_status, c.variants, c.scheduled_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'platform',a.platform,'name',a.name,'state',s.state,'error',s.error_code,'providerPostId',s.provider_post_id,'executeAt',s.execute_at))
        FROM scheduled_posts s JOIN social_accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id
        WHERE s.content_id=c.id AND s.workspace_id=$1), '[]'::jsonb) AS jobs
        FROM scheduled_festival_posts f LEFT JOIN content c ON c.id=f.content_id AND c.workspace_id=f.workspace_id
        WHERE f.workspace_id=$1 ORDER BY f.festival_date DESC LIMIT 200`, [workspaceId]),
            pool.query(`SELECT a.id,a.name,a.platform,a.state, (lower(a.state)='connected' AND t.account_id IS NOT NULL AND (t.expires_at IS NULL OR t.expires_at>now()) AND lower(a.platform) IN ('linkedin','instagram','telegram','facebook')) AS eligible
        FROM social_accounts a LEFT JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1`, [workspaceId]),
            pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [
                workspaceId,
            ]),
        ]);
        return {
            posts: posts.rows,
            accounts: accounts.rows,
            hasBrand: !!(brand.rows[0]?.data?.companyName || brand.rows[0]?.data?.name),
        };
    }
    async capacity(req, date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
            !Number.isFinite(Date.parse(date)))
            throw new BadRequestException("Valid date required.");
        return getDailyCapacity(pool, req.workspace.id, date);
    }
    async retry(req, jobId) {
        assertPermission(req.workspace.role, "schedule");
        z.string().uuid().parse(jobId);
        return transaction(async (db) => {
            const job = (await db.query(`SELECT s.* FROM scheduled_posts s JOIN scheduled_festival_posts f ON f.content_id=s.content_id AND f.workspace_id=s.workspace_id WHERE s.id=$1 AND s.workspace_id=$2 FOR UPDATE OF s`, [jobId, req.workspace.id])).rows[0];
            if (!job || job.state !== "FAILED" || job.provider_post_id)
                throw new BadRequestException("Only confirmed failed, unpublished jobs can be retried. Uncertain jobs require verification.");
            const eligible = await FestivalAutoSchedulerService.getEligibleSocialAccounts(db, req.workspace.id, [job.account_id]);
            if (!eligible.length)
                throw new BadRequestException("Reconnect this account before retrying.");
            const { publishingQueue } = await import("../queues.js");
            const queued = await publishingQueue.getJob(jobId, req.workspace.id, db);
            if (queued) {
                const state = await queued.getState();
                if (!["failed", "completed"].includes(state))
                    throw new BadRequestException("Publishing attempt is still active. Try again after it finishes.");
                await queued.remove();
            }
            await db.query(`UPDATE scheduled_posts SET state='PENDING',execute_at=now(),error_code=NULL,attempt_started_at=NULL WHERE id=$1`, [jobId]);
            await audit(db, req.workspace.id, req.user.id, "retry", "scheduled_post", jobId, "Festival publishing retry");
            return { success: true };
        });
    }
    async retryGeneration(req, id) {
        assertPermission(req.workspace.role, 'edit');
        z.string().uuid().parse(id);
        return transaction(async (db) => {
            await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [req.workspace.id]);
            const deleted = await db.query(`DELETE FROM scheduled_festival_posts WHERE id=$1 AND workspace_id=$2 AND status='FAILED' AND content_id IS NULL RETURNING festival_id`, [id, req.workspace.id]);
            if (!deleted.rows.length)
                throw new BadRequestException('Only failed generation records without content can be retried.');
            await audit(db, req.workspace.id, req.user.id, 'retry_generation', 'festival', id, deleted.rows[0].festival_id);
            return { success: true };
        });
    }
    async approveSchedule(req, id, input) {
        assertPermission(req.workspace.role, "approve");
        assertPermission(req.workspace.role, "schedule");
        z.string().uuid().parse(id);
        const body = z
            .object({ scheduledAt: z.string().datetime({ offset: true }) })
            .parse(input);
        const at = new Date(body.scheduledAt);
        if (at.getTime() <= Date.now() + 60000)
            throw new BadRequestException("Choose a future posting time.");
        return transaction(async (db) => {
            const ws = (await db.query("SELECT * FROM workspaces WHERE id=$1 FOR UPDATE", [
                req.workspace.id,
            ])).rows[0];
            const post = (await db.query(`SELECT c.* FROM content c JOIN scheduled_festival_posts f ON f.content_id=c.id AND f.workspace_id=c.workspace_id WHERE c.id=$1 AND c.workspace_id=$2 FOR UPDATE OF c`, [id, ws.id])).rows[0];
            if (!post || !["NEEDS_REVIEW", "APPROVED"].includes(post.status))
                throw new BadRequestException("Post must be awaiting approval or approved.");
            const accounts = await FestivalAutoSchedulerService.getEligibleSocialAccounts(db, ws.id, ws.festival_social_account_ids);
            if (!accounts.length)
                throw new BadRequestException("Select connected accounts in festival settings first.");
            await assertDailySlot(db, ws.id, post, at);
            await db.query(`INSERT INTO approvals(id,workspace_id,content_id,version,actor_id,decision) VALUES($1,$2,$3,$4,$5,'approve')`, [randomUUID(), ws.id, id, post.version, req.user.id]);
            await db.query(`UPDATE content SET status='SCHEDULED',approved_by=$3,scheduled_by=$3,scheduled_at=$4,timezone=$5,platforms=$6,updated_at=now() WHERE id=$1 AND workspace_id=$2`, [
                id,
                ws.id,
                req.user.id,
                at,
                ws.timezone,
                JSON.stringify([...new Set(accounts.map((a) => a.platform))]),
            ]);
            for (const account of accounts)
                await db.query(`INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(content_id,account_id,content_version) DO NOTHING`, [randomUUID(), ws.id, id, account.id, post.version, at, ws.timezone]);
            await db.query(`UPDATE scheduled_festival_posts SET publish_status='SCHEDULED' WHERE content_id=$1 AND workspace_id=$2`, [id, ws.id]);
            await audit(db, ws.id, req.user.id, "approve_schedule", "content", id, post.title);
            return { success: true };
        });
    }
};
__decorate([
    Get(),
    __param(0, Query("year")),
    __param(1, Query("region")),
    __param(2, Query("category")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "getFestivals", null);
__decorate([
    Post(":id/preview"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "previewFestivalPoster", null);
__decorate([
    Post(":id/generate-draft"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "generateFestivalDraft", null);
__decorate([
    Get("settings"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "getSettings", null);
__decorate([
    Post("settings"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "updateSettings", null);
__decorate([
    Get("monitor"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "monitor", null);
__decorate([
    Get("daily-capacity"),
    __param(0, Req()),
    __param(1, Query("date")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "capacity", null);
__decorate([
    Post("jobs/:jobId/retry"),
    __param(0, Req()),
    __param(1, Param("jobId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "retry", null);
__decorate([
    Post('records/:id/retry-generation'),
    __param(0, Req()),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "retryGeneration", null);
__decorate([
    Post("posts/:id/approve-schedule"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], FestivalController.prototype, "approveSchedule", null);
FestivalController = __decorate([
    WorkspaceRequired(),
    Controller("calendar/festivals")
], FestivalController);
export { FestivalController };
