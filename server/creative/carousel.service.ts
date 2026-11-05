import { assertWorkspaceActive } from "../billing/entitlement.service.js";
import { pool, transaction } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { BrandDnaService } from "./brand-dna.service.js";
import { ClipdropService } from "../clipdrop/clipdrop.service.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { decryptToken } from "../security.js";
import { publishMeta } from "../meta.publishing.js";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export interface CarouselSlide {
  id: string;
  carouselId: string;
  slideIndex: number;
  slideType: "HOOK" | "CONTENT" | "CTA";
  headline: string;
  bodyText: string;
  badgeText?: string | null;
  prompt: string;
  aspectRatio: string;
  assetId?: string | null;
  imageUrl?: string | null;
  rawAssetId?: string | null;
  rawImageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramCarousel {
  id: string;
  workspaceId: string;
  title: string;
  caption: string;
  aspectRatio: string;
  slideCount: number;
  themeStyle: string;
  status: "DRAFT" | "READY" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  contentId?: string | null;
  sourceDocumentId?: string | null;
  slides: CarouselSlide[];
  createdAt: string;
  updatedAt: string;
}

export class CarouselService {
  private brandDnaService = new BrandDnaService();

  /**
   * Generates a 5-10 slide Instagram carousel from a topic, PDF document, or idea
   */
  async generateCarousel(opts: {
    workspaceId: string;
    userId: string;
    topic: string;
    slideCount?: number; // 5 to 10
    documentId?: string;
    themeStyle?: string;
  }): Promise<InstagramCarousel> {
    await assertWorkspaceActive(opts.workspaceId, "carousel generation");
    const slideCount = Math.max(5, Math.min(10, opts.slideCount || 6));
    const brandDna = await this.brandDnaService.getBrandDna(opts.workspaceId);
    let contextText = opts.topic.trim();

    if (opts.documentId) {
      const pagesRes = await pool.query(
        `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 10`,
        [opts.documentId, opts.workspaceId]
      );
      if (pagesRes.rowCount) {
        contextText += `\n\nDocument Knowledge:\n${pagesRes.rows.map((p) => p.clean_text).join("\n").slice(0, 4000)}`;
      }
    }

    const primaryColor = brandDna.brandColors[0] || "#f97316";
    const brandTag = brandDna.companyName.replace(/[^a-zA-Z0-9]/g, "");

    const llm = getLLMProvider();
    const prompt = `You are a world-class Instagram Carousel Architect and Copywriter.
Create an engaging, high-retention Instagram Carousel with exactly ${slideCount} slides based on this context:

Brand: ${brandDna.companyName}
Industry: ${brandDna.industry}
Audience: ${brandDna.targetAudience}
Tone: ${brandDna.communicationTone}
Website: ${brandDna.websiteDomain}

Context / Idea:
${contextText.slice(0, 3500)}

Structure requirements:
- Slide 1 (HOOK): Irresistible hook question/statement that stops scrolling. Category badge (e.g. "EXECUTIVE PLAYBOOK", "INSIDER GUIDE").
- Slides 2 to ${slideCount - 1} (CONTENT): High-value structured breakdown. Each slide has ONE clear thesis, punchy headline, and 2-3 concise bullet points or 2-sentence explanation.
- Slide ${slideCount} (CTA): Powerful closing call to action. Prompt to save, share, and visit ${brandDna.websiteDomain || "link in bio"}.

Return ONLY valid JSON matching this structure:
{
  "carouselTitle": "A catchy title for this carousel",
  "caption": "Full Instagram caption introducing the carousel with bullet points, CTA to swipe, and curated hashtags...",
  "slides": [
    {
      "slideIndex": 0,
      "slideType": "HOOK",
      "badgeText": "THE 2026 STRATEGY",
      "headline": "Stop Relying on Outdated Playbooks.",
      "bodyText": "Swipe to discover the 5 verified levers top teams use to scale throughput without burning capital.",
      "visualPrompt": "Abstract dark obsidian digital glass architecture, amber glow (${primaryColor}), 4:5 vertical"
    },
    ... (total ${slideCount} slides)
    {
      "slideIndex": ${slideCount - 1},
      "slideType": "CTA",
      "badgeText": "WHAT'S NEXT",
      "headline": "Ready to Transform Your Workflow?",
      "bodyText": "Save this carousel for your next review.\\n\\nVisit ${brandDna.websiteDomain || "our website"} to access complete frameworks.",
      "visualPrompt": "Minimal dark background with soft radiant gradient, 4:5 vertical"
    }
  ]
}`;

    let parsed: any = {};
    try {
      const res = await llm.generateText({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      const cleaned = (res.text || "").replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.warn("[CarouselService] LLM parse error, generating structured fallback slides:", err);
    }

    const title = parsed.carouselTitle || `Executive Guide: ${opts.topic.slice(0, 40)}`;
    const caption = parsed.caption || `📊 Strategic Breakdown: ${title}\n\nSwipe through for verified principles.\n\nSave this for your next strategy session!\n\n#${brandTag} #InstagramGrowth #ExecutiveInsights`;

    const carouselId = randomUUID();
    await pool.query(
      `INSERT INTO instagram_carousels (
        id, workspace_id, title, caption, aspect_ratio, slide_count, theme_style, status, source_document_id
      ) VALUES (
        $1, $2, $3, $4, '4:5', $5, $6, 'DRAFT', $7
      )`,
      [
        carouselId,
        opts.workspaceId,
        title,
        caption,
        slideCount,
        opts.themeStyle || "MODERN_MINIMAL",
        opts.documentId || null,
      ]
    );

    let rawSlides: any[] = Array.isArray(parsed.slides) ? parsed.slides : [];
    if (rawSlides.length < slideCount) {
      // Build default structured slides to guarantee exact count
      rawSlides = [
        {
          slideIndex: 0,
          slideType: "HOOK",
          badgeText: "FRAMEWORK GUIDE",
          headline: `Architecting Predictable Growth in 2026`,
          bodyText: "Swipe to discover the 4 foundational principles driving sustainable enterprise momentum.",
          visualPrompt: `Sleek obsidian tech background with radiant amber accents (${primaryColor})`,
        },
        {
          slideIndex: 1,
          slideType: "CONTENT",
          badgeText: "PILLAR 01",
          headline: "Clarity Precedes Velocity",
          bodyText: "High-performing operations remove friction by standardizing workflows and verifying checkpoints early.",
          visualPrompt: "Clean geometric translucent glass layers, 4:5 vertical",
        },
        {
          slideIndex: 2,
          slideType: "CONTENT",
          badgeText: "PILLAR 02",
          headline: "Algorithmic Consistency",
          bodyText: "Compounding growth is mathematical. Regular execution cycles outperform intermittent bursts every quarter.",
          visualPrompt: "Data visualization curves with golden ambient light, 4:5 vertical",
        },
        {
          slideIndex: 3,
          slideType: "CONTENT",
          badgeText: "PILLAR 03",
          headline: "Real-Time Risk Guardrails",
          bodyText: "Protect your downside before chasing upside. Transparent verification establishes defensible market leadership.",
          visualPrompt: "Futuristic shield matrix with glowing circuit pathways, 4:5 vertical",
        },
        {
          slideIndex: 4,
          slideType: "CTA",
          badgeText: "TAKE ACTION",
          headline: `Elevate Your Strategy with ${brandDna.companyName}`,
          bodyText: `Save this post for reference.\n\nExplore our complete documentation and disclosures at ${brandDna.websiteDomain || "our official portal"}.`,
          visualPrompt: "Minimal dark background with warm rim illumination, 4:5 vertical",
        },
      ];
    }

    const createdSlides: CarouselSlide[] = [];
    const totalToCreate = Math.min(rawSlides.length, slideCount);
    for (let i = 0; i < totalToCreate; i++) {
      const s = rawSlides[i];
      const slideId = randomUUID();
      const slideType = i === 0 ? "HOOK" : i === totalToCreate - 1 ? "CTA" : (s.slideType || "CONTENT");

      const slideRes = await pool.query(
        `INSERT INTO instagram_carousel_slides (
          id, carousel_id, slide_index, slide_type, headline, body_text,
          badge_text, prompt, aspect_ratio
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, '4:5'
        ) RETURNING *`,
        [
          slideId,
          carouselId,
          i + 1,
          slideType,
          s.headline || `Key Takeaway #${i + 1}`,
          s.bodyText || "",
          s.badgeText || `SLIDE ${i + 1}`,
          s.visualPrompt || s.prompt || "Minimal geometric background 4:5",
        ]
      );
      createdSlides.push(this.mapSlideRow(slideRes.rows[0]));
    }

    return {
      id: carouselId,
      workspaceId: opts.workspaceId,
      title,
      caption,
      aspectRatio: "4:5",
      slideCount: createdSlides.length,
      themeStyle: opts.themeStyle || "MODERN_MINIMAL",
      status: "DRAFT",
      slides: createdSlides,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Renders an individual slide to a high-resolution 1080x1350 canvas image
   */
  async renderSlideCanvas(opts: {
    slideId: string;
    workspaceId: string;
    userId: string;
    generateBgArt?: boolean;
  }): Promise<{ assetId: string; imageUrl: string; slide: CarouselSlide }> {
    const slideRes = await pool.query(
      `SELECT s.*, c.workspace_id, c.slide_count FROM instagram_carousel_slides s
       JOIN instagram_carousels c ON c.id = s.carousel_id
       WHERE s.id = $1 AND c.workspace_id = $2`,
      [opts.slideId, opts.workspaceId]
    );
    if (!slideRes.rowCount) throw new NotFoundException("Slide not found.");
    const slide = slideRes.rows[0];

    const brandDna = await this.brandDnaService.getBrandDna(opts.workspaceId);
    const canvasW = 1080;
    const canvasH = 1350;
    const canvas = createCanvas(canvasW, canvasH);
    const ctx = canvas.getContext("2d");

    const primaryColor = brandDna.brandColors[0] || "#f97316";
    const darkBg = "#0b0f19";

    // 1. Render Background: either AI generated artwork or rich gradient backdrop
    let bgRendered = false;
    if (opts.generateBgArt) {
      try {
        const clipdrop = new ClipdropService();
        const genRes = await clipdrop.generateImage({
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          prompt: `${slide.prompt}, dark moody aesthetic, subtle lighting, clean 4:5 vertical composition. Zero text, no letters.`,
          aspectRatio: "4:5",
          engine: "flux",
        });
        const rawRes = await fetch(genRes.url);
        if (rawRes.ok) {
          const buf = Buffer.from(await rawRes.arrayBuffer());
          const img = await loadImage(buf);
          ctx.drawImage(img, 0, 0, canvasW, canvasH);
          // Dark overlay for text legibility
          ctx.fillStyle = "rgba(11, 15, 25, 0.72)";
          ctx.fillRect(0, 0, canvasW, canvasH);
          bgRendered = true;
        }
      } catch (err) {
        console.warn("[CarouselService] Background diffusion skipped, using canvas gradient:", err);
      }
    }

    if (!bgRendered) {
      // Premium dark graphite gradient with subtle ambient glow
      const grad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
      grad.addColorStop(0, "#0b0f19");
      grad.addColorStop(0.5, "#111827");
      grad.addColorStop(1, "#030712");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Subtle ambient radial glow in accent color
      const radial = ctx.createRadialGradient(canvasW * 0.8, canvasH * 0.2, 50, canvasW * 0.8, canvasH * 0.2, 500);
      radial.addColorStop(0, `${primaryColor}22`);
      radial.addColorStop(1, "transparent");
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    // 2. Safe Margins
    const margin = 72;
    const contentW = canvasW - margin * 2;

    // 3. Header Area: Slide Counter & Brand Logo
    const currentSlideNum = String(slide.slide_index + 1).padStart(2, "0");
    const totalSlideNum = String(slide.slide_count || 5).padStart(2, "0");

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "600 24px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${currentSlideNum} / ${totalSlideNum}`, margin, margin + 20);

    // Brand Logo or Company Name on header right
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(brandDna.companyName.toUpperCase(), canvasW - margin, margin + 20);
    ctx.restore();

    // 4. Badge Tag (e.g. "EXECUTIVE PLAYBOOK" or "PILLAR 01")
    const badgeText = (slide.badge_text || (slide.slide_type === "HOOK" ? "INSIDER STRATEGY" : `STEP ${slide.slide_index + 1}`)).toUpperCase();
    ctx.save();
    ctx.font = "bold 20px sans-serif";
    const badgeWidth = ctx.measureText(badgeText).width + 36;
    const badgeHeight = 44;
    const badgeY = margin + 110;

    // Badge background pill
    ctx.fillStyle = "rgba(249, 115, 22, 0.18)";
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(margin, badgeY, badgeWidth, badgeHeight, 22) : ctx.rect(margin, badgeY, badgeWidth, badgeHeight);
    ctx.fill();
    ctx.stroke();

    // Badge text
    ctx.fillStyle = primaryColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, margin + badgeWidth / 2, badgeY + badgeHeight / 2);
    ctx.restore();

    // 5. Headline Text (Large, sharp, word-wrapped)
    ctx.save();
    ctx.fillStyle = "#ffffff";
    const headlineFontSize = slide.slide_type === "HOOK" ? 64 : 52;
    ctx.font = `bold ${headlineFontSize}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const headlineY = badgeY + badgeHeight + 48;
    const headlineLines = this.wrapText(ctx, slide.headline, contentW);
    let currentY = headlineY;

    for (const line of headlineLines.slice(0, 4)) {
      ctx.fillText(line, margin, currentY);
      currentY += headlineFontSize * 1.25;
    }
    ctx.restore();

    // 6. Body Text / Bullets
    if (slide.body_text) {
      ctx.save();
      ctx.fillStyle = "rgba(226, 232, 240, 0.88)";
      ctx.font = "32px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      const bodyY = currentY + 36;
      const bodyParagraphs = slide.body_text.split(/\n+/);
      let bY = bodyY;

      for (const p of bodyParagraphs) {
        const lines = this.wrapText(ctx, p.trim(), contentW);
        for (const line of lines) {
          if (bY > canvasH - 160) break;
          ctx.fillText(line, margin, bY);
          bY += 46;
        }
        bY += 18;
      }
      ctx.restore();
    }

    // 7. Footer: Swipe Indicator & Website Domain
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, canvasH - 100);
    ctx.lineTo(canvasW - margin, canvasH - 100);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (brandDna.websiteDomain) {
      ctx.fillText(brandDna.websiteDomain.toLowerCase(), margin, canvasH - 56);
    }

    if (slide.slide_type !== "CTA") {
      ctx.textAlign = "right";
      ctx.fillStyle = primaryColor;
      ctx.fillText("SWIPE ➔", canvasW - margin, canvasH - 56);
    } else {
      ctx.textAlign = "right";
      ctx.fillStyle = primaryColor;
      ctx.fillText("TAP TO SAVE 📌", canvasW - margin, canvasH - 56);
    }
    ctx.restore();

    // 8. Upload rendered slide
    const slideBuffer = canvas.toBuffer("image/jpeg", 95);
    const assetId = randomUUID();
    const { provider, bucket } = getStorageProvider();
    const objectKey = `workspaces/${opts.workspaceId}/carousels/${slide.carousel_id}/slide_${slide.slide_index + 1}_${assetId}.jpg`;

    await uploadManagedMedia({
      assetId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      provider,
      bucket,
      objectKey,
      body: slideBuffer,
      mimeType: "image/jpeg",
      filename: `carousel_slide_${slide.slide_index + 1}.jpg`,
      type: "GENERATED_ASSET",
      metadata: { carousel_id: slide.carousel_id, slide_id: opts.slideId },
    });

    const imageUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 30 * 86400);

    const updated = await pool.query(
      `UPDATE instagram_carousel_slides
       SET asset_id = $1, image_url = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [assetId, imageUrl, opts.slideId]
    );

    return {
      assetId,
      imageUrl,
      slide: this.mapSlideRow(updated.rows[0]),
    };
  }

  /**
   * Renders all slides in a carousel in sequence
   */
  async renderAllSlides(opts: {
    carouselId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ renderedCount: number; slides: CarouselSlide[] }> {
    await this.getCarousel(opts.carouselId, opts.workspaceId);
    const slidesRes = await pool.query(
      `SELECT id FROM instagram_carousel_slides WHERE carousel_id = $1 ORDER BY slide_index ASC`,
      [opts.carouselId]
    );

    const renderedSlides: CarouselSlide[] = [];
    for (const s of slidesRes.rows) {
      const res = await this.renderSlideCanvas({
        slideId: s.id,
        workspaceId: opts.workspaceId,
        userId: opts.userId,
        generateBgArt: false, // Fast, reliable native Canvas layout
      });
      renderedSlides.push(res.slide);
    }

    await pool.query(
      `UPDATE instagram_carousels SET status = 'READY', updated_at = NOW() WHERE id = $1`,
      [opts.carouselId]
    );

    return { renderedCount: renderedSlides.length, slides: renderedSlides };
  }

  /**
   * Reorders slides within a carousel
   */
  async reorderSlides(opts: {
    carouselId: string;
    workspaceId: string;
    orderedSlideIds: string[];
  }): Promise<CarouselSlide[]> {
    await this.getCarousel(opts.carouselId, opts.workspaceId);
    // Phase 1: Set temporary negative indices to avoid unique constraint collisions
    for (let i = 0; i < opts.orderedSlideIds.length; i++) {
      await pool.query(
        `UPDATE instagram_carousel_slides SET slide_index = $1 WHERE id = $2 AND carousel_id = $3`,
        [-(i + 1), opts.orderedSlideIds[i], opts.carouselId]
      );
    }
    // Phase 2: Set final 1-based positive indices
    for (let i = 0; i < opts.orderedSlideIds.length; i++) {
      await pool.query(
        `UPDATE instagram_carousel_slides SET slide_index = $1, updated_at = NOW() WHERE id = $2 AND carousel_id = $3`,
        [i + 1, opts.orderedSlideIds[i], opts.carouselId]
      );
    }
    const res = await pool.query(
      `SELECT * FROM instagram_carousel_slides WHERE carousel_id = $1 ORDER BY slide_index ASC`,
      [opts.carouselId]
    );
    return res.rows.map((r) => this.mapSlideRow(r));
  }

  /**
   * Updates an individual slide's content
   */
  async updateSlide(opts: {
    slideId: string;
    carouselId: string;
    workspaceId: string;
    headline?: string;
    bodyText?: string;
    badgeText?: string;
  }): Promise<CarouselSlide> {
    await this.getCarousel(opts.carouselId, opts.workspaceId);
    const res = await pool.query(
      `UPDATE instagram_carousel_slides SET
        headline = COALESCE($1, headline),
        body_text = COALESCE($2, body_text),
        badge_text = COALESCE($3, badge_text),
        updated_at = NOW()
      WHERE id = $4 AND carousel_id = $5
      RETURNING *`,
      [opts.headline, opts.bodyText, opts.badgeText, opts.slideId, opts.carouselId]
    );
    if (!res.rowCount) throw new NotFoundException("Slide not found.");
    return this.mapSlideRow(res.rows[0]);
  }

  /**
   * Converts the multi-slide carousel into an Instagram draft post in ContentOS
   */
  async saveCarouselAsInstagramDraft(opts: {
    carouselId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ contentId: string; scheduledPostId: string; mediaCount: number }> {
    await assertWorkspaceActive(opts.workspaceId, "saving carousel content");
    return transaction(async db => {
      const carousel = (await db.query("SELECT * FROM instagram_carousels WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [opts.carouselId,opts.workspaceId])).rows[0];
      if (!carousel) throw new NotFoundException("Carousel not found.");
      const slides = (await db.query("SELECT image_url,asset_id FROM instagram_carousel_slides WHERE carousel_id=$1 ORDER BY slide_index",[opts.carouselId])).rows;
      const mediaUrls = slides.map(s=>s.image_url).filter(Boolean);
      if (!mediaUrls.length || mediaUrls.length !== slides.length) throw new BadRequestException("Render every slide before saving.");
      if (carousel.content_id && (await db.query("SELECT id FROM content WHERE id=$1 AND workspace_id=$2",[carousel.content_id,opts.workspaceId])).rowCount)
        return {contentId:carousel.content_id,scheduledPostId:"",mediaCount:mediaUrls.length};
      const contentId = randomUUID();
      await db.query("INSERT INTO content(id,workspace_id,title,body,platforms,status,version,created_by,updated_by,variants,image_asset_id) VALUES($1,$2,$3,$4,'[\"Instagram\"]'::jsonb,'DRAFT',1,$5,$5,$6::jsonb,$7)",
        [contentId,opts.workspaceId,carousel.title,carousel.caption,opts.userId,JSON.stringify({Instagram:{caption:carousel.caption,mediaUrl:mediaUrls[0],mediaType:'image',metadata:{mediaUrls,isCarousel:true}}}),slides[0]?.asset_id]);
      await db.query("INSERT INTO content_versions(id,workspace_id,content_id,version,snapshot,created_by) SELECT $1,workspace_id,id,version,to_jsonb(content),$2 FROM content WHERE id=$3",[randomUUID(),opts.userId,contentId]);
      await db.query("UPDATE instagram_carousels SET content_id=$1,status='READY',updated_at=now() WHERE id=$2 AND workspace_id=$3",[contentId,opts.carouselId,opts.workspaceId]);
      return {contentId,scheduledPostId:"",mediaCount:mediaUrls.length};
    });
  }

  /**
   * Publishes the carousel immediately to Instagram if account is connected
   */
  async publishCarouselNow(opts: {
    carouselId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ success: boolean; publishedPostId?: string; reason?: string }> {
    await this.getCarousel(opts.carouselId, opts.workspaceId);
    await assertWorkspaceActive(opts.workspaceId, "carousel publishing");
    const {contentId} = await this.saveCarouselAsInstagramDraft(opts);
    const account = (await pool.query("SELECT id FROM social_accounts WHERE workspace_id=$1 AND lower(platform)='instagram' AND lower(state)='connected' LIMIT 1",[opts.workspaceId])).rows[0];
    if (!account) return {success:false,reason:"Connect a healthy Instagram account. Content retained in Library."};
    const {publishContentNow} = await import("../publishing.js");
    const result = await publishContentNow(opts.workspaceId,opts.userId,contentId,account.id);
    if (result.success) await pool.query("UPDATE instagram_carousels SET status='PUBLISHED',updated_at=now() WHERE id=$1 AND workspace_id=$2",[opts.carouselId,opts.workspaceId]);
    return {success:result.success,publishedPostId:result.providerPostId,reason:result.error};
  }

  /**
   * Retrieves a carousel with all its ordered slides
   */
  async getCarousel(carouselId: string, workspaceId: string): Promise<InstagramCarousel> {
    const carRes = await pool.query(
      `SELECT * FROM instagram_carousels WHERE id = $1 AND workspace_id = $2`,
      [carouselId, workspaceId]
    );
    if (!carRes.rowCount) throw new NotFoundException("Carousel not found.");

    const slidesRes = await pool.query(
      `SELECT * FROM instagram_carousel_slides WHERE carousel_id = $1 ORDER BY slide_index ASC`,
      [carouselId]
    );

    const r = carRes.rows[0];
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      caption: r.caption,
      aspectRatio: r.aspect_ratio || "4:5",
      slideCount: slidesRes.rowCount ?? 0,
      themeStyle: r.theme_style || "MODERN_MINIMAL",
      status: r.status || "DRAFT",
      contentId: r.content_id || null,
      sourceDocumentId: r.source_document_id || null,
      slides: slidesRes.rows.map((s) => this.mapSlideRow(s)),
      createdAt: r.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: r.updated_at?.toISOString() || new Date().toISOString(),
    };
  }

  /**
   * Lists all carousels in workspace
   */
  async listCarousels(workspaceId: string): Promise<InstagramCarousel[]> {
    const res = await pool.query(
      `SELECT * FROM instagram_carousels WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [workspaceId]
    );

    const carousels: InstagramCarousel[] = [];
    for (const r of res.rows) {
      const slidesRes = await pool.query(
        `SELECT * FROM instagram_carousel_slides WHERE carousel_id = $1 ORDER BY slide_index ASC`,
        [r.id]
      );
      carousels.push({
        id: r.id,
        workspaceId: r.workspace_id,
        title: r.title,
        caption: r.caption,
        aspectRatio: r.aspect_ratio || "4:5",
        slideCount: slidesRes.rowCount ?? 0,
        themeStyle: r.theme_style || "MODERN_MINIMAL",
        status: r.status || "DRAFT",
        contentId: r.content_id || null,
        sourceDocumentId: r.source_document_id || null,
        slides: slidesRes.rows.map((s) => this.mapSlideRow(s)),
        createdAt: r.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: r.updated_at?.toISOString() || new Date().toISOString(),
      });
    }

    return carousels;
  }

  private mapSlideRow(r: any): CarouselSlide {
    return {
      id: r.id,
      carouselId: r.carousel_id,
      slideIndex: r.slide_index,
      slideType: r.slide_type,
      headline: r.headline,
      bodyText: r.body_text || "",
      badgeText: r.badge_text || null,
      prompt: r.prompt || "",
      aspectRatio: r.aspect_ratio || "4:5",
      assetId: r.asset_id || null,
      imageUrl: r.image_url || null,
      rawAssetId: r.raw_asset_id || null,
      rawImageUrl: r.raw_image_url || null,
      createdAt: r.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: r.updated_at?.toISOString() || new Date().toISOString(),
    };
  }

  private wrapText(ctx: any, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }
}
