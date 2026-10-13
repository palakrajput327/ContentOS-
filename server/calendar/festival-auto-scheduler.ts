import { pool, audit, transaction, type DB } from "../db.js";
import { randomUUID } from "node:crypto";
import {
  INDIAN_FESTIVALS,
  getFestivalById,
  type FestivalDefinition,
  type FestivalRegion,
  type Language,
} from "./festival.data.js";
import {
  uploadFestivalPosterJpegToStorage,
  type BrandKitInfo,
} from "../auto-poster.js";

export interface FestivalAutoSchedulerOptions {
  nowFn?: () => Date;
  workspaceId?: string; // Optional single workspace filter for testing
}

export interface SchedulerExecutionResult {
  processedWorkspaces: number;
  detectedFestivals: number;
  generatedDrafts: number;
  autoScheduledPosts: number;
  skippedWorkspaces: number;
  errors: string[];
}

export class FestivalAutoSchedulerService {
  /**
   * Main entry point for automatic festival detection, poster generation, and scheduling.
   * Uses an injectable/mockable clock (nowFn) for deterministic testing.
   */
  static async runFestivalAutoScheduler(
    db: DB | typeof pool = pool,
    options?: FestivalAutoSchedulerOptions,
  ): Promise<SchedulerExecutionResult> {
    const now = options?.nowFn ? options.nowFn() : new Date();
    const result: SchedulerExecutionResult = {
      processedWorkspaces: 0,
      detectedFestivals: 0,
      generatedDrafts: 0,
      autoScheduledPosts: 0,
      skippedWorkspaces: 0,
      errors: [],
    };

    // 1. Query workspaces with festival_automation_enabled = true
    let queryStr = `
      SELECT id, name, timezone, festival_automation_enabled, festival_prep_days, 
             festival_region, festival_language, festival_post_time,
             festival_auto_publish_enabled, festival_approval_mode, festival_social_account_ids
      FROM workspaces 
      WHERE festival_automation_enabled = true
    `;
    const params: any[] = [];
    if (options?.workspaceId) {
      queryStr += ` AND id = $1`;
      params.push(options.workspaceId);
    }

    const wsRes = await db.query(queryStr, params);
    if (!wsRes.rows.length) {
      return result;
    }

    for (const ws of wsRes.rows) {
      result.processedWorkspaces++;
      try {
        if (db === pool) {
          await transaction(async client => {
            const current = (await client.query('SELECT * FROM workspaces WHERE id=$1 FOR UPDATE',[ws.id])).rows[0];
            if (current?.festival_automation_enabled) await this.processWorkspaceFestivals(client,current,now,result);
          });
        } else await this.processWorkspaceFestivals(db, ws, now, result);
      } catch (err: any) {
        const errMsg = `Workspace ${ws.id} (${ws.name}) error: ${err.message}`;
        console.error(`[FestivalAutoScheduler] ${errMsg}`);
        result.errors.push(errMsg);
      }
    }

    return result;
  }

  /**
   * Process festival detection and poster generation for a single workspace
   */
  private static async processWorkspaceFestivals(
    db: DB | typeof pool,
    ws: any,
    now: Date,
    result: SchedulerExecutionResult,
  ) {
    const timezone = ws.timezone || "Asia/Kolkata";
    const prepDays = Math.max(1, Math.min(30, Number(ws.festival_prep_days) || 2));
    const wsRegion: FestivalRegion = ws.festival_region || "ALL";
    const lang: Language = ws.festival_language || "HINGLISH";
    const postTime = ws.festival_post_time || "09:00";

    // Calculate current date in workspace timezone
    const nowZonedStr = this.getZonedDateString(now, timezone);

    // Generate array of target dates within [nowZoned, nowZoned + prepDays]
    const targetDates: string[] = [];
    const baseDate = new Date(`${nowZonedStr}T00:00:00.000Z`);
    for (let d = 0; d <= prepDays; d++) {
      const futureDate = new Date(baseDate.getTime() + d * 24 * 60 * 60 * 1000);
      targetDates.push(futureDate.toISOString().slice(0, 10));
    }

    // Find upcoming Indian festivals matching workspace region & dates
    for (const targetDate of targetDates) {
      const year = parseInt(targetDate.slice(0, 4), 10);
      for (const festival of INDIAN_FESTIVALS) {
        const festivalDate = festival.dates[year];
        if (festivalDate !== targetDate) continue;

        // Check region compatibility
        if (wsRegion !== "ALL" && festival.region !== "ALL" && festival.region !== wsRegion) {
          continue;
        }

        result.detectedFestivals++;

        // Process generation or auto-scheduling for workspace & festival
        const statusOutcome = await this.handleWorkspaceFestivalRecord(
          db,
          ws,
          festival,
          festivalDate,
          lang,
          postTime,
          timezone,
          now,
        );

        if (statusOutcome === "AUTO_SCHEDULED") {
          result.generatedDrafts++;
          result.autoScheduledPosts++;
        } else if (statusOutcome === "DRAFT_GENERATED") {
          result.generatedDrafts++;
        } else {
          result.skippedWorkspaces++;
        }
      }
    }
  }

  /**
   * Handles festival generation, promoting existing drafts, and multi-platform scheduling
   */
  private static async handleWorkspaceFestivalRecord(
    db: DB | typeof pool,
    ws: any,
    festival: FestivalDefinition,
    festivalDate: string,
    language: Language,
    postTime: string,
    timezone: string,
    now: Date,
  ): Promise<"AUTO_SCHEDULED" | "DRAFT_GENERATED" | "SKIPPED"> {
    let scheduledIso = this.calculateScheduledTimestamp(festivalDate, postTime, timezone);
    // Preserve occupied schedules and place festival content in the next free
    // ten-minute interval on the same local date. Real runs hold the workspace lock.
    if ('release' in db) {
      const occupied = (await db.query(`SELECT execute_at FROM scheduled_posts WHERE workspace_id=$1 AND state <> 'CANCELLED' AND (execute_at AT TIME ZONE $2)::date=$3::date AND content_id NOT IN (SELECT content_id FROM scheduled_festival_posts WHERE workspace_id=$1 AND festival_id=$4 AND festival_date=$3::date AND content_id IS NOT NULL)`,[ws.id,timezone,festivalDate,festival.id])).rows;
      let candidate = new Date(scheduledIso);
      while (occupied.some(r=>Math.abs(new Date(r.execute_at).getTime()-candidate.getTime())<600000)) candidate = new Date(candidate.getTime()+600000);
      if (this.getZonedDateString(candidate,timezone)!==festivalDate) return 'SKIPPED';
      scheduledIso=candidate.toISOString();
    }
    const scheduledTimeMs = new Date(scheduledIso).getTime();
    const isPastPostingTime = scheduledTimeMs <= now.getTime();

    const isAutoPublishEligible =
      Boolean(ws.festival_automation_enabled) &&
      Boolean(ws.festival_auto_publish_enabled) &&
      ws.festival_approval_mode === "AUTO_APPROVAL" &&
      Array.isArray(ws.festival_social_account_ids) &&
      ws.festival_social_account_ids.length > 0;

    // Check if an existing tracking record exists
    const existingTrackingRes = await db.query(
      `SELECT id, status, content_id, publish_status FROM scheduled_festival_posts
       WHERE workspace_id = $1 AND festival_id = $2 AND festival_date = $3`,
      [ws.id, festival.id, festivalDate],
    );

    const existingTracking = existingTrackingRes.rows[0];

    // CASE 1: Previously generated draft exists in NEEDS_REVIEW
    if (existingTracking && existingTracking.content_id) {
      if (existingTracking.publish_status === "SCHEDULED" || existingTracking.publish_status === "PUBLISHED") {
        return "SKIPPED"; // Already scheduled or published
      }

      // If workspace is eligible for AUTO_APPROVAL and festival post time has not passed, promote existing draft
      if (isAutoPublishEligible && !isPastPostingTime) {
        const contentRes = await db.query(
          `SELECT id, title, version, status FROM content WHERE id = $1 AND workspace_id = $2`,
          [existingTracking.content_id, ws.id],
        );
        const existingContent = contentRes.rows[0];

        if (existingContent && existingContent.status === "NEEDS_REVIEW") {
          const eligibleAccounts = await this.getEligibleSocialAccounts(db, ws.id, ws.festival_social_account_ids);
          if (eligibleAccounts.length > 0) {
            await this.scheduleAuthorizedFestivalContent(
              db,
              ws,
              existingContent,
              eligibleAccounts,
              scheduledIso,
              timezone,
              festival,
              festivalDate,
              existingTracking.id,
            );
            return "AUTO_SCHEDULED";
          }
        }
      }

      return "SKIPPED";
    }

    // CASE 2: New festival record - reserve atomic lock
    const trackingId = randomUUID();
    const lockRes = await db.query(
      `INSERT INTO scheduled_festival_posts (id, workspace_id, festival_id, festival_date, status, publish_status)
       VALUES ($1, $2, $3, $4, 'PROCESSING', 'PENDING')
       ON CONFLICT (workspace_id, festival_id, festival_date) DO NOTHING
       RETURNING id`,
      [trackingId, ws.id, festival.id, festivalDate],
    );

    if (!lockRes.rows.length) {
      return "SKIPPED"; // Concurrently processing or already processed
    }

    try {
      // Fetch Brand Kit & Validate Company Details
      const bkRes = await db.query(
        `SELECT data FROM brand_kits WHERE workspace_id = $1`,
        [ws.id],
      );

      const brandKitData = bkRes.rows[0]?.data;
      const companyName = brandKitData?.companyName || brandKitData?.name;

      if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
        console.warn(
          `[FestivalAutoScheduler] Workspace ${ws.id} (${ws.name}) skipped: Missing brand kit company name.`,
        );
        await db.query(
          `UPDATE scheduled_festival_posts SET status = 'FAILED', error_message = 'Missing brand kit company details' WHERE id = $1`,
          [trackingId],
        );
        return "SKIPPED";
      }

      const brandKit: BrandKitInfo = {
        companyName: companyName.trim(),
        phone: brandKitData.phone,
        website: brandKitData.website,
        primaryColor: brandKitData.primaryColor,
        accentColor: brandKitData.accentColor,
      };

      // Multilingual Greetings
      const langKey = language === "EN" ? "en" : language === "HI" ? "hi" : "hinglish";
      const greeting = festival.greetings[langKey] || festival.greetings.hinglish;
      const titleText = greeting.title;
      const wishText = greeting.wish;

      // Render Poster & Upload to Object Storage
      const poster = await uploadFestivalPosterJpegToStorage({
        title: titleText,
        wish: wishText,
        theme: festival.theme,
        brandKit,
      },{workspaceId:ws.id,db});

      const contentId = randomUUID();
      const year = parseInt(festivalDate.slice(0, 4), 10);
      const postTitle = `${festival.name} (${year}) — Festival Greeting`;
      const postBody = `${titleText}\n\n${wishText}\n\n#${festival.id.replace(/-/g, "")} #${festival.name.replace(/\s+/g, "")} #ContentOS`;

      const variants = {
        mediaUrl: poster.url,
        mediaType: "image",
        metadata: {
          content_source: "INDIAN_FESTIVAL_ENGINE",
          festival_id: festival.id,
          festival_name: festival.name,
          festival_date: festivalDate,
          festival_year: year,
          festival_category: festival.category,
          festival_region: festival.region,
          poster_key: poster.key,
          language,
          auto_generated: true,
        },
      };

      // Identify designated workspace owner/admin
      const memberRes = await db.query(
        `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role IN ('Owner', 'Admin') ORDER BY role = 'Owner' DESC LIMIT 1`,
        [ws.id],
      );
      const createdBy = memberRes.rows[0]?.user_id || "00000000-0000-0000-0000-000000000000";

      // Check if auto-publish is eligible and posting time is not past
      let eligibleAccounts: any[] = [];
      if (isAutoPublishEligible && !isPastPostingTime) {
        eligibleAccounts = await this.getEligibleSocialAccounts(db, ws.id, ws.festival_social_account_ids);
      }

      if (isAutoPublishEligible && !isPastPostingTime && eligibleAccounts.length > 0) {
        // AUTO_APPROVAL: Create post directly with SCHEDULED status and populate scheduled_posts
        await db.query(
          `INSERT INTO content(
            id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, approved_by, scheduled_by, scheduled_at, timezone, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED', $7, $7, $7, $7, $8::timestamptz, $9, NOW(), NOW())`,
          [
            contentId,
            ws.id,
            postTitle,
            postBody,
            JSON.stringify(variants),
            JSON.stringify(eligibleAccounts.map((a) => a.platform)),
            createdBy,
            scheduledIso,
            timezone,
          ],
        );

        // Record auditable system approval
        await db.query(
          `INSERT INTO approvals(id, workspace_id, content_id, version, actor_id, decision, created_at)
           VALUES ($1, $2, $3, 1, $4, 'approve', NOW())`,
          [randomUUID(), ws.id, contentId, createdBy],
        );

        // Schedule individual platform jobs with database-level idempotency
        for (const account of eligibleAccounts) {
          await db.query(
            `INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
             VALUES ($1, $2, $3, $4, 1, $5::timestamptz, $6, 'PENDING')
             ON CONFLICT (content_id, account_id, content_version) DO NOTHING`,
            [randomUUID(), ws.id, contentId, account.id, scheduledIso, timezone],
          );
        }

        // Update tracking record
        await db.query(
          `UPDATE scheduled_festival_posts SET status = 'GENERATED', content_id = $1, publish_status = 'SCHEDULED' WHERE id = $2`,
          [contentId, trackingId],
        );

        // Record audit trail
        try {
          await audit(
            db,
            ws.id,
            createdBy,
            "festival_auto_approval",
            "content",
            contentId,
            postTitle,
            null,
            {
              mode: "AUTO_APPROVAL",
              workspace_setting_ref: "festival_auto_publish_enabled",
              festival_id: festival.id,
              festival_date: festivalDate,
              scheduled_at: scheduledIso,
              account_ids: eligibleAccounts.map((a) => a.id),
            },
          );
        } catch {}

        console.log(
          `[FestivalAutoScheduler] ✅ Auto-approved & scheduled festival content for ${ws.name} (${festival.name}) on ${festivalDate} at ${postTime} ${timezone}`,
        );
        return "AUTO_SCHEDULED";
      } else {
        // MANUAL_APPROVAL (or past posting time or no eligible connected accounts): Save as NEEDS_REVIEW
        const publishStatus = isPastPostingTime ? "SKIPPED" : "PENDING";
        const errorMsg = isPastPostingTime
          ? "Festival post time has already passed in workspace timezone"
          : isAutoPublishEligible && eligibleAccounts.length === 0
            ? "No healthy authorized social accounts available"
            : null;

        await db.query(
          `INSERT INTO content(
            id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, timezone, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW', $7, $7, $8::timestamptz, $9, NOW(), NOW())`,
          [
            contentId,
            ws.id,
            postTitle,
            postBody,
            JSON.stringify(variants),
            JSON.stringify(["LinkedIn", "Instagram", "Telegram", "Facebook"]),
            createdBy,
            scheduledIso,
            timezone,
          ],
        );

        await db.query(
          `UPDATE scheduled_festival_posts SET status = 'GENERATED', content_id = $1, publish_status = $2, error_message = $3 WHERE id = $4`,
          [contentId, publishStatus, errorMsg, trackingId],
        );

        console.log(
          `[FestivalAutoScheduler] ✅ Created festival draft (NEEDS_REVIEW) for ${ws.name} (${festival.name}) on ${festivalDate}`,
        );
        return "DRAFT_GENERATED";
      }
    } catch (err: any) {
      console.error(
        `[FestivalAutoScheduler] ❌ Failed generating poster for workspace ${ws.id} / ${festival.id}: ${err.message}`,
      );
      await db.query(
        `UPDATE scheduled_festival_posts SET status = 'FAILED', error_message = $1 WHERE id = $2`,
        [err.message, trackingId],
      );
      return "SKIPPED";
    }
  }

  /**
   * Promotes an existing NEEDS_REVIEW festival draft to SCHEDULED with full audit trail
   */
  private static async scheduleAuthorizedFestivalContent(
    db: DB | typeof pool,
    ws: any,
    content: any,
    eligibleAccounts: any[],
    scheduledIso: string,
    timezone: string,
    festival: FestivalDefinition,
    festivalDate: string,
    trackingId: string,
  ) {
    const memberRes = await db.query(
      `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role IN ('Owner', 'Admin') ORDER BY role = 'Owner' DESC LIMIT 1`,
      [ws.id],
    );
    const approverId = memberRes.rows[0]?.user_id || "00000000-0000-0000-0000-000000000000";

    // Update content to SCHEDULED
    await db.query(
      `UPDATE content SET status = 'SCHEDULED', approved_by = $1, scheduled_by = $1, scheduled_at = $2::timestamptz, timezone = $3, updated_at = NOW() WHERE id = $4`,
      [approverId, scheduledIso, timezone, content.id],
    );

    // Record approval
    await db.query(
      `INSERT INTO approvals(id, workspace_id, content_id, version, actor_id, decision, created_at)
       VALUES ($1, $2, $3, $4, $5, 'approve', NOW())`,
      [randomUUID(), ws.id, content.id, content.version, approverId],
    );

    // Insert scheduled_posts idempotently
    for (const account of eligibleAccounts) {
      await db.query(
        `INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, 'PENDING')
         ON CONFLICT (content_id, account_id, content_version) DO NOTHING`,
        [randomUUID(), ws.id, content.id, account.id, content.version, scheduledIso, timezone],
      );
    }

    // Update tracking
    await db.query(
      `UPDATE scheduled_festival_posts SET publish_status = 'SCHEDULED' WHERE id = $1`,
      [trackingId],
    );

    try {
      await audit(
        db,
        ws.id,
        approverId,
        "festival_auto_approval",
        "content",
        content.id,
        content.title,
        null,
        {
          mode: "AUTO_APPROVAL",
          workspace_setting_ref: "festival_auto_publish_enabled",
          festival_id: festival.id,
          festival_date: festivalDate,
          scheduled_at: scheduledIso,
          account_ids: eligibleAccounts.map((a) => a.id),
        },
      );
    } catch {}
  }

  /**
   * Fetches healthy, connected, and unexpired social accounts matching the authorized IDs
   */
  public static async getEligibleSocialAccounts(
    db: DB | typeof pool,
    workspaceId: string,
    authorizedAccountIds: string[],
  ): Promise<any[]> {
    if (!Array.isArray(authorizedAccountIds) || !authorizedAccountIds.length) {
      return [];
    }

    const res = await db.query(
      `SELECT a.id, a.platform, a.name, a.provider_id
       FROM social_accounts a
       JOIN social_account_tokens t ON t.account_id = a.id
       WHERE a.workspace_id = $1
         AND a.id = ANY($2)
         AND lower(a.state) = 'connected'
         AND (t.expires_at IS NULL OR t.expires_at > now())
         AND lower(a.platform) IN ('linkedin', 'instagram', 'telegram', 'facebook')`,
      [workspaceId, authorizedAccountIds],
    );

    return res.rows;
  }

  /**
   * Formats YYYY-MM-DD date string in given timezone
   */
  public static getZonedDateString(date: Date, timeZone: string): string {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return formatter.format(date); // Format: YYYY-MM-DD
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  /**
   * Calculates ISO timestamp in UTC for target date + post time in workspace timezone.
   * E.g. ('2026-10-20', '09:00', 'Asia/Kolkata') strictly equals '2026-10-20T03:30:00.000Z'.
   */
  public static calculateScheduledTimestamp(
    dateStr: string,
    timeStr: string,
    timeZone: string,
  ): string {
    const timeClean = /^[0-2][0-9]:[0-5][0-9]$/.test(timeStr) ? timeStr : "09:00";
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      const [hh, mm] = timeClean.split(":").map(Number);
      const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0));
      const inv = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
      });
      const parts = Object.fromEntries(
        inv.formatToParts(utcGuess).map((p) => [p.type, p.value]),
      );
      const hourNum = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
      const guessInZone = new Date(
        Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          hourNum,
          Number(parts.minute),
          Number(parts.second),
        ),
      );
      const offsetDiff = utcGuess.getTime() - guessInZone.getTime();
      const finalUtc = new Date(utcGuess.getTime() + offsetDiff);
      return finalUtc.toISOString();
    } catch {
      return `${dateStr}T${timeClean}:00.000Z`;
    }
  }
}
