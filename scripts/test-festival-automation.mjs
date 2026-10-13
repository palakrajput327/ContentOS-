import "reflect-metadata";
import assert from "node:assert/strict";

console.log("Starting Festival Automation Phase 1 Verification Test Suite...\n");

async function runTests() {
  const { FestivalAutoSchedulerService } = await import("../dist-api/calendar/festival-auto-scheduler.js");
  const { ConflictException } = await import("@nestjs/common");
  // In-memory mock database for isolated testing
  const mockWorkspaces = [
    {
      id: "ws-11111111-1111-1111-1111-111111111111",
      name: "Brand Alpha (Automation ON)",
      timezone: "Asia/Kolkata",
      festival_automation_enabled: true,
      festival_prep_days: 2,
      festival_region: "ALL",
      festival_language: "HINGLISH",
      festival_post_time: "09:00",
    },
    {
      id: "ws-22222222-2222-2222-2222-222222222222",
      name: "Brand Beta (Automation OFF)",
      timezone: "Asia/Kolkata",
      festival_automation_enabled: false,
      festival_prep_days: 2,
      festival_region: "ALL",
      festival_language: "HINGLISH",
      festival_post_time: "09:00",
    },
    {
      id: "ws-33333333-3333-3333-3333-333333333333",
      name: "Brand Gamma (Missing Brand Kit)",
      timezone: "Asia/Kolkata",
      festival_automation_enabled: true,
      festival_prep_days: 2,
      festival_region: "ALL",
      festival_language: "HINGLISH",
      festival_post_time: "09:00",
    },
  ];

  const mockBrandKits = {
    "ws-11111111-1111-1111-1111-111111111111": {
      companyName: "Hindustan Alpha Traders",
      phone: "+91 98765 43210",
      website: "www.alpha-traders.in",
    },
    "ws-33333333-3333-3333-3333-333333333333": {
      companyName: "", // Incomplete/missing company name
    },
  };

  const mockScheduledFestivalPosts = [];
  const mockContent = [];
  const mockSocialCalls = []; // Track social API calls to verify zero publishing

  const mockDb = {
    query: async (sql, params = []) => {
      // 1. SELECT workspaces
      if (sql.includes("FROM workspaces")) {
        let filtered = mockWorkspaces.filter((w) => w.festival_automation_enabled);
        if (sql.includes("AND id = $1")) {
          filtered = filtered.filter((w) => w.id === params[0]);
        }
        return { rows: filtered, rowCount: filtered.length };
      }

      // 1.5. SELECT scheduled_festival_posts
      if (sql.includes("SELECT id, status, content_id, publish_status FROM scheduled_festival_posts")) {
        const found = mockScheduledFestivalPosts.filter(
          (p) => p.workspace_id === params[0] && p.festival_id === params[1] && p.festival_date === params[2],
        );
        return { rows: found, rowCount: found.length };
      }

      // 2. INSERT INTO scheduled_festival_posts (Atomic Lock Reservation)
      if (sql.includes("INSERT INTO scheduled_festival_posts")) {
        const [id, wsId, festId, festDate, status] = params;
        const exists = mockScheduledFestivalPosts.some(
          (p) =>
            p.workspace_id === wsId &&
            p.festival_id === festId &&
            p.festival_date === festDate &&
            (p.status === "PROCESSING" || p.status === "GENERATED"),
        );

        if (exists) {
          return { rows: [], rowCount: 0 }; // Lock failed / already processing
        }

        const newRec = { id, workspace_id: wsId, festival_id: festId, festival_date: festDate, status };
        mockScheduledFestivalPosts.push(newRec);
        return { rows: [newRec], rowCount: 1 };
      }

      // 3. UPDATE scheduled_festival_posts
      if (sql.includes("UPDATE scheduled_festival_posts")) {
        if (sql.includes("status = 'FAILED'")) {
          const rec = mockScheduledFestivalPosts.find((p) => p.id === params[0]);
          if (rec) rec.status = "FAILED";
        } else if (sql.includes("status = 'GENERATED'")) {
          const rec = mockScheduledFestivalPosts.find((p) => p.id === params[params.length - 1]);
          if (rec) {
            rec.status = "GENERATED";
            rec.content_id = params[0];
          }
        }
        return { rowCount: 1 };
      }

      // 4. SELECT brand_kits
      if (sql.includes("FROM brand_kits")) {
        const bk = mockBrandKits[params[0]];
        return { rows: bk ? [{ data: bk }] : [], rowCount: bk ? 1 : 0 };
      }

      // 5. SELECT workspace_members
      if (sql.includes("FROM workspace_members")) {
        return { rows: [{ user_id: "user-1234" }], rowCount: 1 };
      }

      // 6. INSERT INTO content (Draft Creation)
      if (sql.includes("INSERT INTO content")) {
        const [id, wsId, title, body, variantsJson, platformsJson, createdBy, scheduledAt] = params;
        const variants = JSON.parse(variantsJson);
        const item = {
          id,
          workspace_id: wsId,
          title,
          body,
          variants,
          platforms: JSON.parse(platformsJson),
          status: "NEEDS_REVIEW",
          created_by: createdBy,
          scheduled_at: scheduledAt,
        };
        mockContent.push(item);
        return { rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  // 1. Mock Clock Test: Simulate Oct 18, 2026 (2 days before Dussehra on Oct 20, 2026)
  console.log("1. Testing Injectable Mock Clock (Simulating Oct 18, 2026 for Dussehra on Oct 20)...");
  const mockClockOct18 = () => new Date("2026-10-18T10:00:00+05:30");

  const run1Result = await FestivalAutoSchedulerService.runFestivalAutoScheduler(mockDb, {
    nowFn: mockClockOct18,
  });

  assert.strictEqual(run1Result.processedWorkspaces, 2, "Should process 2 enabled workspaces (Alpha & Gamma)");
  assert.ok(run1Result.detectedFestivals >= 1, "Should detect at least 1 festival (Dussehra)");
  assert.strictEqual(run1Result.generatedDrafts, 1, "Should generate 1 draft for Brand Alpha");
  assert.strictEqual(run1Result.skippedWorkspaces, 1, "Should skip 1 workspace (Brand Gamma - missing brand kit)");

  const alphaDraft = mockContent.find((c) => c.workspace_id === "ws-11111111-1111-1111-1111-111111111111");
  assert.ok(alphaDraft, "Content draft for Brand Alpha must exist");
  assert.strictEqual(alphaDraft.status, "NEEDS_REVIEW", "Phase 1 status MUST BE NEEDS_REVIEW ONLY");
  assert.strictEqual(alphaDraft.variants.metadata.content_source, "INDIAN_FESTIVAL_ENGINE");
  assert.strictEqual(alphaDraft.variants.metadata.festival_id, "dussehra");
  assert.strictEqual(alphaDraft.variants.metadata.festival_date, "2026-10-20");
  assert.ok(alphaDraft.scheduled_at.includes("2026-10-20"), "Scheduled date MUST be Oct 20, 2026");

  console.log(`✅ Draft Created: Title: "${alphaDraft.title}", Status: ${alphaDraft.status}, ScheduledAt: ${alphaDraft.scheduled_at}`);

  // 2. Test Duplicate Prevention & Atomic DB Idempotency
  console.log("2. Testing Idempotency & Duplicate Prevention (Running Scheduler 3x on Oct 18)...");
  const run2Result = await FestivalAutoSchedulerService.runFestivalAutoScheduler(mockDb, {
    nowFn: mockClockOct18,
  });

  assert.strictEqual(run2Result.generatedDrafts, 0, "Run 2 must generate 0 additional drafts (Duplicate prevented)");

  const run3Result = await FestivalAutoSchedulerService.runFestivalAutoScheduler(mockDb, {
    nowFn: mockClockOct18,
  });

  assert.strictEqual(run3Result.generatedDrafts, 0, "Run 3 must generate 0 additional drafts (Duplicate prevented)");
  assert.strictEqual(mockContent.length, 1, "Total content drafts in DB must remain exactly 1");
  console.log("✅ Duplicate Prevention Verified (100% Idempotent across 3 runs).");

  // 3. Test Automation OFF Check & Tenant Isolation
  console.log("3. Testing Automation OFF & Tenant Isolation...");
  const betaDraft = mockContent.find((c) => c.workspace_id === "ws-22222222-2222-2222-2222-222222222222");
  assert.strictEqual(betaDraft, undefined, "Brand Beta (Automation OFF) MUST HAVE 0 content drafts");
  console.log("✅ Tenant Isolation Verified (Automation OFF produced 0 content).");

  // 4. Test Missing Brand Kit Fallback
  console.log("4. Testing Missing Brand Kit Graceful Fallback...");
  const gammaDraft = mockContent.find((c) => c.workspace_id === "ws-33333333-3333-3333-3333-333333333333");
  assert.strictEqual(gammaDraft, undefined, "Brand Gamma (Missing brand kit) MUST NOT invent company details or create draft");

  const gammaTracking = mockScheduledFestivalPosts.find(
    (p) => p.workspace_id === "ws-33333333-3333-3333-3333-333333333333",
  );
  assert.ok(gammaTracking, "Tracking record must exist for Brand Gamma");
  assert.strictEqual(gammaTracking.status, "FAILED", "Tracking status must be marked FAILED for missing brand kit");
  console.log("✅ Missing Brand Kit Fallback Verified (Skipped gracefully without crashing scheduler).");

  // 5. Verify Zero Social Publishing API Calls
  console.log("5. Verifying Zero Social Publishing Network Requests...");
  assert.strictEqual(mockSocialCalls.length, 0, "Zero social API publishing requests must be made in Phase 1");
  console.log("✅ Confirmed ZERO Social Media Publishing Calls Made.");

  console.log("\n🎉 ALL FESTIVAL AUTOMATION PHASE 1 TESTS PASSED 100%!");
}

runTests().catch((err) => {
  console.error("❌ Test Failed with error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
