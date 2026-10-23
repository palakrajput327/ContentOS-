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
import { Controller, Get, Post, Param, Req, NotFoundException, } from "@nestjs/common";
import { WorkspaceRequired } from "../security.js";
import { pool } from "../db.js";
import { NotificationsService } from "./notifications.service.js";
let NotificationsController = class NotificationsController {
    /**
     * GET /api/v1/notifications
     * Returns workspace notifications for active user.
     */
    async listNotifications(req) {
        const ws = req.workspace;
        const user = req.user;
        const notifications = await NotificationsService.listNotifications(pool, ws.id, user.id);
        const unreadCount = await NotificationsService.getUnreadCount(pool, ws.id, user.id);
        return { notifications, unreadCount };
    }
    /**
     * GET /api/v1/notifications/unread-count
     * Returns unread badge count.
     */
    async getUnreadCount(req) {
        const ws = req.workspace;
        const user = req.user;
        const count = await NotificationsService.getUnreadCount(pool, ws.id, user.id);
        return { unreadCount: count };
    }
    /**
     * POST /api/v1/notifications/:id/read
     * Marks a single notification as read.
     */
    async markRead(req, id) {
        const ws = req.workspace;
        const user = req.user;
        const success = await NotificationsService.markRead(pool, ws.id, user.id, id);
        if (!success) {
            throw new NotFoundException("Notification not found.");
        }
        return { success: true };
    }
    /**
     * POST /api/v1/notifications/read-all
     * Marks all workspace notifications as read.
     */
    async markAllRead(req) {
        const ws = req.workspace;
        const user = req.user;
        const count = await NotificationsService.markAllRead(pool, ws.id, user.id);
        return { markedCount: count, success: true };
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "listNotifications", null);
__decorate([
    Get("unread-count"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "getUnreadCount", null);
__decorate([
    Post(":id/read"),
    __param(0, Req()),
    __param(1, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "markRead", null);
__decorate([
    Post("read-all"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "markAllRead", null);
NotificationsController = __decorate([
    WorkspaceRequired(),
    Controller("notifications")
], NotificationsController);
export { NotificationsController };
