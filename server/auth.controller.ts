import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import {
  hash,
  hashPassword,
  verifyPassword,
  Public,
  type AuthedRequest,
} from "./security.js";
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
  sameSite: "lax" as const,
  path: "/api/v1",
  maxAge: 7 * 86400000,
};
@Controller("auth")
export class AuthController {
  private async session(
    user: { id: string; name: string; email: string },
    res: Response,
  ) {
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [hash(token), user.id, new Date(Date.now() + 7 * 86400000)],
    );
    res.cookie("contentos_session", token, cookieOptions);
    const m = await pool.query(
      "SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1",
      [user.id],
    );
    return {
      user: { name: user.name, email: user.email },
      workspaceId: m.rows[0]?.workspace_id || null,
    };
  }
  @Public() @Post("signup") async signup(
    @Body() input: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = credentials
      .extend({ name: z.string().trim().min(1).max(100) })
      .parse(input);
    const user = { id: randomUUID(), name: c.name, email: c.email };
    try {
      const password = await hashPassword(c.password);
      await transaction(async (db) => {
        await db.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
          [user.id, c.email, c.name, password],
        );
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new ConflictException(
          "An account with this email already exists.",
        );
      throw e;
    }
    return this.session(user, res);
  }
  @Public() @Post("login") async login(
    @Body() input: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = credentials.parse(input);
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [c.email]);
    const user = r.rows[0];
    const valid = await verifyPassword(
      c.password,
      user?.password_hash ||
        `scrypt:00000000000000000000000000000000:${"00".repeat(64)}`,
    );
    if (!user || !valid)
      throw new UnauthorizedException("Email or password is incorrect.");
    if(user.account_status!=='ACTIVE')throw new UnauthorizedException('This account is inactive. Contact support.');
    return this.session(user, res);
  }
  @Get("me") async me(@Req() req: AuthedRequest) {
    const m = await pool.query(
      "SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1",
      [req.user.id],
    );
    return {
      user: { name: req.user.name, email: req.user.email },
      workspaceId: m.rows[0]?.workspace_id || null,
    };
  }
  @Post("logout") async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.sessionHash,
    ]);
    res.clearCookie("contentos_session", {
      ...cookieOptions,
      maxAge: undefined,
    });
    return { loggedOut: true };
  }
}
