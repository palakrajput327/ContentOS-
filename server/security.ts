import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { pool } from "./db.js";
const scrypt = promisify(scryptCallback);
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [, salt, key] = encoded.split(":");
  if (!salt || !key) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function encryptionKey() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32)
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as 64 hex characters.",
    );
  return key;
}
export function encryptToken(value: string, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function decryptToken(value: string, aad: string) {
  const [iv, tag, body] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    "utf8",
  );
}
export const roles = [
  "Owner",
  "Admin",
  "Content Manager",
  "Editor",
  "Approver",
  "Viewer",
] as const;
export type Role = (typeof roles)[number];
export const permissions = {
  manage: ["Owner", "Admin"],
  edit: ["Owner", "Admin", "Content Manager", "Editor"],
  approve: ["Owner", "Admin", "Approver"],
  schedule: ["Owner", "Admin", "Content Manager"],
} as const;
export function assertPermission(
  role: string,
  permission: keyof typeof permissions,
) {
  if (!(permissions[permission] as readonly string[]).includes(role))
    throw new ForbiddenException(
      "Your workspace role does not allow this action.",
    );
}
export const Public = () => SetMetadata("public", true);
export const WorkspaceRequired = () => SetMetadata("workspace", true);
export type AuthedRequest = Request & {
  user: { id: string; name: string; email: string };
  workspace: { id: string; role: Role };
  sessionHash: string;
  requestId: string;
};
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.contentos_session;
    if (typeof token !== "string")
      throw new UnauthorizedException("Please log in to continue.");
    req.sessionHash = hash(token);
    const r = await pool.query(
      "SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [req.sessionHash],
    );
    if (!r.rowCount)
      throw new UnauthorizedException(
        "Your session expired. Please log in again.",
      );
    req.user = r.rows[0];
    if (
      this.reflector.getAllAndOverride("workspace", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    ) {
      const wid = req.header("X-Workspace-Id");
      if (!wid || !/^[a-f0-9-]{36}$/i.test(wid))
        throw new BadRequestException("Select a workspace.");
      const membership = await pool.query(
        "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [wid, req.user.id],
      );
      if (!membership.rowCount)
        throw new ForbiddenException("Workspace access denied.");
      req.workspace = { id: wid, role: membership.rows[0].role };
    }
    return true;
  }
}
export function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new BadRequestException("Use a valid IANA timezone.");
  }
}
