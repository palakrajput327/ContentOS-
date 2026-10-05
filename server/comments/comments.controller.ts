import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { WorkspaceRequired, type AuthedRequest } from "../security.js";
import { pool } from "../db.js";
import { CommentsService } from "./comments.service.js";

@WorkspaceRequired()
@Controller("content")
export class CommentsController {
  /**
   * GET /api/v1/content/:id/comments
   * Returns threaded comments for a content item.
   */
  @Get(":id/comments")
  async listComments(@Req() req: AuthedRequest, @Param("id") id: string) {
    const ws = req.workspace!;
    const comments = await CommentsService.listComments(pool, ws.id, id);
    return { comments };
  }

  /**
   * POST /api/v1/content/:id/comments
   * Adds a new comment or threaded reply.
   */
  @Post(":id/comments")
  async createComment(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: { comment: string; parentId?: string; mentions?: string[] }
  ) {
    const ws = req.workspace!;
    const user = req.user!;
    try {
      const comment = await CommentsService.createComment(
        pool,
        ws.id,
        id,
        user.id,
        {
          comment: body.comment,
          parentId: body.parentId,
          mentions: body.mentions,
        }
      );
      return { comment };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /**
   * PATCH /api/v1/content/:id/comments/:commentId/resolve
   * Toggles resolved status of comment thread.
   */
  @Patch(":id/comments/:commentId/resolve")
  async resolveComment(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() body: { resolved: boolean }
  ) {
    const ws = req.workspace!;
    const user = req.user!;
    const isResolved = typeof body.resolved === "boolean" ? body.resolved : true;
    const success = await CommentsService.resolveComment(
      pool,
      ws.id,
      id,
      commentId,
      user.id,
      isResolved
    );
    if (!success) {
      throw new NotFoundException("Comment not found in this thread.");
    }
    return { success: true, resolved: isResolved };
  }

  /**
   * POST /api/v1/content/:id/assign
   * Assigns content item to a workspace member (or unassigns if assignedTo is null).
   */
  @Post(":id/assign")
  async assignContent(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: { assignedTo: string | null }
  ) {
    const ws = req.workspace!;
    const user = req.user!;
    try {
      const result = await CommentsService.assignContent(
        pool,
        ws.id,
        id,
        user.id,
        body.assignedTo ?? null
      );
      return { success: true, ...result };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /**
   * GET /api/v1/content/:id/timeline
   * Retrieves unified audit and comment activity timeline for content.
   */
  @Get(":id/timeline")
  async getTimeline(@Req() req: AuthedRequest, @Param("id") id: string) {
    const ws = req.workspace!;
    const timeline = await CommentsService.getContentTimeline(pool, ws.id, id);
    return { timeline };
  }
}
