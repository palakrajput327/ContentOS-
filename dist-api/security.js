var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, } from "node:crypto";
import { promisify } from "node:util";
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException, SetMetadata, } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { pool } from "./db.js";
const scrypt = promisify(scryptCallback);
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(password, salt, 64));
    return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
    const [, salt, key] = encoded.split(":");
    if (!salt || !key)
        return false;
    const actual = (await scrypt(password, salt, 64));
    const expected = Buffer.from(key, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function encryptionKey() {
    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "hex");
    if (key.length !== 32)
        throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters.");
    return key;
}
export function encryptToken(value, aad) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), body]
        .map((x) => x.toString("base64"))
        .join(".");
}
export function decryptToken(value, aad) {
    const [iv, tag, body] = value.split(".").map((x) => Buffer.from(x, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
export const roles = [
    "Owner",
    "Admin",
    "Content Manager",
    "Editor",
    "Approver",
    "Viewer",
];
export const permissions = {
    manage: ["Owner", "Admin"],
    edit: ["Owner", "Admin", "Content Manager", "Editor"],
    approve: ["Owner", "Admin", "Approver"],
    schedule: ["Owner", "Admin", "Content Manager"],
};
export function assertPermission(role, permission) {
    if (!permissions[permission].includes(role))
        throw new ForbiddenException("Your workspace role does not allow this action.");
}
export const Public = () => SetMetadata("public", true);
export const WorkspaceRequired = () => SetMetadata("workspace", true);
let AuthGuard = class AuthGuard {
    reflector;
    constructor(reflector) {
        this.reflector = reflector;
    }
    async canActivate(ctx) {
        if (this.reflector.getAllAndOverride("public", [
            ctx.getHandler(),
            ctx.getClass(),
        ]))
            return true;
        const req = ctx.switchToHttp().getRequest();
        const token = req.cookies?.contentos_session;
        if (typeof token !== "string")
            throw new UnauthorizedException("Please log in to continue.");
        req.sessionHash = hash(token);
        const r = await pool.query("SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.account_status='ACTIVE'", [req.sessionHash]);
        if (!r.rowCount)
            throw new UnauthorizedException("Your session expired. Please log in again.");
        req.user = r.rows[0];
        if (this.reflector.getAllAndOverride("workspace", [
            ctx.getHandler(),
            ctx.getClass(),
        ])) {
            const wid = req.header("X-Workspace-Id");
            if (!wid || !/^[a-f0-9-]{36}$/i.test(wid))
                throw new BadRequestException("Select a workspace.");
            const membership = await pool.query("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [wid, req.user.id]);
            if (!membership.rowCount)
                throw new ForbiddenException("Workspace access denied.");
            req.workspace = { id: wid, role: membership.rows[0].role };
        }
        return true;
    }
};
AuthGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector])
], AuthGuard);
export { AuthGuard };
export function validateTimezone(timezone) {
    try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
    }
    catch {
        throw new BadRequestException("Use a valid IANA timezone.");
    }
}
