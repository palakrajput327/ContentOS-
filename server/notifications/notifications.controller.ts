import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  NotFoundException,
} from "@nestjs/common";
import { WorkspaceRequired, type AuthedRequest } from "../security.js";
import { pool } from "../db.js";
import { NotificationsService } from "./notifications.service.js";

@WorkspaceRequired()
@Controller("notifications")
export class NotificationsController {
  /**
   * GET /api/v1/notifications
   * Returns workspace notifications for active user.
   */
  @Get()
  async listNotifications(@Req() req: AuthedRequest) {
    const ws = req.workspace!;
    const user = req.user!;
    const notifications = await NotificationsService.listNotifications(
      pool,
      ws.id,
      user.id
    );
    const unreadCount = await NotificationsService.getUnreadCount(
      pool,
      ws.id,
      user.id
    );
    return { notifications, unreadCount };
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Returns unread badge count.
   */
  @Get("unread-count")
  async getUnreadCount(@Req() req: AuthedRequest) {
    const ws = req.workspace!;
    const user = req.user!;
    const count = await NotificationsService.getUnreadCount(
      pool,
      ws.id,
      user.id
    );
    return { unreadCount: count };
  }

  /**
   * POST /api/v1/notifications/:id/read
   * Marks a single notification as read.
   */
  @Post(":id/read")
  async markRead(@Req() req: AuthedRequest, @Param("id") id: string) {
    const ws = req.workspace!;
    const user = req.user!;
    const success = await NotificationsService.markRead(
      pool,
      ws.id,
      user.id,
      id
    );
    if (!success) {
      throw new NotFoundException("Notification not found.");
    }
    return { success: true };
  }

  /**
   * POST /api/v1/notifications/read-all
   * Marks all workspace notifications as read.
   */
  @Post("read-all")
  async markAllRead(@Req() req: AuthedRequest) {
    const ws = req.workspace!;
    const user = req.user!;
    const count = await NotificationsService.markAllRead(
      pool,
      ws.id,
      user.id
    );
    return { markedCount: count, success: true };
  }
}
