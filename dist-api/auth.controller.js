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
import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, ConflictException, } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { hash, hashPassword, verifyPassword, Public, } from "./security.js";
const credentials = z.object({
    email: z
        .string()
        .email()
        .max(254)
        .transform((v) => v.toLowerCase().trim()),
    password: z.string().min(12).max(128),
    name: z.string().trim().min(1).max(100).optional(),
});
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1",
    maxAge: 7 * 86400000,
};
let AuthController = class AuthController {
    async session(user, res) {
        const token = randomBytes(32).toString("base64url");
        await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [hash(token), user.id, new Date(Date.now() + 7 * 86400000)]);
        res.cookie("contentos_session", token, cookieOptions);
        const m = await pool.query("SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1", [user.id]);
        return {
            user: { name: user.name, email: user.email },
            workspaceId: m.rows[0]?.workspace_id || null,
        };
    }
    async signup(input, res) {
        const c = credentials
            .extend({ name: z.string().trim().min(1).max(100) })
            .parse(input);
        const user = { id: randomUUID(), name: c.name, email: c.email };
        try {
            const password = await hashPassword(c.password);
            await transaction(async (db) => {
                await db.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)", [user.id, c.email, c.name, password]);
            });
        }
        catch (e) {
            if (e.code === "23505")
                throw new ConflictException("An account with this email already exists.");
            throw e;
        }
        return this.session(user, res);
    }
    async login(input, res) {
        const c = credentials.parse(input);
        const r = await pool.query("SELECT * FROM users WHERE email=$1", [c.email]);
        const user = r.rows[0];
        const valid = await verifyPassword(c.password, user?.password_hash ||
            `scrypt:00000000000000000000000000000000:${"00".repeat(64)}`);
        if (!user || !valid)
            throw new UnauthorizedException("Email or password is incorrect.");
        if (user.account_status !== 'ACTIVE')
            throw new UnauthorizedException('This account is inactive. Contact support.');
        return this.session(user, res);
    }
    async me(req) {
        const m = await pool.query("SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1", [req.user.id]);
        return {
            user: { name: req.user.name, email: req.user.email },
            workspaceId: m.rows[0]?.workspace_id || null,
        };
    }
    async logout(req, res) {
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
            req.sessionHash,
        ]);
        res.clearCookie("contentos_session", {
            ...cookieOptions,
            maxAge: undefined,
        });
        return { loggedOut: true };
    }
};
__decorate([
    Public(),
    Post("signup"),
    __param(0, Body()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "signup", null);
__decorate([
    Public(),
    Post("login"),
    __param(0, Body()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    Get("me"),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    Post("logout"),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
AuthController = __decorate([
    Controller("auth")
], AuthController);
export { AuthController };
