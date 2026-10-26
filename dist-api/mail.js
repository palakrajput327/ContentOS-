import { randomInt, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { encryptToken, decryptToken } from "./security.js";
import { pool, transaction } from "./db.js";
import { codeHash } from "./codes.js";
import { emailHtml } from './email-template.js';
export async function authEvent(db, userId, action, requestId) {
    await db.query("INSERT INTO auth_events(id,user_id,action,request_id) VALUES($1,$2,$3,$4)", [randomUUID(), userId, action, requestId || null]);
}
export async function queueTokenEmail(db, user, purpose, challengeHash = null) {
    const token = String(randomInt(0, 1000000)).padStart(6, "0"), id = randomUUID();
    const tokenId = randomUUID();
    const expires = new Date(Date.now() + 10 * 60000);
    await db.query("UPDATE email_outbox SET state='EXPIRED',encrypted_body=NULL WHERE recipient=$1 AND subject=$2 AND state='PENDING'", [
        user.email,
        purpose === "verify"
            ? "Verify your ContentOS email"
            : purpose === "login" ? "Your ContentOS sign-in code" : "Reset your ContentOS password",
    ]);
    await db.query("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL", [user.id, purpose]);
    await db.query("INSERT INTO auth_tokens(id,user_id,purpose,token_hash,expires_at,challenge_hash) VALUES($1,$2,$3,$4,$5,$6)", [
        tokenId,
        user.id,
        purpose,
        codeHash(user.id, purpose, token, tokenId),
        expires,
        challengeHash,
    ]);
    const body = `Your ContentOS ${purpose === "verify" ? "verification" : purpose === "login" ? "sign-in" : "password reset"} code is: ${token}\n\nEnter this code inside ContentOS. It expires in 10 minutes and can only be used once. If you did not request this, ignore this email.`;
    await db.query("INSERT INTO email_outbox(id,recipient,subject,encrypted_body,expires_at,is_test) VALUES($1,$2,$3,$4,$5,$6)", [
        id,
        user.email,
        purpose === "verify"
            ? "Verify your ContentOS email"
            : purpose === "login" ? "Your ContentOS sign-in code" : "Reset your ContentOS password",
        encryptToken(body, `mail:${id}`),
        expires,
        process.env.APP_ENV === 'test',
    ]);
}
export async function queuePublishNotificationEmail(db, input) {
    const id = randomUUID();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const isSuccess = input.status === "published";
    const layerName = input.layer || (isSuccess ? "Layer 5: Social Publishing & Channel Dispatch" : "Layer 5: Channel Publishing");
    const subject = isSuccess
        ? `✅ [ContentOS] Post Live on ${input.platform} (${layerName})`
        : `⚠️ [ContentOS Alert] Publishing Failed in ${layerName}`;
    const greeting = input.recipientName ? `Hi ${input.recipientName},` : `Hello,`;
    const body = isSuccess
        ? `${greeting}\n\nYour automated post "${input.postTitle}" has been successfully published to ${input.platform}.\n\nPipeline Stage: ${layerName} ✅\nPlatform: ${input.platform}\nPost ID: ${input.providerPostId || "N/A"}\nTime: ${new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} IST\n\nAll 5 automation layers (PDF Extraction -> AI Prompt -> AI Poster Studio -> Copywriting -> Live Channel Dispatch) executed successfully.\n\nYou can review live performance inside your ContentOS dashboard.`
        : `${greeting}\n\nAn automated operation encountered an issue in ${layerName} for "${input.postTitle}".\n\nPipeline Stage: ${layerName} ❌\nPlatform: ${input.platform}\nDiagnosed Error: ${input.errorReason || "Unknown provider error"}\nTime: ${new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} IST\n\nAction Required: Please log in to your ContentOS dashboard to review the layer diagnostics or reconnect your ${input.platform} channel.`;
    await db.query("INSERT INTO email_outbox(id,recipient,subject,encrypted_body,expires_at,is_test) VALUES($1,$2,$3,$4,$5,$6)", [
        id,
        input.recipientEmail,
        subject,
        encryptToken(body, `mail:${id}`),
        expires,
        process.env.APP_ENV === "test",
    ]);
}
export async function deliverEmails(options = {}) {
    const started = Date.now();
    const limit = options.limit ?? 20;
    let delivered = 0, expired = 0, maxLatencyMs = 0;
    const transport = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT),
        secure: process.env.MAIL_SECURE === "true",
        requireTLS: process.env.MAIL_HOST === "smtp.gmail.com",
        ...(process.env.MAIL_USERNAME
            ? {
                auth: {
                    user: process.env.MAIL_USERNAME,
                    pass: process.env.MAIL_PASSWORD,
                },
            }
            : {}),
        connectionTimeout: 10000,
        socketTimeout: 15000,
    });
    try {
        await pool.query("UPDATE email_outbox SET state='PENDING' WHERE state='PROCESSING' AND claimed_at<now()-interval '2 minutes'");
        await pool.query("UPDATE email_outbox SET state='EXPIRED',encrypted_body=NULL WHERE state IN ('PENDING','PROCESSING','FAILED') AND expires_at<now()");
        for (let i = 0; i < limit && Date.now() - started < (options.budgetMs ?? Infinity); i++) {
            const mail = await transaction(async (db) => {
                const row = (await db.query("SELECT * FROM email_outbox WHERE state='PENDING' AND is_test=false AND available_at<=now() AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
                if (!row)
                    return null;
                await db.query("UPDATE email_outbox SET state='PROCESSING',claimed_at=now(),attempts=attempts+1 WHERE id=$1", [row.id]);
                return row;
            });
            if (!mail)
                break;
            try {
                if (mail.expires_at && new Date(mail.expires_at).getTime() <= Date.now()) {
                    await pool.query("UPDATE email_outbox SET state='EXPIRED',encrypted_body=NULL WHERE id=$1", [mail.id]);
                    expired++;
                    continue;
                }
                const body = decryptToken(mail.encrypted_body, `mail:${mail.id}`);
                const receipt = await transport.sendMail({
                    from: process.env.MAIL_FROM_ADDRESS,
                    to: mail.recipient,
                    subject: mail.subject,
                    text: body,
                    html: emailHtml(mail.subject, body),
                    messageId: `<${mail.id}@hidustansocialnetwork.in>`,
                });
                if (!receipt.accepted?.length)
                    throw new Error("Recipient not accepted");
                await pool.query("UPDATE email_outbox SET state='SENT',sent_at=now(),encrypted_body=NULL WHERE id=$1", [mail.id]);
                delivered++;
                if (mail.created_at)
                    maxLatencyMs = Math.max(maxLatencyMs, Date.now() - new Date(mail.created_at).getTime());
                console.log(JSON.stringify({ event: "email_smtp_accepted", id: mail.id }));
            }
            catch {
                await pool.query("UPDATE email_outbox SET state=$2,available_at=$3 WHERE id=$1", [
                    mail.id,
                    mail.attempts >= 4 ? "FAILED" : "PENDING",
                    new Date(Date.now() + 2 ** mail.attempts * 10000),
                ]);
                console.error(JSON.stringify({ event: "email_delivery_failed", id: mail.id }));
            }
        }
        return { delivered, expired, maxLatencyMs };
    }
    finally {
        transport.close();
    }
}
