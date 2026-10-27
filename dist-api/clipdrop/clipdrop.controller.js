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
import { Controller, Post, Body, Req, } from "@nestjs/common";
import { z } from "zod";
import { WorkspaceRequired, assertPermission } from "../security.js";
import { ClipdropService } from "./clipdrop.service.js";
import { assertWorkspaceActive } from "../billing/entitlement.service.js";
const suggestPromptSchema = z.object({
    contentText: z.string().min(1).max(10000),
    platform: z.string().optional(),
    contextInfo: z.string().optional(),
});
const suggestPosterPromptSchema = z.object({
    knowledgeConcept: z.string().min(1).max(5000),
    excerpt: z.string().max(2000).optional(),
    sourceVisualContext: z.string().max(1000).optional(),
    title: z.string().max(200).optional(),
    platform: z.string().optional(),
});
const generateImageSchema = z.object({
    prompt: z.string().trim().min(3).max(2000),
    engine: z.enum(["clipdrop", "flux"]).default("clipdrop"),
    stylePreset: z.string().optional(),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]).default("1:1"),
    headline: z.string().max(200).optional(),
    logoText: z.string().max(80).optional(),
    websiteUrl: z.string().max(120).optional(),
    cta: z.string().max(100).optional(),
    enableOverlay: z.boolean().default(false),
    contentId: z.string().uuid().optional(),
    platform: z.string().optional(),
    idempotencyKey: z.string().optional(),
});
const removeBgSchema = z.object({
    assetId: z.string().uuid(),
});
const attachAndSaveSchema = z.object({
    contentId: z.string().uuid().optional(),
    title: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((v) => (v && v.trim() ? v : "AI Visual Post"))
        .default("AI Visual Post"),
    body: z
        .string()
        .trim()
        .max(10000)
        .optional()
        .transform((v) => (v && v.trim() ? v : "Visual created with AI Studio"))
        .default("Visual created with AI Studio"),
    platforms: z.array(z.string()).min(1),
    assetId: z.string().uuid(),
    mediaUrl: z.string().min(1),
    status: z.enum(["DRAFT", "NEEDS_REVIEW"]).default("NEEDS_REVIEW"),
});
let ClipdropController = class ClipdropController {
    clipdropService;
    constructor(clipdropService) {
        this.clipdropService = clipdropService;
    }
    async suggestPrompt(r, input) {
        assertPermission(r.workspace.role, "edit");
        const v = suggestPromptSchema.parse(input);
        return this.clipdropService.suggestPrompt(v.contentText, v.platform, v.contextInfo);
    }
    async suggestPosterPrompt(r, input) {
        assertPermission(r.workspace.role, "edit");
        const v = suggestPosterPromptSchema.parse(input);
        const { pool } = await import("../db.js");
        const brandRow = (await pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [r.workspace.id])).rows[0];
        const brand = brandRow?.data || {};
        return this.clipdropService.suggestPosterPrompt({
            knowledgeConcept: v.knowledgeConcept,
            excerpt: v.excerpt,
            sourceVisualContext: v.sourceVisualContext,
            title: v.title,
            brand,
            platform: v.platform,
        });
    }
    async generateImage(r, input) {
        assertPermission(r.workspace.role, "edit");
        await assertWorkspaceActive(r.workspace.id, "AI visual generation");
        const v = generateImageSchema.parse(input);
        return this.clipdropService.generateImage({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            prompt: v.prompt,
            engine: v.engine,
            stylePreset: v.stylePreset,
            aspectRatio: v.aspectRatio,
            headline: v.headline,
            logoText: v.logoText,
            websiteUrl: v.websiteUrl,
            cta: v.cta,
            enableOverlay: v.enableOverlay,
            contentId: v.contentId,
            platform: v.platform,
            idempotencyKey: v.idempotencyKey,
        });
    }
    async removeBackground(r, input) {
        assertPermission(r.workspace.role, "edit");
        await assertWorkspaceActive(r.workspace.id, "AI image processing");
        const v = removeBgSchema.parse(input);
        return this.clipdropService.removeBackground({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            assetId: v.assetId,
        });
    }
    async attachAndSave(r, input) {
        assertPermission(r.workspace.role, "edit");
        const v = attachAndSaveSchema.parse(input);
        return this.clipdropService.attachAndSave({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            contentId: v.contentId,
            title: v.title,
            body: v.body,
            platforms: v.platforms,
            assetId: v.assetId,
            mediaUrl: v.mediaUrl,
            status: v.status,
        });
    }
};
__decorate([
    Post("suggest-prompt"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ClipdropController.prototype, "suggestPrompt", null);
__decorate([
    Post("suggest-poster-prompt"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ClipdropController.prototype, "suggestPosterPrompt", null);
__decorate([
    Post("generate-image"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ClipdropController.prototype, "generateImage", null);
__decorate([
    Post("remove-background"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ClipdropController.prototype, "removeBackground", null);
__decorate([
    Post("attach-and-save"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ClipdropController.prototype, "attachAndSave", null);
ClipdropController = __decorate([
    WorkspaceRequired(),
    Controller("clipdrop"),
    __metadata("design:paramtypes", [ClipdropService])
], ClipdropController);
export { ClipdropController };
