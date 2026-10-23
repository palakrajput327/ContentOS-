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
import { Controller, Post, Req, Param, Body } from "@nestjs/common";
import { z } from "zod";
import { transaction } from "../db.js";
import { WorkspaceRequired, assertPermission, } from "../security.js";
import { sourceReference } from "./source-original.js";
import { VisualKnowledgeService } from "./visual-knowledge.service.js";
import { SourcePosterService, sourcePosterSchema, approveSourceReuse, } from "./source-poster.js";
let VisualMediaController = class VisualMediaController {
    async analyze(r, documentId, sourceId, input) {
        assertPermission(r.workspace.role, "edit");
        const value = z
            .object({ includeVision: z.boolean().default(false) })
            .parse(input);
        return new VisualKnowledgeService().analyze(r.workspace.id, documentId, sourceId, r.user.id, value.includeVision);
    }
    async reuse(r, documentId, sourceId, input) {
        assertPermission(r.workspace.role, "edit");
        const value = z
            .object({
            allowed: z.boolean(),
            rightsConfirmed: z.boolean().default(false),
        })
            .refine((v) => !v.allowed || v.rightsConfirmed, "Confirm that your workspace may reuse this image.")
            .parse(input);
        return transaction(async (db) => {
            const source = await sourceReference(db, r.workspace.id, documentId, sourceId);
            return approveSourceReuse(db, r.workspace.id, source, r.user.id, value.allowed);
        });
    }
    async poster(r, documentId, sourceId, input) {
        assertPermission(r.workspace.role, "edit");
        return new SourcePosterService().create(r.workspace.id, documentId, sourceId, r.user.id, sourcePosterSchema.parse(input));
    }
};
__decorate([
    Post(":documentId/source-media/:sourceId/analyze"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("sourceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], VisualMediaController.prototype, "analyze", null);
__decorate([
    Post(":documentId/source-media/:sourceId/reuse"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("sourceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], VisualMediaController.prototype, "reuse", null);
__decorate([
    Post(":documentId/source-media/:sourceId/poster"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("sourceId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], VisualMediaController.prototype, "poster", null);
VisualMediaController = __decorate([
    WorkspaceRequired(),
    Controller("documents")
], VisualMediaController);
export { VisualMediaController };
