import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  ConflictException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { pool, transaction, type DB } from "./db.js";
import {
  hash,
  hashPassword,
  verifyPassword,
  Public,
  type AuthedRequest,
} from "./security.js";
import { authEvent, queueTokenEmail } from "./mail.js";
import { consumeCode, requireMail } from "./codes.js";
import { workspaceForUser } from "./workspace-session.js";
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12, "Use at least 12 characters").max(128);
const registration = z
  .object({
    name: z.string().trim().min(1).max(100),
    email,
    password,
    passwordConfirmation: z.string().optional(),
    termsAccepted: z.boolean().optional(),
  })
  .passthrough();
const pair = z
  .object({ password, passwordConfirmation: z.string() })
  .refine((v) => v.password === v.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match",
  });
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.APP_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v1",
});
const accepted = {
  message:
    "If this address is eligible, a code has been queued. Delivery may take a few minutes; check spam too. You can request another code after 60 seconds.",
};
async function newSession(
  db: DB,
  userId: string,
  familyId = randomUUID(),
  absolute = new Date(Date.now() + 30 * 86400000),
) {
  const access = randomBytes(32).toString("base64url"),
    refresh = randomBytes(48).toString("base64url");
  const accessExpires = new Date(
    Math.min(Date.now() + 15 * 60000, absolute.getTime()),
  );
  const refreshExpires = new Date(
    Math.min(Date.now() + 7 * 86400000, absolute.getTime()),
  );
  await db.query(
    "INSERT INTO auth_sessions(id,user_id,family_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      userId,
      familyId,
      hash(access),
      hash(refresh),
      accessExpires,
      refreshExpires,
      absolute,
    ],
  );
  return { access, refresh, accessExpires, refreshExpires };
}
function setCookies(res: Response, s: Awaited<ReturnType<typeof newSession>>) {
  res.cookie("contentos_session", s.access, {
    ...cookieOptions(),
    expires: s.accessExpires,
  });
  res.cookie("contentos_refresh", s.refresh, {
    ...cookieOptions(),
    expires: s.refreshExpires,
  });
}
function clearCookies(res: Response) {
  res.clearCookie("contentos_session", cookieOptions());
  res.clearCookie("contentos_refresh", cookieOptions());
}
@Controller("auth")
export class PhaseAuthController {
  @Public() @Post(["register", "signup"]) async register(
    @Body() input: unknown,
    @Req() req: AuthedRequest,
  ) {
    const v = registration.parse(input);
    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [v.email],
    );
    if (existing.rowCount) {
      throw new ConflictException(
        "An account with this email already exists. Please log in instead.",
      );
    }
    requireMail();
    const passwordHash = await hashPassword(v.password);
    await transaction(async (db) => {
      const id = randomUUID();
      const inserted = await db.query(
        "INSERT INTO users(id,email,name,password_hash,terms_accepted_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(email) DO NOTHING RETURNING id,email",
        [id, v.email, v.name, passwordHash],
      );
      if (inserted.rowCount) {
        await queueTokenEmail(db, inserted.rows[0], "verify");
        await authEvent(db, id, "USER_REGISTERED", req.requestId);
      }
    });
    return accepted;
  }
  @Public() @Post("email/verify") async verify(
    @Body() input: unknown,
    @Req() req: AuthedRequest,
    @Res({passthrough:true}) res: Response,
  ) {
    const v = z
      .object({ email, code: z.string().regex(/^\d{6}$/) })
      .parse(input);
    const ok = await transaction(async (db) => {
      const id = await consumeCode(db, v.email, v.code, "verify");
      if (!id) return false;
      await db.query(
        "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1",
        [id],
      );
      await authEvent(db, id, "EMAIL_VERIFIED", req.requestId);
      await authEvent(db,id,"USER_LOGIN",req.requestId);
      return {id,session:await newSession(db,id)};
    });
    if (!ok)
      throw new BadRequestException(
        "Incorrect, expired, or used code. After five incorrect attempts, request a new code.",
      );
    setCookies(res,ok.session);
    const user=(await pool.query("SELECT id,name,email FROM users WHERE id=$1",[ok.id])).rows[0];
    return {user:{...user,emailVerified:true},workspaceId:await workspaceForUser(ok.id)};
  }
  @Public() @Post("email/resend") async resend(
    @Body() input: unknown,
    @Req() req: AuthedRequest,
  ) {
    return this.issueEmail(input, req, "verify");
  }
  @Public() @Post("forgot-password") async forgot(
    @Body() input: unknown,
    @Req() req: AuthedRequest,
  ) {
    return this.issueEmail(input, req, "reset");
  }
  private async issueEmail(
    input: unknown,
    req: AuthedRequest,
    purpose: "verify" | "reset",
  ) {
    const v = z.object({ email }).parse(input);
    requireMail();
    await transaction(async (db) => {
      const user = (
        await db.query(
          "SELECT id,email,email_verified_at FROM users WHERE email=$1 FOR UPDATE",
          [v.email],
        )
      ).rows[0];
      if (
        !user ||
        (purpose === "verify" && user.email_verified_at) ||
        (purpose === "reset" && !user.email_verified_at)
      )
        return;
      const recent = await db.query(
        "SELECT 1 FROM auth_tokens WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '1 minute'",
        [user.id, purpose],
      );
      if (recent.rowCount) return;
      await queueTokenEmail(db, user, purpose);
      await authEvent(
        db,
        user.id,
        purpose === "verify"
          ? "VERIFICATION_REQUESTED"
          : "PASSWORD_RESET_REQUESTED",
        req.requestId,
      );
    });
    return accepted;
  }
  @Public() @Post("reset-password") async reset(
    @Body() input: unknown,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = z
      .object({
        email,
        code: z.string().regex(/^\d{6}$/),
        password,
        passwordConfirmation: z.string(),
      })
      .parse(input);
    pair.parse(raw);
    const encoded = await hashPassword(raw.password);
    const ok = await transaction(async (db) => {
      const userId = await consumeCode(db, raw.email, raw.code, "reset");
      if (!userId) return false;
      const t = { user_id: userId };
      await db.query(
        "UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1",
        [t.user_id, encoded],
      );
      await db.query(
        "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose IN ('reset','login') AND used_at IS NULL",
        [t.user_id],
      );
      await db.query(
        "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        [t.user_id],
      );
      await authEvent(db, t.user_id, "PASSWORD_RESET", req.requestId);
      return true;
    });
    if (!ok)
      throw new BadRequestException(
        "Incorrect, expired, or used code. Request a new code after five incorrect attempts.",
      );
    clearCookies(res);
    return { message: "Password updated. Log in with your new password." };
  }
  @Public() @Post("login") async login(@Body() input:unknown,@Req() req:AuthedRequest,@Res({passthrough:true}) res:Response){
    const c=z.object({email,password:z.string().min(1).max(128)}).parse(input);
    const requireOtp = process.env.REQUIRE_LOGIN_OTP === "true";
    if (requireOtp) {
      const challenge=randomBytes(32).toString('base64url');
      await transaction(async db=>{
        const user=(await db.query('SELECT * FROM users WHERE email=$1 FOR UPDATE',[c.email])).rows[0];
        const valid=await verifyPassword(c.password,user?.password_hash||`scrypt:00000000000000000000000000000000:${'00'.repeat(64)}`);
        if(!user||!valid)throw new UnauthorizedException('Email or password is incorrect.');
        requireMail();
        const recent=await db.query("SELECT 1 FROM auth_tokens WHERE user_id=$1 AND purpose='login' AND used_at IS NULL AND created_at>now()-interval '1 minute'",[user.id]);
        if(recent.rowCount)throw new HttpException('A sign-in code was recently requested. Use it or wait 60 seconds before trying again.',429);
        await queueTokenEmail(db,user,'login',hash(challenge));
        await authEvent(db,user.id,'LOGIN_CODE_REQUESTED',req.requestId);
      });
      res.cookie('contentos_login_challenge',challenge,{...cookieOptions(),maxAge:10*60000});
      return {requiresCode:true,email:c.email,message:'Your sign-in code is queued. Enter it here to open your dashboard.'};
    }

    const result = await transaction(async db => {
      const user = (await db.query('SELECT * FROM users WHERE email=$1 FOR UPDATE', [c.email])).rows[0];
      if (!user) throw new UnauthorizedException('No account found with this email address. Please sign up first.');
      const valid = await verifyPassword(c.password, user.password_hash);
      if (!valid) throw new UnauthorizedException('Email or password is incorrect.');
      return { user, session: await newSession(db, user.id) };
    });

    setCookies(res, result.session);
    await authEvent(pool, result.user.id, 'USER_LOGIN', req.requestId);
    const wid = await workspaceForUser(result.user.id);
    return {
      requiresCode: false,
      user: { id: result.user.id, name: result.user.name, email: result.user.email, emailVerified: true },
      workspaceId: wid,
      message: 'Logged in successfully',
    };
  }
  @Public() @Post('login/resend') async resendLogin(@Body()input:unknown,@Req()req:AuthedRequest,@Res({passthrough:true})res:Response){
    const v=z.object({email}).parse(input);requireMail();
    const challenge=req.cookies?.contentos_login_challenge;
    if(typeof challenge!=='string'||!challenge)throw new UnauthorizedException('Start again from login to request a code.');
    await transaction(async db=>{
      const user=(await db.query('SELECT id,email FROM users WHERE email=$1 FOR UPDATE',[v.email])).rows[0];
      const token=user&&(await db.query("SELECT * FROM auth_tokens WHERE user_id=$1 AND purpose='login' AND challenge_hash=$2 AND used_at IS NULL AND expires_at>now() FOR UPDATE",[user.id,hash(challenge)])).rows[0];
      if(!token)throw new UnauthorizedException('Your sign-in request expired. Start again from login.');
      if(new Date(token.created_at).getTime()>Date.now()-60000)throw new HttpException('Please wait 60 seconds before requesting another code.',429);
      await queueTokenEmail(db,user,'login',hash(challenge));
    });
    res.cookie('contentos_login_challenge',challenge,{...cookieOptions(),maxAge:10*60000});
    return accepted;
  }
  @Public() @Post('login/verify') async verifyLogin(@Body()input:unknown,@Req()req:AuthedRequest,@Res({passthrough:true})res:Response){
    const v=z.object({email,code:z.string().regex(/^\d{6}$/)}).parse(input);
    const challenge=req.cookies?.contentos_login_challenge;
    if(typeof challenge!=='string'||!challenge)throw new UnauthorizedException('Start again from login to request a code.');
    const result=await transaction(async db=>{
      const user=(await db.query('SELECT id,name,email FROM users WHERE email=$1 AND email_verified_at IS NOT NULL FOR UPDATE',[v.email])).rows[0];
      if(!user)return null;
      const bound=await db.query("SELECT 1 FROM auth_tokens WHERE user_id=$1 AND purpose='login' AND challenge_hash=$2 AND used_at IS NULL AND expires_at>now()",[user.id,hash(challenge)]);
      if(!bound.rowCount)return null;
      const id=await consumeCode(db,v.email,v.code,'login');if(!id)return null;
      await authEvent(db,id,'USER_LOGIN',req.requestId);
      return {user,session:await newSession(db,id)};
    });
    if(!result)throw new BadRequestException('Incorrect, expired, or used code. After five wrong attempts, request a new code.');
    res.clearCookie('contentos_login_challenge',cookieOptions());setCookies(res,result.session);
    return {user:{...result.user,emailVerified:true},workspaceId:await workspaceForUser(result.user.id)};
  }
  @Get("me") async me(@Req() req: AuthedRequest) {
    return {
      user: { ...req.user, emailVerified: true },
      workspaceId: await workspaceForUser(req.user.id),
      phase: "workspace",
    };
  }
  @Public() @Post("refresh") async refresh(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.contentos_refresh;
    if (typeof raw !== "string") {
      clearCookies(res);
      throw new UnauthorizedException("Please log in again.");
    }
    const result = await transaction(async (db) => {
      const owner = (
        await db.query(
          "SELECT user_id FROM auth_sessions WHERE refresh_hash=$1",
          [hash(raw)],
        )
      ).rows[0];
      if (owner)
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          owner.user_id,
        ]);
      const s = (
        await db.query(
          "SELECT * FROM auth_sessions WHERE refresh_hash=$1 FOR UPDATE",
          [hash(raw)],
        )
      ).rows[0];
      if (!s) return null;
      if (s.rotated_at) {
        await db.query(
          "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1",
          [s.family_id],
        );
        await authEvent(db, s.user_id, "REFRESH_REPLAY_BLOCKED", req.requestId);
        return null;
      }
      if (
        s.revoked_at ||
        new Date(s.refresh_expires_at).getTime() <= Date.now() ||
        new Date(s.absolute_expires_at).getTime() <= Date.now()
      )
        return null;
      await db.query(
        "UPDATE auth_sessions SET revoked_at=now(),rotated_at=now() WHERE id=$1",
        [s.id],
      );
      return newSession(
        db,
        s.user_id,
        s.family_id,
        new Date(s.absolute_expires_at),
      );
    });
    if (!result) {
      clearCookies(res);
      throw new UnauthorizedException(
        "Your session expired. Please log in again.",
      );
    }
    setCookies(res, result);
    return { refreshed: true };
  }
  @Public() @Post("logout") async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const access =
      typeof req.cookies?.contentos_session === "string"
        ? hash(req.cookies.contentos_session)
        : "";
    const refresh =
      typeof req.cookies?.contentos_refresh === "string"
        ? hash(req.cookies.contentos_refresh)
        : "";
    await transaction(async (db) => {
      const sessions = await db.query(
        "SELECT user_id,family_id FROM auth_sessions WHERE access_hash=$1 OR refresh_hash=$2",
        [access, refresh],
      );
      for (const s of sessions.rows) {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          s.user_id,
        ]);
        await db.query(
          "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1",
          [s.family_id],
        );
        await authEvent(db, s.user_id, "USER_LOGOUT", req.requestId);
      }
    });
    clearCookies(res);
    return { loggedOut: true };
  }
}
