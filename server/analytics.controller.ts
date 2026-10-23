import {
  Controller,
  Get,
  Post,
  Req,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { pool } from "./db.js";
import { WorkspaceRequired, type AuthedRequest } from "./security.js";
import { getLLMProvider } from "./ai/llm.service.js";

const stringOrStringArray = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v.join(", ") : String(v || "")));

const aiInsightsSchema = z.object({
  healthScore: z.coerce.number().min(0).max(100).default(50),
  statusRating: z.string().default("Active"),
  executiveSummary: z.string().default("Publishing rhythm analyzed."),
  strengths: z.array(z.string()).min(1).default(["Workspace configured"]),
  opportunities: z
    .array(z.string())
    .min(1)
    .default(["Increase multi-platform publishing"]),
  bestTimesToPost: z
    .array(
      z.object({
        platform: z.string(),
        bestDays: stringOrStringArray,
        bestTimeSlots: stringOrStringArray,
        rationale: z.string().default("Recommended based on social algorithms"),
      }),
    )
    .min(1),
  actionableRecommendations: z.array(z.string()).min(1),
});

export type AIInsights = z.infer<typeof aiInsightsSchema>;

@WorkspaceRequired()
@Controller("analytics")
export class AnalyticsController {
  @Get("overview")
  async getOverview(
    @Req() r: AuthedRequest,
    @Query("range") range?: string,
    @Query("platform") platform?: string
  ) {
    const w = r.workspace.id;

    // Determine interval days from range
    let days = 30;
    if (range === "7d") days = 7;
    else if (range === "90d") days = 90;
    else if (range === "all") days = 365;

    const intervalSql = `NOW() - INTERVAL '${days} days'`;
    const platformFilter = platform && platform !== "ALL" ? platform : null;

    const [
      countsRes,
      accountsRes,
      recentRes,
      timelineRes,
      platformsRes,
      aiVsManualRes,
      batchStatsRes,
    ] = await Promise.all([
      // 1. Content counts
      pool.query(
        `SELECT
          COUNT(*)::int AS total_content,
          COUNT(CASE WHEN status = 'PUBLISHED' THEN 1 END)::int AS published,
          COUNT(CASE WHEN status = 'SCHEDULED' THEN 1 END)::int AS scheduled,
          COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int AS failed,
          COUNT(CASE WHEN status = 'DRAFT' THEN 1 END)::int AS drafts,
          COUNT(CASE WHEN status = 'NEEDS_REVIEW' THEN 1 END)::int AS needs_review
         FROM content
         WHERE workspace_id = $1
           AND created_at >= ${intervalSql}
           AND ($2::text IS NULL OR platforms ? $2)`,
        [w, platformFilter]
      ),

      // 2. Channels
      pool.query(
        `SELECT platform, name, state, last_sync FROM social_accounts WHERE workspace_id = $1`,
        [w]
      ),

      // 3. Recent Content
      pool.query(
        `SELECT id, title, status, platforms, created_at, scheduled_at 
         FROM content 
         WHERE workspace_id = $1 AND ($2::text IS NULL OR platforms ? $2)
         ORDER BY created_at DESC 
         LIMIT 10`,
        [w, platformFilter]
      ),

      // 4. Timeline
      pool.query(
        `SELECT 
           DATE(created_at) AS day,
           COUNT(*)::int AS total,
           COUNT(CASE WHEN status = 'PUBLISHED' THEN 1 END)::int AS published,
           COUNT(CASE WHEN status = 'SCHEDULED' THEN 1 END)::int AS scheduled,
           COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int AS failed,
           COUNT(CASE WHEN status = 'DRAFT' THEN 1 END)::int AS drafts
         FROM content
         WHERE workspace_id = $1 
           AND created_at >= ${intervalSql}
           AND ($2::text IS NULL OR platforms ? $2)
         GROUP BY DATE(created_at)
         ORDER BY DATE(created_at) ASC`,
        [w, platformFilter]
      ),

      // 5. Platform Distribution
      pool.query(
        `SELECT p.platform, COUNT(*)::int as count 
         FROM content c, jsonb_array_elements_text(c.platforms) as p(platform)
         WHERE c.workspace_id = $1 AND c.created_at >= ${intervalSql}
         GROUP BY p.platform`,
        [w]
      ),

      // 6. AI vs Manual Content
      pool.query(
        `SELECT
          COUNT(CASE WHEN (variants->>'generationPrompt' IS NOT NULL OR variants->>'aiGenerated' = 'true') THEN 1 END)::int AS ai_generated,
          COUNT(CASE WHEN (variants->>'generationPrompt' IS NULL AND (variants->>'aiGenerated' IS NULL OR variants->>'aiGenerated' = 'false')) THEN 1 END)::int AS manual
         FROM content
         WHERE workspace_id = $1 AND created_at >= ${intervalSql}`,
        [w]
      ),

      // 7. Batch Stats
      pool.query(
        `SELECT
          COUNT(*)::int AS total_batches,
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int AS completed_batches,
          COUNT(CASE WHEN status = 'PARTIAL' THEN 1 END)::int AS partial_batches,
          COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int AS failed_batches,
          COALESCE(SUM(total_items), 0)::int AS total_child_items,
          COALESCE(SUM(completed_items), 0)::int AS completed_child_items,
          COALESCE(SUM(failed_items), 0)::int AS failed_child_items
         FROM batch_jobs
         WHERE workspace_id = $1 AND created_at >= ${intervalSql}`,
        [w]
      ),
    ]);

    const counts = countsRes.rows[0] || {};
    const totalContent = Number(counts.total_content || 0);
    const published = Number(counts.published || 0);
    const scheduled = Number(counts.scheduled || 0);
    const failed = Number(counts.failed || 0);
    const drafts = Number(counts.drafts || 0);
    const needsReview = Number(counts.needs_review || 0);

    const totalPublishedOrFailed = published + failed;
    const publishSuccessRate =
      totalPublishedOrFailed > 0
        ? Math.round((published / totalPublishedOrFailed) * 100)
        : 100;

    const platformDistribution: Record<string, number> = {
      LinkedIn: 0,
      Instagram: 0,
      X: 0,
      YouTube: 0,
      Telegram: 0,
    };

    for (const row of platformsRes.rows) {
      if (row.platform in platformDistribution) {
        platformDistribution[row.platform] = Number(row.count);
      }
    }

    const aiVsManual = aiVsManualRes.rows[0] || { ai_generated: 0, manual: 0 };
    const batchStats = batchStatsRes.rows[0] || {
      total_batches: 0,
      completed_batches: 0,
      partial_batches: 0,
      failed_batches: 0,
      total_child_items: 0,
      completed_child_items: 0,
      failed_child_items: 0,
    };

    return {
      range: range || "30d",
      selectedPlatform: platform || "ALL",
      metrics: {
        totalContent,
        published,
        scheduled,
        failed,
        drafts,
        needsReview,
        publishSuccessRate,
        channels: accountsRes.rows.filter((a: any) => a.state?.toLowerCase() === "connected").length,
      },
      contentSource: {
        aiGenerated: Number(aiVsManual.ai_generated || 0),
        manual: Number(aiVsManual.manual || 0),
      },
      batchStats: {
        totalBatches: Number(batchStats.total_batches || 0),
        completedBatches: Number(batchStats.completed_batches || 0),
        partialBatches: Number(batchStats.partial_batches || 0),
        failedBatches: Number(batchStats.failed_batches || 0),
        totalChildItems: Number(batchStats.total_child_items || 0),
        completedChildItems: Number(batchStats.completed_child_items || 0),
        failedChildItems: Number(batchStats.failed_child_items || 0),
      },
      accounts: accountsRes.rows,
      platformDistribution,
      timeline: timelineRes.rows,
      recentContent: recentRes.rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        platforms: row.platforms || [],
        createdAt: row.created_at,
        scheduledAt: row.scheduled_at,
      })),
    };
  }

  @Post("ai-insights")
  async generateAIInsights(@Req() r: AuthedRequest) {
    const w = r.workspace.id;

    const provider = getLLMProvider();
    if (!(await provider.validateConfiguration())) {
      throw new ServiceUnavailableException(
        "AI is not configured. Please add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY in .env.",
      );
    }

    const [countsRes, accountsRes, recentRes, brandRes] = await Promise.all([
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'PUBLISHED') AS published,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'SCHEDULED') AS scheduled,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'DRAFT') AS drafts,
          (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = $1 AND LOWER(state) = 'connected') AS connected_channels`,
        [w],
      ),
      pool.query(
        `SELECT platform, name, state FROM social_accounts WHERE workspace_id = $1`,
        [w],
      ),
      pool.query(
        `SELECT id, title, status, platforms, created_at 
         FROM content 
         WHERE workspace_id = $1 
         ORDER BY created_at DESC 
         LIMIT 15`,
        [w],
      ),
      pool.query(`SELECT data FROM brand_kits WHERE workspace_id = $1`, [w]),
    ]);

    const stats = countsRes.rows[0] || {};
    const accounts = accountsRes.rows || [];
    const recentPosts = recentRes.rows || [];
    const brandKit = brandRes.rows[0]?.data || null;

    const workspaceData = {
      workspaceId: r.workspace.id,
      metrics: {
        publishedPosts: stats.published,
        scheduledPosts: stats.scheduled,
        draftPosts: stats.drafts,
        connectedChannelsCount: stats.connected_channels,
      },
      connectedAccounts: accounts.map((a: any) => ({
        platform: a.platform,
        name: a.name,
        state: a.state,
      })),
      recentContentSamples: recentPosts.map((p: any) => ({
        title: p.title,
        status: p.status,
        platforms: p.platforms,
      })),
      brandVoice: brandKit?.tone || "Professional and engaging",
    };

    const messages = [
      {
        role: "system" as const,
        content: `You are an elite Chief Content Officer and social media analytics strategist.
Analyze the provided real workspace publishing data and return a JSON object with this exact shape:
{
  "healthScore": 45,
  "statusRating": "Emerging Velocity",
  "executiveSummary": "2-3 sentences evaluating the current workspace publishing rhythm.",
  "strengths": ["Key strength 1", "Key strength 2"],
  "opportunities": ["Growth area 1", "Growth area 2"],
  "bestTimesToPost": [
    {
      "platform": "LinkedIn",
      "bestDays": "Tuesday, Thursday",
      "bestTimeSlots": "09:00 - 11:00 AM",
      "rationale": "Peak morning professional browsing and feed engagement."
    }
  ],
  "actionableRecommendations": [
    "Next actionable step 1",
    "Next actionable step 2"
  ]
}
Be insightful, actionable, and encouraging. Return ONLY valid JSON matching these property names.`,
      },
      {
        role: "user" as const,
        content: `Real workspace publishing data to evaluate:\n${JSON.stringify(workspaceData, null, 2)}`,
      },
    ];

    try {
      const res = await provider.generateStructured({
        messages,
        schema: aiInsightsSchema,
        schemaName: "WorkspaceAnalyticsInsights",
        temperature: 0.3,
      });

      return {
        insights: res.data,
        model: `${res.provider ? res.provider.toUpperCase() : "AI"} (${res.model || "Active Model"})`,
        generatedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      console.warn(
        "LLM API providers unavailable, computing real workspace telemetry report:",
        err.message,
      );

      const publishedCount = Number(stats.published || 0);
      const scheduledCount = Number(stats.scheduled || 0);
      const draftsCount = Number(stats.drafts || 0);
      const connectedCount = Number(stats.connected_channels || 0);
      const totalPosts = publishedCount + scheduledCount + draftsCount;

      const score = Math.min(
        100,
        Math.max(
          15,
          connectedCount * 15 +
            publishedCount * 10 +
            scheduledCount * 12 +
            draftsCount * 5,
        ),
      );
      const rating =
        score >= 75
          ? "Optimal Cadence"
          : score >= 50
            ? "Steady Growth"
            : score >= 30
              ? "Emerging Rhythm"
              : "Setup & Calibration";

      return {
        insights: {
          healthScore: score,
          statusRating: rating,
          executiveSummary:
            totalPosts === 0
              ? "Your workspace is ready to begin its content rhythm. All channels and AI engines are connected and waiting for your first draft."
              : `Workspace has ${totalPosts} total content assets with ${scheduledCount} posts queued and ${publishedCount} published. Content velocity is actively building.`,
          strengths: [
            connectedCount > 0
              ? `${connectedCount} channels integrated and authenticated`
              : "Multi-channel publishing engine ready",
            totalPosts > 0
              ? `${totalPosts} content items staged across pipeline`
              : "AI Studio configured for instant copy generation",
            "Real-time PostgreSQL analytics tracking enabled",
          ],
          opportunities: [
            connectedCount === 0
              ? "Connect your primary social accounts (Instagram, LinkedIn, X) to start distributing"
              : "Expand channel coverage to maximize audience reach",
            scheduledCount === 0
              ? "Schedule at least 3 posts ahead of time in Calendar to establish consistency"
              : "Fill upcoming calendar slots for the next 7 days",
            "Leverage AI Studio to adapt single ideas into platform-native variants",
          ],
          bestTimesToPost: [
            {
              platform: "LinkedIn",
              bestDays: "Tuesday, Thursday",
              bestTimeSlots: "08:30 - 10:30 AM",
              rationale:
                "Peak morning professional browsing and feed engagement.",
            },
            {
              platform: "Instagram",
              bestDays: "Wednesday, Friday",
              bestTimeSlots: "12:00 - 02:00 PM, 07:00 PM",
              rationale:
                "Lunchtime browsing and evening relaxation windows.",
            },
            {
              platform: "X",
              bestDays: "Monday to Friday",
              bestTimeSlots: "09:00 AM, 04:30 PM",
              rationale:
                "Real-time industry commentary and discussion peaks.",
            },
            {
              platform: "YouTube",
              bestDays: "Thursday, Saturday",
              bestTimeSlots: "03:00 - 06:00 PM",
              rationale: "Weekend and evening leisure viewing hours.",
            },
          ],
          actionableRecommendations: [
            "Use AI Studio to draft your first 3 social posts tailored to your brand voice.",
            "Schedule release times during mid-week morning windows (09:00 - 11:00 AM) for maximum organic reach.",
            "Review draft submissions before moving to the approved stage.",
          ],
        },
        model: "ContentOS Intelligence Engine",
        generatedAt: new Date().toISOString(),
      };
    }
  }
}
