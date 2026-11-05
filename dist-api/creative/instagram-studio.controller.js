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
import { Controller, Get, Post, Put, Body, Param, Req, BadRequestException, } from "@nestjs/common";
import { assertPermission, WorkspaceRequired } from "../security.js";
import { BrandDnaService } from "./brand-dna.service.js";
import { CreativeVariationService } from "./creative-variation.service.js";
import { CarouselService } from "./carousel.service.js";
let InstagramStudioController = class InstagramStudioController {
    brandDnaService = new BrandDnaService();
    variationService = new CreativeVariationService();
    carouselService = new CarouselService();
    // ==========================================
    // 1. SMART BRAND DNA ENDPOINTS
    // ==========================================
    async getBrandDna(r) {
        return this.brandDnaService.getBrandDna(r.workspace.id);
    }
    async extractBrandDna(r, body) {
        assertPermission(r.workspace.role, "edit");
        return this.brandDnaService.extractBrandDna({
            workspaceId: r.workspace.id,
            documentId: body?.documentId,
            rawText: body?.rawText,
            url: body?.url,
        });
    }
    async updateBrandDna(r, body) {
        assertPermission(r.workspace.role, "edit");
        return this.brandDnaService.updateBrandDna(r.workspace.id, body || {});
    }
    async uploadBrandLogo(r, body) {
        assertPermission(r.workspace.role, "edit");
        if (!body?.dataUrl || !body.dataUrl.includes(",")) {
            throw new BadRequestException("Valid base64 dataUrl is required for logo upload.");
        }
        const [header, base64Data] = body.dataUrl.split(",");
        const mimeMatch = header.match(/data:([^;]+);/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
        const buffer = Buffer.from(base64Data, "base64");
        const filename = body.filename || `logo_${Date.now()}.png`;
        return this.brandDnaService.uploadBrandLogo({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            buffer,
            mimeType,
            filename,
        });
    }
    // ==========================================
    // 2. CREATIVE VARIATION LAB ENDPOINTS
    // ==========================================
    async generateVariations(r, body) {
        assertPermission(r.workspace.role, "edit");
        if (!body?.topic || body.topic.trim().length < 3) {
            throw new BadRequestException("Please provide a topic or concept idea (at least 3 characters).");
        }
        return this.variationService.generateThreeVariations({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            topic: body.topic.trim(),
            documentId: body.documentId,
        });
    }
    async getBatchVariations(r, batchId) {
        return this.variationService.getBatchVariations(batchId, r.workspace.id);
    }
    async generateVariationImage(r, variationId, body) {
        assertPermission(r.workspace.role, "edit");
        return this.variationService.generateVariationImage({
            variationId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
            customPrompt: body?.prompt,
        });
    }
    async regenerateVariation(r, variationId, body) {
        assertPermission(r.workspace.role, "edit");
        return this.variationService.regenerateSingleVariation({
            variationId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
            customPrompt: body?.prompt,
        });
    }
    async saveVariationAsDraft(r, variationId) {
        assertPermission(r.workspace.role, "schedule");
        return this.variationService.saveVariationAsInstagramDraft({
            variationId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
        });
    }
    // ==========================================
    // 3. INSTAGRAM CAROUSEL BUILDER ENDPOINTS
    // ==========================================
    async generateCarousel(r, body) {
        assertPermission(r.workspace.role, "edit");
        if (!body?.topic || body.topic.trim().length < 3) {
            throw new BadRequestException("Please provide a topic or PDF context for carousel generation.");
        }
        return this.carouselService.generateCarousel({
            workspaceId: r.workspace.id,
            userId: r.user.id,
            topic: body.topic.trim(),
            slideCount: body.slideCount,
            documentId: body.documentId,
            themeStyle: body.themeStyle,
        });
    }
    async listCarousels(r) {
        return this.carouselService.listCarousels(r.workspace.id);
    }
    async getCarousel(r, carouselId) {
        return this.carouselService.getCarousel(carouselId, r.workspace.id);
    }
    async reorderCarouselSlides(r, carouselId, body) {
        assertPermission(r.workspace.role, "edit");
        if (!Array.isArray(body?.orderedSlideIds) || body.orderedSlideIds.length === 0) {
            throw new BadRequestException("orderedSlideIds array is required.");
        }
        return this.carouselService.reorderSlides({
            carouselId,
            workspaceId: r.workspace.id,
            orderedSlideIds: body.orderedSlideIds,
        });
    }
    async updateCarouselSlide(r, carouselId, slideId, body) {
        assertPermission(r.workspace.role, "edit");
        return this.carouselService.updateSlide({
            slideId,
            carouselId,
            workspaceId: r.workspace.id,
            headline: body?.headline,
            bodyText: body?.bodyText,
            badgeText: body?.badgeText,
        });
    }
    async renderCarouselSlide(r, _carouselId, slideId, body) {
        assertPermission(r.workspace.role, "edit");
        return this.carouselService.renderSlideCanvas({
            slideId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
            generateBgArt: Boolean(body?.generateBgArt),
        });
    }
    async renderAllCarouselSlides(r, carouselId) {
        assertPermission(r.workspace.role, "edit");
        return this.carouselService.renderAllSlides({
            carouselId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
        });
    }
    async saveCarouselAsDraft(r, carouselId) {
        assertPermission(r.workspace.role, "schedule");
        return this.carouselService.saveCarouselAsInstagramDraft({
            carouselId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
        });
    }
    async publishCarouselNow(r, carouselId) {
        assertPermission(r.workspace.role, "schedule");
        return this.carouselService.publishCarouselNow({
            carouselId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
        });
    }
};
__decorate([
    WorkspaceRequired(),
    Get("brand-dna"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "getBrandDna", null);
__decorate([
    WorkspaceRequired(),
    Post("brand-dna/extract"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "extractBrandDna", null);
__decorate([
    WorkspaceRequired(),
    Put("brand-dna"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "updateBrandDna", null);
__decorate([
    WorkspaceRequired(),
    Post("brand-dna/upload-logo"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "uploadBrandLogo", null);
__decorate([
    WorkspaceRequired(),
    Post("variations/generate"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "generateVariations", null);
__decorate([
    WorkspaceRequired(),
    Get("variations/batch/:batchId"),
    __param(0, Req()),
    __param(1, Param("batchId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "getBatchVariations", null);
__decorate([
    WorkspaceRequired(),
    Post("variations/:id/generate-image"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "generateVariationImage", null);
__decorate([
    WorkspaceRequired(),
    Post("variations/:id/regenerate"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "regenerateVariation", null);
__decorate([
    WorkspaceRequired(),
    Post("variations/:id/save-draft"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "saveVariationAsDraft", null);
__decorate([
    WorkspaceRequired(),
    Post("carousels/generate"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "generateCarousel", null);
__decorate([
    WorkspaceRequired(),
    Get("carousels"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "listCarousels", null);
__decorate([
    WorkspaceRequired(),
    Get("carousels/:id"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "getCarousel", null);
__decorate([
    WorkspaceRequired(),
    Put("carousels/:id/reorder"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "reorderCarouselSlides", null);
__decorate([
    WorkspaceRequired(),
    Put("carousels/:id/slides/:slideId"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("slideId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "updateCarouselSlide", null);
__decorate([
    WorkspaceRequired(),
    Post("carousels/:id/slides/:slideId/render"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("slideId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "renderCarouselSlide", null);
__decorate([
    WorkspaceRequired(),
    Post("carousels/:id/render-all"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "renderAllCarouselSlides", null);
__decorate([
    WorkspaceRequired(),
    Post("carousels/:id/save-draft"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "saveCarouselAsDraft", null);
__decorate([
    WorkspaceRequired(),
    Post("carousels/:id/publish"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], InstagramStudioController.prototype, "publishCarouselNow", null);
InstagramStudioController = __decorate([
    Controller("instagram-studio")
], InstagramStudioController);
export { InstagramStudioController };
