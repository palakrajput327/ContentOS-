import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { decryptToken } from "../dist-api/security.js";

try {
  process.loadEnvFile(".env");
} catch {}
if (!process.env.TOKEN_ENCRYPTION_KEY && process.env.ENCRYPTION_KEY) {
  process.env.TOKEN_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
}

const BASE_URL = process.env.TEST_API_URL || "http://127.0.0.1:3002/api/v1";

describe("ContentOS Authentication & Session Test Suite", () => {
  let pool: pg.Pool;
  const testEmail = `test_user_${Date.now()}@example.test`;
  const testPassword = "SuperSecurePassword123!";
  const testName = "Test Automation User";
  let sessionCookie = "";
  let refreshCookie = "";

  before(async () => {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
  });

  after(async () => {
    try {
      if (testEmail) {
        await pool.query("DELETE FROM users WHERE email = $1", [testEmail]);
      }
    } catch {}
    await pool.end();
  });

  it("1. Health ready endpoint returns 200", async () => {
    const res = await fetch(`${BASE_URL}/health/ready`);
    assert.equal(res.status, 200, "Health check should return 200 OK");
  });

  it("2. Rejects registration with missing fields", async () => {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid-email" }),
    });
    assert.equal(res.status, 400, "Should reject invalid registration payload with 400");
  });

  it("3. Successfully registers a new user and queues verification code", async () => {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: testName,
        email: testEmail,
        password: testPassword,
        passwordConfirmation: testPassword,
      }),
    });
    assert.ok(res.status === 200 || res.status === 201, "Registration should succeed");

    // Verify user exists in database
    const userRes = await pool.query("SELECT id, email, email_verified_at FROM users WHERE email = $1", [testEmail]);
    assert.equal(userRes.rowCount, 1, "User record must exist in DB");
    assert.equal(userRes.rows[0].email_verified_at, null, "Email must initially be unverified");
  });

  it("4. Blocks login for unverified accounts", async () => {
    const unverifiedEmail = `unverified_${Date.now()}@example.test`;
    await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Unverified User",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword,
      }),
    });
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: unverifiedEmail,
        password: testPassword,
      }),
    });
    assert.equal(res.status, 401, "Unverified user login should be rejected with 401");
    try {
      await pool.query("DELETE FROM users WHERE email = $1", [unverifiedEmail]);
    } catch {}
  });

  it("5. Successfully verifies email with OTP code from email outbox", async () => {
    const mailRes = await pool.query(
      "SELECT id, encrypted_body FROM email_outbox WHERE recipient = $1 ORDER BY created_at DESC LIMIT 1",
      [testEmail],
    );
    assert.equal(mailRes.rowCount, 1, "Queued verification email must exist in outbox");
    const mailRow = mailRes.rows[0];
    const decryptedBody = decryptToken(mailRow.encrypted_body, `mail:${mailRow.id}`);
    const match = decryptedBody.match(/\b\d{6}\b/);
    assert.ok(match, "Email body must contain 6-digit OTP code");
    const verificationCode = match[0];

    const verifyRes = await fetch(`${BASE_URL}/auth/email/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        code: verificationCode,
      }),
    });
    const verifyRaw = await verifyRes.text();
    let verifyData: any = {};
    try { verifyData = JSON.parse(verifyRaw); } catch {}
    const verifyPayload = verifyData.data || verifyData;
    assert.ok(verifyRes.status === 200 || verifyRes.status === 201, `Email verification should succeed: ${verifyRaw}`);
    assert.equal(verifyPayload.user?.email, testEmail);
    assert.equal(verifyPayload.user?.emailVerified, true);
    assert.ok(verifyPayload.workspaceId, "Workspace must be auto-provisioned upon verification");
  });

  it("6. Successfully logs in with verified credentials and receives session cookies", async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginRaw = await res.text();
    let data: any = {};
    try { data = JSON.parse(loginRaw); } catch {}
    const loginPayload = data.data || data;
    assert.ok(res.status === 200 || res.status === 201, `Login must return 200/201: ${loginRaw}`);
    assert.equal(loginPayload.requiresCode, false);
    assert.equal(loginPayload.user?.email, testEmail);

    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
    for (const c of cookies) {
      const s = c.match(/contentos_session=([^;]+)/);
      if (s) sessionCookie = s[1];
      const r = c.match(/contentos_refresh=([^;]+)/);
      if (r) refreshCookie = r[1];
    }
    assert.ok(sessionCookie, "Must extract contentos_session cookie");
    assert.ok(refreshCookie, "Must extract contentos_refresh cookie");
  });

  it("7. Authenticates /auth/me with valid session cookie", async () => {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: {
        Cookie: `contentos_session=${sessionCookie}`,
      },
    });
    assert.equal(res.status, 200, "/auth/me should succeed with valid session cookie");
    const meData = await res.json() as any;
    const mePayload = meData.data || meData;
    assert.equal(mePayload.user?.email, testEmail);
    assert.ok(mePayload.workspaceId, "Should return active workspace ID");
  });

  it("8. Rejects /auth/me without session cookie", async () => {
    const res = await fetch(`${BASE_URL}/auth/me`);
    assert.equal(res.status, 401, "/auth/me should return 401 Unauthorized when unauthenticated");
  });

  it("9. Refreshes session tokens via /auth/refresh", async () => {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `contentos_refresh=${refreshCookie}`,
      },
    });
    assert.ok(res.status === 200 || res.status === 201, "Token refresh should return 200 or 201 OK");
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
    for (const c of cookies) {
      const s = c.match(/contentos_session=([^;]+)/);
      if (s) sessionCookie = s[1];
    }
  });

  it("10. Successfully logs out and revokes active session", async () => {
    const res = await fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: {
        Cookie: `contentos_session=${sessionCookie}; contentos_refresh=${refreshCookie}`,
      },
    });
    assert.ok(res.status === 200 || res.status === 201, "Logout must return 200 or 201 OK");

    // Verify session revoked
    const postLogoutRes = await fetch(`${BASE_URL}/auth/me`, {
      headers: {
        Cookie: `contentos_session=${sessionCookie}`,
      },
    });
    assert.equal(postLogoutRes.status, 401, "Logged-out session must be rejected with 401");
  });
});
