import { randomUUID } from "node:crypto";
import { pool, transaction, audit, type DB } from "../db.js";
import { BadRequestException, NotFoundException, ForbiddenException } from "@nestjs/common";
import { assertPermission } from "../security.js";
import { createQueue } from '../queues.js';
import { queueBackend } from '../queue-backend.js';
import { createPublishPlan } from "../publish-planner.js";
import type { Platform } from "../platform-capabilities.js";
import { generateCaptions } from "../ai.controller.js";

export const batchQueue = createQueue("batch-processing", {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export interface CreateBatchInput {
  workspaceId: string;
  userId: string;
  role: string;
  type: "ai_generation" | "bulk_save" | "bulk_approve" | "bulk_reject" | "bulk_schedule" | "bulk_publish" | "bulk_retry";
  items: Array<{
    operationType: string;
    targetId?: string;
    payload?: Record<string, any>;
    idempotencyKey?: string;
  }>;
}

export class BatchService {
  static async createBatch(input: CreateBatchInput) {
    if (!input.items || !input.items.length) {
      throw new BadRequestException("Batch must contain at least one item.");
    }
    if (input.items.length > 100) {
      throw new BadRequestException("Batch cannot exceed 100 items per request.");
    }

    const batchId = randomUUID();

    return transaction(async (db) => {
      // 1. Create parent batch_jobs row
      const batch = (
        await db.query(
          `INSERT INTO batch_jobs(id, workspace_id, type, status, total_items, completed_items, failed_items, created_by)
           VALUES($1, $2, $3, 'PENDING', $4, 0, 0, $5)
           RETURNING *`,
          [batchId, input.workspaceId, input.type, input.items.length, input.userId]
        )
      ).rows[0];

      // 2. Create batch_child_items rows
      const childItems = [];
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const childId = randomUUID();
        const idempotencyKey = item.idempotencyKey || `${batchId}-${i}-${item.targetId || "op"}`;
        
        const childRow = (
          await db.query(
            `INSERT INTO batch_child_items(id, batch_id, workspace_id, operation_type, target_id, payload, status, idempotency_key${queueBackend()==='postgres'?', item_index':''})
             VALUES($1, $2, $3, $4, $5, $6, 'PENDING', $7${queueBackend()==='postgres'?', $8':''})
             RETURNING *`,
            [
              childId,
              batchId,
              input.workspaceId,
              item.operationType || input.type,
              item.targetId || null,
              JSON.stringify(item.payload || {}),
              idempotencyKey,
              ...(queueBackend()==='postgres'?[i]:[]),
            ]
          )
        ).rows[0];
        childItems.push(childRow);
      }

      await audit(
        db,
        input.workspaceId,
        input.userId,
        "batch_created",
        "batch_job",
        batchId,
        `Batch ${input.type} (${input.items.length} items)`,
        null,
        { totalItems: input.items.length, type: input.type }
      );

      // 3. Queue batch execution in BullMQ
      await batchQueue.add("process-batch", { batchId, workspaceId: input.workspaceId }, {jobId:batchId}, db);

      return {
        batchId: batch.id,
        workspaceId: batch.workspace_id,
        type: batch.type,
        status: batch.status,
        totalItems: Number(batch.total_items),
        completedItems: Number(batch.completed_items),
        failedItems: Number(batch.failed_items),
        createdAt: batch.created_at,
        items: childItems,
      };
    });
  }

  static async getBatchStatus(workspaceId: string, batchId: string) {
    const batch = (
      await pool.query(
        "SELECT * FROM batch_jobs WHERE id = $1 AND workspace_id = $2",
        [batchId, workspaceId]
      )
    ).rows[0];

    if (!batch) {
      throw new NotFoundException("Batch job not found in active workspace.");
    }

    const items = (
      await pool.query(
        "SELECT * FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2 ORDER BY created_at ASC",
        [batchId, workspaceId]
      )
    ).rows;

    const total = Number(batch.total_items);
    const completed = Number(batch.completed_items);
    const failed = Number(batch.failed_items);
    const pending = items.filter((i) => i.status === "PENDING").length;
    const processing = items.filter((i) => i.status === "PROCESSING").length;
    const progressPct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

    return {
      id: batch.id,
      workspaceId: batch.workspace_id,
      type: batch.type,
      status: batch.status,
      metrics: {
        total,
        pending,
        processing,
        completed,
        failed,
        progressPct,
      },
      createdAt: batch.created_at,
      startedAt: batch.started_at,
      completedAt: batch.completed_at,
      items: items.map((i) => ({
        id: i.id,
        operationType: i.operation_type,
        targetId: i.target_id,
        status: i.status,
        payload: i.payload,
        result: i.result,
        error: i.error,
        retryCount: i.retry_count,
        idempotencyKey: i.idempotency_key,
        updatedAt: i.updated_at,
      })),
    };
  }

  static async listBatches(workspaceId: string, limit = 20) {
    const rows = (
      await pool.query(
        "SELECT * FROM batch_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2",
        [workspaceId, limit]
      )
    ).rows;

    return rows.map((b) => ({
      id: b.id,
      type: b.type,
      status: b.status,
      totalItems: Number(b.total_items),
      completedItems: Number(b.completed_items),
      failedItems: Number(b.failed_items),
      createdAt: b.created_at,
    }));
  }

  static async retryFailedChildren(workspaceId: string, batchId: string, userId: string) {
    return transaction(async (db) => {
      const batch = (
        await db.query(
          "SELECT * FROM batch_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [batchId, workspaceId]
        )
      ).rows[0];

      if (!batch) throw new NotFoundException("Batch job not found.");

      const failedItems = (
        await db.query(
          "SELECT * FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2 AND status = 'FAILED' FOR UPDATE",
          [batchId, workspaceId]
        )
      ).rows;

      if (!failedItems.length) {
        throw new BadRequestException("No failed child items found to retry in this batch.");
      }

      // Reset status of failed child items to PENDING and increment retry_count
      for (const item of failedItems) {
        await db.query(
          `UPDATE batch_child_items 
           SET status = 'PENDING', error = NULL, retry_count = retry_count + 1, updated_at = NOW() 
           WHERE id = $1`,
          [item.id]
        );
      }

      // Update parent batch status to PROCESSING
      await db.query(
        `UPDATE batch_jobs 
         SET status = 'PROCESSING', failed_items = failed_items - $1, updated_at = NOW() 
         WHERE id = $2`,
        [failedItems.length, batchId]
      );

      await audit(
        db,
        workspaceId,
        userId,
        "batch_retried",
        "batch_job",
        batchId,
        `Retried ${failedItems.length} failed items in batch ${batchId}`
      );

      // Queue batch re-processing
      await batchQueue.add("process-batch", { batchId, workspaceId }, {jobId:`${batchId}-retry-${Date.now()}`}, db);

      return {
        batchId,
        retriedCount: failedItems.length,
        status: "PROCESSING",
      };
    });
  }
}
