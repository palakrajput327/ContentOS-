import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import type { DB } from "./db.js";
export function codeHash(
  userId: string,
  purpose: string,
  code: string,
  tokenId: string,
) {
  return createHmac("sha256", process.env.ENCRYPTION_KEY!)
    .update(`${tokenId}:${userId}:${purpose}:${code}`)
    .digest("hex");
}
export function requireMail() {
  if (!process.env.MAIL_USERNAME || !process.env.MAIL_PASSWORD)
    throw new ServiceUnavailableException(
      "Email service setup is incomplete. Please contact the administrator and try again later.",
    );
}
export async function consumeCode(
  db: DB,
  email: string,
  code: string,
  purpose: string,
) {
  const user = (
    await db.query("SELECT id FROM users WHERE email=$1 FOR UPDATE", [email])
  ).rows[0];
  if (!user) return null;
  const token = (
    await db.query(
      "SELECT * FROM auth_tokens WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [user.id, purpose],
    )
  ).rows[0];
  if (
    !token ||
    token.attempts >= 5 ||
    new Date(token.expires_at).getTime() <= Date.now()
  )
    return null;
  const expected = Buffer.from(token.token_hash, "hex");
  const actual = Buffer.from(codeHash(user.id, purpose, code, token.id), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await db.query("UPDATE auth_tokens SET attempts=attempts+1 WHERE id=$1", [
      token.id,
    ]);
    return null;
  }
  await db.query("UPDATE auth_tokens SET used_at=now() WHERE id=$1", [
    token.id,
  ]);
  return user.id as string;
}
