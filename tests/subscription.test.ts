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

const BASE_URL = process.env.TEST_API_URL || "http://127.0.0.1:3001/api/v1";

describe("ContentOS SaaS Subscription & Entitlement Test Suite", () => {
  let pool: pg.Pool;
  const testEmail = `saas_sub_${Date.now()}@example.test`;
  const testPassword = "SuperSecurePassword123!";
  const testName = "SaaS Subscription Tester";
  const testPhone = "+919876543210";
  const testPhoneCountry = "+91";

  let sessionCookie = "";
  let workspaceId = "";
  let userId = "";

  before(async () => {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });
  });

  after(async () => {
    try {
      if (workspaceId) {
        await pool.query("DELETE FROM content_versions WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM content WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM activity_logs WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM subscription_payments WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM subscription_events WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM workspace_trials WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM workspace_subscriptions WHERE workspace_id = $1", [workspaceId]);
        await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [workspaceId]);
        await pool.query("UPDATE users SET active_workspace_id = NULL WHERE id = $1", [userId]);
        await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      }
      if (userId) {
        await pool.query("DELETE FROM auth_events WHERE user_id = $1", [userId]);
        await pool.query("DELETE FROM user_consents WHERE user_id = $1", [userId]);
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      }
    } catch (e) {
      console.error("Cleanup error:", e);
    }
    await pool.end();
  });

  it("1. Registers user with international phone and legal consents", async () => {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: testName,
        email: testEmail,
        password: testPassword,
        passwordConfirmation: testPassword,
        phone: testPhone,
        phone_number: testPhone,
        phoneCountryCode: testPhoneCountry,
        phone_country_code: testPhoneCountry,
        termsAccepted: true,
        terms_accepted: true,
        privacy_policy_accepted: true,
        termsVersion: "v1.0",
        privacyVersion: "v1.0",
      }),
    });
    assert.ok(res.status === 200 || res.status === 201, `Registration should succeed, got ${res.status}`);

    const userRes = await pool.query(
      "SELECT id, email, phone_number, phone_country_code FROM users WHERE email = $1",
      [testEmail],
    );
    assert.equal(userRes.rowCount, 1, "User record must exist in DB");
    userId = userRes.rows[0].id;
    assert.equal(userRes.rows[0].phone_number, testPhone, "Phone number must be saved");
    assert.equal(userRes.rows[0].phone_country_code, testPhoneCountry, "Country code must be saved");

    // Check user_consents table
    const consentRes = await pool.query(
      "SELECT terms_version, privacy_version FROM user_consents WHERE user_id = $1",
      [userId],
    );
    assert.equal(consentRes.rowCount, 1, "User consent must be recorded");
    assert.equal(consentRes.rows[0].terms_version, "v1.0");
    assert.equal(consentRes.rows[0].privacy_version, "v1.0");
  });

  it("2. Verifies email and auto-provisions workspace with 5-day trial (120 hours)", async () => {
    const mailRes = await pool.query(
      "SELECT id, encrypted_body FROM email_outbox WHERE recipient = $1 ORDER BY created_at DESC LIMIT 1",
      [testEmail],
    );
    assert.equal(mailRes.rowCount, 1, "Queued verification email must exist");
    const decryptedBody = decryptToken(mailRes.rows[0].encrypted_body, `mail:${mailRes.rows[0].id}`);
    const match = decryptedBody.match(/\b\d{6}\b/);
    assert.ok(match, "Email must contain OTP");
    const code = match[0];

    const verifyRes = await fetch(`${BASE_URL}/auth/email/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, code }),
    });
    assert.ok(verifyRes.ok, `Verification should succeed with 200, got ${verifyRes.status}`);

    // Login to obtain session cookie
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    assert.ok(loginRes.ok, "Login should succeed");
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/contentos_session=([^;]+)/);
    assert.ok(sessionMatch, "Session cookie must be returned");
    sessionCookie = `contentos_session=${sessionMatch[1]}`;

    // Query provisioned workspace
    const memberRes = await pool.query(
      "SELECT workspace_id FROM workspace_members WHERE user_id = $1",
      [userId],
    );
    assert.equal(memberRes.rowCount, 1, "Workspace member should exist");
    workspaceId = memberRes.rows[0].workspace_id;
    assert.ok(workspaceId, "Workspace ID must be non-empty");

    // Check workspace_trials table
    const trialRes = await pool.query(
      "SELECT started_at, ends_at, daily_post_limit FROM workspace_trials WHERE workspace_id = $1",
      [workspaceId],
    );
    assert.equal(trialRes.rowCount, 1, "Workspace trial record must be created");
    assert.equal(trialRes.rows[0].daily_post_limit, 3, "Trial daily post limit must be 3");

    // Check trial end is roughly 5 days (120 hours) after trial start
    const diffHours = (new Date(trialRes.rows[0].ends_at).getTime() - new Date(trialRes.rows[0].started_at).getTime()) / (1000 * 60 * 60);
    assert.ok(Math.abs(diffHours - 120) < 1, `Trial duration must be exactly 120 hours, got ${diffHours}`);

    // Check workspace_subscriptions table
    const subRes = await pool.query(
      "SELECT status, plan_id, custom_daily_limit FROM workspace_subscriptions WHERE workspace_id = $1",
      [workspaceId],
    );
    assert.equal(subRes.rowCount, 1, "Subscription record must exist");
    assert.equal(subRes.rows[0].status, "TRIALING", "Initial subscription status must be TRIALING");
    assert.equal(subRes.rows[0].custom_daily_limit, 3, "Trial daily post limit must be 3");
  });

  it("3. GET /billing/current returns active trial entitlement and 3 posts/day limit", async () => {
    const res = await fetch(`${BASE_URL}/billing/current`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    assert.equal(res.status, 200, "Billing current should return 200 OK");
    const json = await res.json();
    const body = json.data || json;
    assert.ok(body.entitlement, "Entitlement must be returned");
    assert.equal(body.entitlement.effectiveState, "TRIAL_ACTIVE");
    assert.equal(body.entitlement.isLocked, false);
    assert.equal(body.entitlement.dailyPostingLimit, 3);
    assert.ok(body.entitlement.trial, "Trial details must be present");
    assert.ok(body.entitlement.trial.daysRemaining >= 4, "Trial should have 4-5 days remaining");
    assert.ok(body.entitlement.trial.remainingSeconds > 400000, "Trial should have >400,000s remaining");
    assert.equal(body.usage.dailyLimit, 3);
    assert.equal(body.usage.postsUsedToday, 0);
  });

  it("4. GET /billing/usage tracks quota history", async () => {
    const res = await fetch(`${BASE_URL}/billing/usage`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    const body = json.data || json;
    assert.ok(Array.isArray(body.history), "History must be an array");
    assert.ok(body.history.length >= 7, "Must contain at least 7 days");
  });

  it("5. GET /billing/plans returns Starter (₹15,000), Growth (₹25,000), Scale (₹50,000)", async () => {
    const res = await fetch(`${BASE_URL}/billing/plans`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    const data = json.data || json;
    assert.ok(Array.isArray(data.plans), "Plans must be an array");
    assert.equal(data.plans.length, 3, "Must have exactly 3 paid plans");

    const starter = data.plans.find((p: any) => p.code === "STARTER");
    const growth = data.plans.find((p: any) => p.code === "GROWTH");
    const scale = data.plans.find((p: any) => p.code === "SCALE");

    assert.ok(starter && growth && scale, "All 3 plans (STARTER, GROWTH, SCALE) must exist");
    assert.equal(Number(starter.monthlyPrice), 15000);
    assert.equal(starter.dailyPostLimit, 3);

    assert.equal(Number(growth.monthlyPrice), 25000);
    assert.equal(growth.dailyPostLimit, 5);

    assert.equal(Number(scale.monthlyPrice), 50000);
    assert.equal(scale.dailyPostLimit, 10);
  });

  it("6. Submits manual payment request for Growth plan", async () => {
    const res = await fetch(`${BASE_URL}/billing/payment-request`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        planCode: "GROWTH",
        billingPeriod: "YEARLY",
        providerReference: "UPI-TEST-TXN-998877",
        paymentNotes: "Paid via GPay UPI",
      }),
    });
    assert.equal(res.status, 201, `Payment request should return 201, got ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    assert.equal(data.success, true);
    assert.ok(data.payment.paymentId, "Payment ID must be returned");
    assert.equal(data.payment.status, "PENDING");
    assert.equal(data.payment.billingPeriod, "YEARLY");
  });

  it("7. Simulates trial expiration and enforces 402 feature locking on post creation", async () => {
    // Expire trial in database
    await pool.query(
      "UPDATE workspace_trials SET ends_at = now() - interval '1 hour', status = 'EXPIRED' WHERE workspace_id = $1",
      [workspaceId],
    );
    await pool.query(
      "UPDATE workspace_subscriptions SET status = 'EXPIRED', current_period_end = now() - interval '1 hour' WHERE workspace_id = $1",
      [workspaceId],
    );

    // Verify GET /billing/current reports LOCKED
    const checkRes = await fetch(`${BASE_URL}/billing/current`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    const json = await checkRes.json();
    const sub = json.data || json;
    assert.equal(sub.entitlement.effectiveState, "LOCKED");
    assert.equal(sub.entitlement.isLocked, true);

    // Attempt to create post -> must fail with 402 Payment Required
    const postRes = await fetch(`${BASE_URL}/content`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Locked post test",
        body: "Locked post attempt during expired trial",
        platforms: ["Instagram"],
        variants: {},
      }),
    });
    assert.equal(postRes.status, 402, `Post creation must return 402 when locked, got ${postRes.status}`);
    const postErr = await postRes.json();
    const errMsg = postErr.message || (postErr.data && postErr.data.message) || "";
    assert.ok(errMsg.includes("Subscription required") || errMsg.includes("upgrade") || postErr.code === "SUBSCRIPTION_REQUIRED");

    // Billing endpoints remain accessible even when locked
    const billingRes = await fetch(`${BASE_URL}/billing/plans`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    assert.equal(billingRes.status, 200, "Billing plans must remain accessible when locked");
  });

  it("8. Admin approves payment request and activates Growth plan (5 posts/day)", async () => {
    // Find pending payment
    const paymentRes = await pool.query(
      "SELECT id, plan_id FROM subscription_payments WHERE workspace_id = $1 AND status = 'PENDING' LIMIT 1",
      [workspaceId],
    );
    assert.equal(paymentRes.rowCount, 1, "Pending payment must exist");
    const paymentId = paymentRes.rows[0].id;

    // Simulate admin verification and subscription activation
    await pool.query(
      `UPDATE subscription_payments
       SET status = 'VERIFIED', verified_by = 'system_admin', verified_at = now()
       WHERE id = $1`,
      [paymentId],
    );
    await pool.query(
      `UPDATE workspace_subscriptions
       SET status = 'ACTIVE',
           plan_id = $1,
           billing_period = 'YEARLY',
           start_at = now(),
           current_period_end = now() + interval '1 year',
           custom_daily_limit = NULL,
           updated_at = now()
       WHERE workspace_id = $2`,
      [paymentRes.rows[0].plan_id, workspaceId],
    );

    // Verify GET /billing/current now returns PAID_ACTIVE with 5 daily limit
    const activeRes = await fetch(`${BASE_URL}/billing/current`, {
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
      },
    });
    assert.equal(activeRes.status, 200);
    const activeJson = await activeRes.json();
    const activeSub = activeJson.data || activeJson;
    assert.equal(activeSub.entitlement.effectiveState, "PAID_ACTIVE");
    assert.equal(activeSub.entitlement.isLocked, false);
    assert.equal(activeSub.entitlement.dailyPostingLimit, 5);
    assert.equal(activeSub.entitlement.plan.code, "GROWTH");

    // Post creation is now unlocked!
    const createRes = await fetch(`${BASE_URL}/content`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "x-workspace-id": workspaceId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Unlocked Post",
        body: "Active subscription test post",
        platforms: ["Instagram"],
        variants: {},
      }),
    });
    assert.ok(createRes.status === 200 || createRes.status === 201, `Post creation should now succeed, got ${createRes.status}`);
  });
});
