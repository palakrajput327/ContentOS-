import { pool, type DB } from "../db.js";
import { BadRequestException, NotFoundException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  getFestivalById,
  listFestivalsForYear,
  type FestivalDefinition,
  type FestivalCategory,
  type FestivalRegion,
  type Language,
} from "./festival.data.js";
import {
  uploadFestivalPosterJpegToStorage,
  renderFestivalPosterSvg,
  generateFestivalPosterJpegBuffer,
  type BrandKitInfo,
} from "../auto-poster.js";

export interface FestivalGenerateDraftInput {
  workspaceId: string;
  userId: string;
  festivalId: string;
  year?: number;
  language?: Language;
  customWish?: string;
  targetPlatforms?: string[];
  targetDate?: string; // YYYY-MM-DD override
}

export class FestivalService {
  /**
   * List upcoming festivals for a given year with optional category & region filters
   */
  static listFestivals(
    year?: number,
    options?: { region?: FestivalRegion; category?: FestivalCategory },
  ) {
    const targetYear = year || new Date().getFullYear();
    return listFestivalsForYear(targetYear, options);
  }

  /**
   * Preview a festival poster SVG/JPEG without persisting to DB
   */
  static async previewPoster(
    festivalId: string,
    options?: {
      year?: number;
      language?: Language;
      customWish?: string;
      brandKit?: BrandKitInfo;
    },
  ) {
    const festival = getFestivalById(festivalId);
    if (!festival) {
      throw new NotFoundException(`Festival with ID '${festivalId}' not found.`);
    }

    const year = options?.year || new Date().getFullYear();
    const lang = options?.language || "HINGLISH";
    const langKey = lang === "EN" ? "en" : lang === "HI" ? "hi" : "hinglish";
    const greeting = festival.greetings[langKey];

    const wishText = options?.customWish || greeting.wish;
    const titleText = greeting.title;

    const svg = renderFestivalPosterSvg({
      title: titleText,
      wish: wishText,
      theme: festival.theme,
      brandKit: options?.brandKit,
    });

    const jpegBuffer = await generateFestivalPosterJpegBuffer({
      title: titleText,
      wish: wishText,
      theme: festival.theme,
      brandKit: options?.brandKit,
    });

    return {
      festival,
      year,
      date: festival.dates[year] || null,
      titleText,
      wishText,
      svg,
      jpegBuffer,
    };
  }

  /**
   * Generate a festival poster content draft persisted to DB
   * Prevents duplicate festival drafts for the same workspace, festival, and target date.
   * NEVER auto-publishes immediately.
   */
  static async generateDraft(
    db: DB | typeof pool,
    input: FestivalGenerateDraftInput,
  ) {
    const festival = getFestivalById(input.festivalId);
    if (!festival) {
      throw new NotFoundException(`Festival with ID '${input.festivalId}' not found.`);
    }

    const targetYear = input.year || new Date().getFullYear();
    const targetDate = input.targetDate || festival.dates[targetYear] || `${targetYear}-01-01`;

    // 1. Duplicate Prevention Check
    const existing = await db.query(
      `SELECT id FROM content 
       WHERE workspace_id = $1 
         AND (variants->'metadata'->>'festival_id' = $2 OR title LIKE $3)
         AND (variants->'metadata'->>'target_date' = $4 OR scheduled_at::date = $4::date)
       LIMIT 1`,
      [input.workspaceId, input.festivalId, `%${festival.name}%`, targetDate],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictException(
        `A festival poster draft already exists for '${festival.name}' on ${targetDate} in this workspace.`,
      );
    }

    // 2. Fetch Brand Kit Info
    let brandKit: BrandKitInfo = {};
    try {
      const bkRes = await db.query(
        `SELECT data FROM brand_kits WHERE workspace_id = $1`,
        [input.workspaceId],
      );
      if (bkRes.rows[0]?.data) {
        const d = bkRes.rows[0].data;
        brandKit = {
          companyName: d.companyName || d.name,
          phone: d.phone,
          website: d.website,
          primaryColor: d.primaryColor,
          accentColor: d.accentColor,
        };
      }
    } catch {
      // Fallback if brand_kits table read fails
    }

    // 3. Render and Upload Festival Poster
    const lang = input.language || "HINGLISH";
    const langKey = lang === "EN" ? "en" : lang === "HI" ? "hi" : "hinglish";
    const greeting = festival.greetings[langKey];
    const wishText = input.customWish || greeting.wish;
    const titleText = greeting.title;

    const poster = await uploadFestivalPosterJpegToStorage({
      title: titleText,
      wish: wishText,
      theme: festival.theme,
      brandKit,
    },{workspaceId:input.workspaceId,userId:input.userId,db});

    // 4. Prepare Platforms & Content Payload
    const platforms = input.targetPlatforms || ["Instagram", "Telegram", "LinkedIn"];
    const contentId = randomUUID();
    const postTitle = `${festival.name} (${targetYear}) — Brand Greeting`;
    const postBody = `${titleText}\n\n${wishText}\n\n#${festival.id.replace(/-/g, "")} #${festival.name.replace(/\s+/g, "")} #ContentOS`;

    const variants = {
      mediaUrl: poster.url,
      mediaType: "image",
      metadata: {
        festival_id: festival.id,
        festival_name: festival.name,
        target_date: targetDate,
        language: lang,
        poster_key: poster.key,
        content_source: "INDIAN_FESTIVAL_ENGINE",
      },
    };

    // 5. Insert Content Draft into DB (Status: NEEDS_REVIEW, never published immediately)
    await db.query(
      `INSERT INTO content(
        id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW', $7, $7, $8::timestamptz, NOW(), NOW())`,
      [
        contentId,
        input.workspaceId,
        postTitle,
        postBody,
        JSON.stringify(variants),
        JSON.stringify(platforms),
        input.userId,
        `${targetDate}T09:00:00Z`,
      ],
    );

    return {
      id: contentId,
      workspaceId: input.workspaceId,
      title: postTitle,
      body: postBody,
      mediaUrl: poster.url,
      status: "NEEDS_REVIEW",
      scheduledAt: `${targetDate}T09:00:00Z`,
      platforms,
      metadata: variants.metadata,
    };
  }
}
