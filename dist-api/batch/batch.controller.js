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
import { Controller, Post, Get, Param, Body, Req, BadRequestException } from "@nestjs/common";
import { assertPermission } from "../security.js";
import { BatchService } from "./batch.service.js";
let BatchController = class BatchController {
    async createBatchAIGeneration(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "edit");
        if (!body.items || !Array.isArray(body.items) || !body.items.length) {
            throw new BadRequestException("items array is required with at least 1 generation topic.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "ai_generation",
            items: body.items.map((item, idx) => ({
                operationType: "ai_generation",
                payload: { ...item, userId: req.user.id },
                idempotencyKey: `ai-gen-${ws.id}-${Date.now()}-${idx}`,
            })),
        });
    }
    async createBulkSave(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "edit");
        if (!body.items || !Array.isArray(body.items) || !body.items.length) {
            throw new BadRequestException("items array is required with posts to save.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "bulk_save",
            items: body.items.map((item, idx) => ({
                operationType: "bulk_save",
                payload: { ...item, userId: req.user.id },
                idempotencyKey: `bulk-save-${ws.id}-${Date.now()}-${idx}`,
            })),
        });
    }
    async bulkApprove(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "approve");
        if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
            throw new BadRequestException("contentIds array is required.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "bulk_approve",
            items: body.contentIds.map((id) => ({
                operationType: "bulk_approve",
                targetId: id,
                payload: { contentId: id, userId: req.user.id },
                idempotencyKey: `bulk-approve-${ws.id}-${id}`,
            })),
        });
    }
    async bulkReject(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "approve");
        if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
            throw new BadRequestException("contentIds array is required.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "bulk_reject",
            items: body.contentIds.map((id) => ({
                operationType: "bulk_reject",
                targetId: id,
                payload: { contentId: id, userId: req.user.id },
                idempotencyKey: `bulk-reject-${ws.id}-${id}`,
            })),
        });
    }
    async bulkSchedule(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "schedule");
        if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
            throw new BadRequestException("contentIds array is required.");
        }
        if (!body.scheduledAt) {
            throw new BadRequestException("scheduledAt ISO timestamp is required.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "bulk_schedule",
            items: body.contentIds.map((id) => ({
                operationType: "bulk_schedule",
                targetId: id,
                payload: {
                    contentId: id,
                    scheduledAt: body.scheduledAt,
                    timezone: body.timezone || "UTC",
                    userId: req.user.id,
                },
                idempotencyKey: `bulk-sched-${ws.id}-${id}-${body.scheduledAt}`,
            })),
        });
    }
    async bulkPublish(req, body) {
        const ws = req.workspace;
        assertPermission(ws.role, "schedule");
        if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
            throw new BadRequestException("contentIds array is required.");
        }
        return BatchService.createBatch({
            workspaceId: ws.id,
            userId: req.user.id,
            role: ws.role,
            type: "bulk_publish",
            items: body.contentIds.map((id) => ({
                operationType: "bulk_publish",
                targetId: id,
                payload: { contentId: id, userId: req.user.id },
                idempotencyKey: `bulk-pub-${ws.id}-${id}`,
            })),
        });
    }
    async retryFailed(req, batchId) {
        const ws = req.workspace;
        assertPermission(ws.role, "edit");
        return BatchService.retryFailedChildren(ws.id, batchId, req.user.id);
    }
    async getBatch(req, batchId) {
        const ws = req.workspace;
        return BatchService.getBatchStatus(ws.id, batchId);
    }
    async listBatches(req) {
        const ws = req.workspace;
        return BatchService.listBatches(ws.id);
    }
};
__decorate([
    Post("ai-generation"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "createBatchAIGeneration", null);
__decorate([
    Post("bulk-save"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "createBulkSave", null);
__decorate([
    Post("bulk-approve"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "bulkApprove", null);
__decorate([
    Post("bulk-reject"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "bulkReject", null);
__decorate([
    Post("bulk-schedule"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "bulkSchedule", null);
__decorate([
    Post("bulk-publish"),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "bulkPublish", null);
__decorate([
    Post(":id/retry-failed"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "retryFailed", null);
__decorate([
    Get(":id"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "getBatch", null);
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BatchController.prototype, "listBatches", null);
BatchController = __decorate([
    Controller("batch")
], BatchController);
export { BatchController };
