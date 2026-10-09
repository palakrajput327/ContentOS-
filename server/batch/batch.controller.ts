import { Controller, Post, Get, Param, Body, Req, BadRequestException } from "@nestjs/common";
import { assertPermission, type AuthedRequest } from "../security.js";
import { BatchService } from "./batch.service.js";

@Controller("batch")
export class BatchController {
  @Post("ai-generation")
  async createBatchAIGeneration(
    @Req() req: AuthedRequest,
    @Body() body: { items: Array<{ topic: string; tone?: string; goal?: string; platforms?: string[] }> }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "edit");

    if (!body.items || !Array.isArray(body.items) || !body.items.length) {
      throw new BadRequestException("items array is required with at least 1 generation topic.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "ai_generation",
      items: body.items.map((item, idx) => ({
        operationType: "ai_generation",
        payload: {...item,userId:req.user!.id},
        idempotencyKey: `ai-gen-${ws.id}-${Date.now()}-${idx}`,
      })),
    });
  }

  @Post("bulk-save")
  async createBulkSave(
    @Req() req: AuthedRequest,
    @Body() body: { items: Array<{ title: string; body: string; platforms: string[]; variants?: Record<string, any> }> }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "edit");

    if (!body.items || !Array.isArray(body.items) || !body.items.length) {
      throw new BadRequestException("items array is required with posts to save.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "bulk_save",
      items: body.items.map((item, idx) => ({
        operationType: "bulk_save",
        payload: { ...item, userId: req.user!.id },
        idempotencyKey: `bulk-save-${ws.id}-${Date.now()}-${idx}`,
      })),
    });
  }

  @Post("bulk-approve")
  async bulkApprove(
    @Req() req: AuthedRequest,
    @Body() body: { contentIds: string[] }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "approve");

    if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
      throw new BadRequestException("contentIds array is required.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "bulk_approve",
      items: body.contentIds.map((id) => ({
        operationType: "bulk_approve",
        targetId: id,
        payload: { contentId: id, userId: req.user!.id },
        idempotencyKey: `bulk-approve-${ws.id}-${id}`,
      })),
    });
  }

  @Post("bulk-reject")
  async bulkReject(
    @Req() req: AuthedRequest,
    @Body() body: { contentIds: string[] }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "approve");

    if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
      throw new BadRequestException("contentIds array is required.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "bulk_reject",
      items: body.contentIds.map((id) => ({
        operationType: "bulk_reject",
        targetId: id,
        payload: { contentId: id, userId: req.user!.id },
        idempotencyKey: `bulk-reject-${ws.id}-${id}`,
      })),
    });
  }

  @Post("bulk-schedule")
  async bulkSchedule(
    @Req() req: AuthedRequest,
    @Body() body: { contentIds: string[]; scheduledAt: string; timezone?: string }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "schedule");

    if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
      throw new BadRequestException("contentIds array is required.");
    }
    if (!body.scheduledAt) {
      throw new BadRequestException("scheduledAt ISO timestamp is required.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "bulk_schedule",
      items: body.contentIds.map((id) => ({
        operationType: "bulk_schedule",
        targetId: id,
        payload: {
          contentId: id,
          scheduledAt: body.scheduledAt,
          timezone: body.timezone || "UTC",
          userId: req.user!.id,
        },
        idempotencyKey: `bulk-sched-${ws.id}-${id}-${body.scheduledAt}`,
      })),
    });
  }

  @Post("bulk-publish")
  async bulkPublish(
    @Req() req: AuthedRequest,
    @Body() body: { contentIds: string[] }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "schedule");

    if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
      throw new BadRequestException("contentIds array is required.");
    }

    return BatchService.createBatch({
      workspaceId: ws.id,
      userId: req.user!.id,
      role: ws.role,
      type: "bulk_publish",
      items: body.contentIds.map((id) => ({
        operationType: "bulk_publish",
        targetId: id,
        payload: { contentId: id, userId: req.user!.id },
        idempotencyKey: `bulk-pub-${ws.id}-${id}`,
      })),
    });
  }

  @Post(":id/retry-failed")
  async retryFailed(
    @Req() req: AuthedRequest,
    @Param("id") batchId: string
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "edit");
    return BatchService.retryFailedChildren(ws.id, batchId, req.user!.id);
  }

  @Get(":id")
  async getBatch(
    @Req() req: AuthedRequest,
    @Param("id") batchId: string
  ) {
    const ws = req.workspace!;
    return BatchService.getBatchStatus(ws.id, batchId);
  }

  @Get()
  async listBatches(@Req() req: AuthedRequest) {
    const ws = req.workspace!;
    return BatchService.listBatches(ws.id);
  }
}
