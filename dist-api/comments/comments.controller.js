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
import { Controller, Get, Post, Patch, Param, Body, Req, NotFoundException, BadRequestException, } from "@nestjs/common";
import { WorkspaceRequired } from "../security.js";
import { pool } from "../db.js";
import { CommentsService } from "./comments.service.js";
let CommentsController = class CommentsController {
    /**
     * GET /api/v1/content/:id/comments
     * Returns threaded comments for a content item.
     */
    async listComments(req, id) {
        const ws = req.workspace;
        const comments = await CommentsService.listComments(pool, ws.id, id);
        return { comments };
    }
    /**
     * POST /api/v1/content/:id/comments
     * Adds a new comment or threaded reply.
     */
    async createComment(req, id, body) {
        const ws = req.workspace;
        const user = req.user;
        try {
            const comment = await CommentsService.createComment(pool, ws.id, id, user.id, {
                comment: body.comment,
                parentId: body.parentId,
                mentions: body.mentions,
            });
            return { comment };
        }
        catch (err) {
            throw new BadRequestException(err.message);
        }
    }
    /**
     * PATCH /api/v1/content/:id/comments/:commentId/resolve
     * Toggles resolved status of comment thread.
     */
    async resolveComment(req, id, commentId, body) {
        const ws = req.workspace;
        const user = req.user;
        const isResolved = typeof body.resolved === "boolean" ? body.resolved : true;
        const success = await CommentsService.resolveComment(pool, ws.id, id, commentId, user.id, isResolved);
        if (!success) {
            throw new NotFoundException("Comment not found in this thread.");
        }
        return { success: true, resolved: isResolved };
    }
    /**
     * POST /api/v1/content/:id/assign
     * Assigns content item to a workspace member (or unassigns if assignedTo is null).
     */
    async assignContent(req, id, body) {
        const ws = req.workspace;
        const user = req.user;
        try {
            const result = await CommentsService.assignContent(pool, ws.id, id, user.id, body.assignedTo ?? null);
            return { success: true, ...result };
        }
        catch (err) {
            throw new BadRequestException(err.message);
        }
    }
    /**
     * GET /api/v1/content/:id/timeline
     * Retrieves unified audit and comment activity timeline for content.
     */
    async getTimeline(req, id) {
        const ws = req.workspace;
        const timeline = await CommentsService.getContentTimeline(pool, ws.id, id);
        return { timeline };
    }
};
__decorate([
    Get(":id/comments"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CommentsController.prototype, "listComments", null);
__decorate([
    Post(":id/comments"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CommentsController.prototype, "createComment", null);
__decorate([
    Patch(":id/comments/:commentId/resolve"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Param("commentId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], CommentsController.prototype, "resolveComment", null);
__decorate([
    Post(":id/assign"),
    __param(0, Req()),
    __param(1, Param("id")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CommentsController.prototype, "assignContent", null);
__decorate([
    Get(":id/timeline"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CommentsController.prototype, "getTimeline", null);
CommentsController = __decorate([
    WorkspaceRequired(),
    Controller("content")
], CommentsController);
export { CommentsController };
