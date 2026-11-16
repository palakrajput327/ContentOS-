import { assertWorkspaceActive } from "../billing/entitlement.service.js";
import { pool } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { BrandDnaService } from "./brand-dna.service.js";
import { ClipdropService } from "../clipdrop/clipdrop.service.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { loadImage, createCanvas } from "@napi-rs/canvas";

export interface CreativeVariation {
  id: string;
  workspaceId: string;
  batchId: string;
  conceptStyle: "PREMIUM_LUXURY" | "MODERN_MINIMAL" | "BOLD_ENGAGEMENT";
  headline: string;
  caption: string;
  cta: string;
  hashtags: string[];
  prompt: string;
  aspectRatio: string;
  assetId?: string | null;
  imageUrl?: string | null;
  rawAssetId?: string | null;
  rawImageUrl?: string | null;
  isSelected: boolean;
  sourceTopic: string;
  sourceDocumentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class CreativeVariationService {
  private brandDnaService = new BrandDnaService();

  /**
   * Generates 3 distinct Instagram creative concepts (Premium, Minimal, Bold) for a topic or document
   */
  async generateThreeVariations(opts: {
    workspaceId: string;
    userId: string;
    topic: string;
    documentId?: string;
  }): Promise<{ batchId: string; variations: CreativeVariation[] }> {
    await assertWorkspaceActive(opts.workspaceId, "creative generation");
    const brandDna = await this.brandDnaService.getBrandDna(opts.workspaceId);
    let contextText = opts.topic.trim();

    if (opts.documentId) {
      const pagesRes = await pool.query(
        `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 8`,
        [opts.documentId, opts.workspaceId]
      );
      if (pagesRes.rowCount) {
        contextText += `\n\nDocument Context:\n${pagesRes.rows.map((p) => p.clean_text).join("\n").slice(0, 3000)}`;
      }
    }

    const primaryColor = brandDna.brandColors[0] || "#f97316";
    const secondaryColor = brandDna.brandColors[1] || "#0f172a";
    const brandTag = brandDna.companyName.replace(/[^a-zA-Z0-9]/g, "");

    const llm = getLLMProvider();
    const prompt = `You are an elite Instagram Creative Strategist and Art Director.
Generate THREE radically distinct, high-performing Instagram creative concepts based on this context and Brand DNA:

Company / Brand: ${brandDna.companyName}
Industry: ${brandDna.industry}
Target Audience: ${brandDna.targetAudience}
Tone: ${brandDna.communicationTone}
Brand Colors: ${brandDna.brandColors.join(", ")}
Website: ${brandDna.websiteDomain}

Context / Idea:
${contextText.slice(0, 3000)}

Generate exactly THREE concepts in valid JSON:
1. "PREMIUM_LUXURY":
   - Visual: Deep obsidian dark background, subtle gold/bronze/metallic accents (${primaryColor}), volumetric cinematic rim lighting, 8k photorealistic studio render, uncluttered composition.
   - Headline: Sophisticated, authoritative, high-status.
   - Caption: Executive insight with bullet points, high value, exclusive tone.
   - CTA: "Swipe to explore the standard" or "Experience the difference".
2. "MODERN_MINIMAL":
   - Visual: Clean geometric glassmorphic layout, crisp architectural composition, neutral charcoal/matte backdrop with soft gradient lighting, ultra-clean aesthetic.
   - Headline: Direct, frictionless, data-driven benefit.
   - Caption: Concise, clear 3-point breakdown with zero fluff.
   - CTA: "Save this framework for later" or "Discover more".
3. "BOLD_ENGAGEMENT":
   - Visual: High-voltage visual punch, dramatic contrasts, vibrant illumination (${primaryColor} and ${secondaryColor}), dynamic perspective, impossible to scroll past.
   - Headline: Provocative question or high-curiosity hook.
   - Caption: Punchy, conversational, question-led, driving comments and shares.
   - CTA: "Drop your take below" or "Tap to claim your spot".

IMPORTANT FLUX.1 Image Prompt Rules:
- Aspect ratio is 4:5 vertical portrait (1080x1350).
- High visual detail, photorealistic or 3D digital art.
- DO NOT draw text, letters, logos, or URLs in the image prompt (approved brand overlays will be composited separately via Canvas).

Return ONLY valid JSON matching this structure:
{
  "variations": [
    {
      "conceptStyle": "PREMIUM_LUXURY",
      "headline": "...",
      "caption": "Multi-paragraph Instagram caption with line breaks...",
      "cta": "...",
      "hashtags": ["#${brandTag}", "#ExecutiveFocus", "#FintechStrategy", "#DigitalAssets"],
      "imagePrompt": "Detailed 4:5 FLUX prompt description..."
    },
    {
      "conceptStyle": "MODERN_MINIMAL",
      "headline": "...",
      "caption": "Multi-paragraph Instagram caption...",
      "cta": "...",
      "hashtags": ["#${brandTag}", "#Simplicity", "#SystemsThinking", "#Growth"],
      "imagePrompt": "Detailed 4:5 FLUX prompt description..."
    },
    {
      "conceptStyle": "BOLD_ENGAGEMENT",
      "headline": "...",
      "caption": "Multi-paragraph Instagram caption...",
      "cta": "...",
      "hashtags": ["#${brandTag}", "#DisruptiveTech", "#Innovation", "#TakeAction"],
      "imagePrompt": "Detailed 4:5 FLUX prompt description..."
    }
  ]
}`;

    let parsedVariations: any[] = [];
    try {
      const res = await llm.generateText({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      const cleaned = (res.text || "").replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      const obj = JSON.parse(cleaned);
      parsedVariations = Array.isArray(obj.variations) ? obj.variations : [];
    } catch (err) {
      console.warn("[CreativeVariation] LLM generation error, using fallback concepts:", err);
    }

    if (parsedVariations.length < 3) {
      parsedVariations = [
        {
          conceptStyle: "PREMIUM_LUXURY",
          headline: `Architecting Sustainable Market Dominance`,
          caption: `True leadership is forged through rigorous verification and precision execution.\n\nKey pillars from the ${brandDna.companyName} strategic framework:\n▪ Verified Performance: Algorithmic transparency across all tiers\n▪ Capital Resilience: Built for high-volume market cycles\n▪ Executive Access: Unrestricted liquidity integration\n\n${brandDna.websiteDomain ? `Explore disclosures at ${brandDna.websiteDomain}` : ""}`,
          cta: "Swipe to review the standard",
          hashtags: [`#${brandTag}`, "#ExecutiveFocus", "#Leadership", "#StrategicAlpha"],
          imagePrompt: `Cinematic executive financial vault with obsidian black metallic architecture, subtle gold glowing data lines (${primaryColor}), volumetric studio lighting, 4:5 vertical composition, photorealistic 8k studio render`,
        },
        {
          conceptStyle: "MODERN_MINIMAL",
          headline: `The 3 Rules of High-Velocity Capital`,
          caption: `Complexity kills momentum. The modern digital enterprise runs on 3 deliberate principles:\n\n1. Transparent validation over speculation\n2. Real-time liquidity settlement\n3. Scalable risk buffers\n\nSave this framework for your next team sprint.\n\n${brandDna.websiteDomain}`,
          cta: "Save this framework for later",
          hashtags: [`#${brandTag}`, "#Minimalism", "#SystemsThinking", "#FintechStrategy"],
          imagePrompt: `Clean minimalist 3D geometric glass prisms reflecting soft ambient illumination, subtle matte slate background, floating translucent UI card elements, photorealistic, 4:5 vertical framing`,
        },
        {
          conceptStyle: "BOLD_ENGAGEMENT",
          headline: `Are You Still Relying on Outdated Growth Models?`,
          caption: `The market has shifted. Static strategies no longer deliver alpha in 2026.\n\nDrop a comment: Which metric does your team prioritize most this quarter?\n👇 A) Throughput Speed\n👇 B) Risk Management\n👇 C) Capital Compounding\n\nFollow @${brandTag.toLowerCase()} for daily executive updates.`,
          cta: "Drop your take below",
          hashtags: [`#${brandTag}`, "#Breakthrough", "#FutureOfFinance", "#HighVelocity"],
          imagePrompt: `Dynamic high-energy visualization of futuristic financial power grid with glowing electric amber sparks (${primaryColor}), dramatic angles, hyper-detailed cyberpunk-inspired fintech engine, 4:5 vertical framing`,
        },
      ];
    }

    const batchId = randomUUID();
    const results: CreativeVariation[] = [];

    for (const v of parsedVariations) {
      const variationId = randomUUID();
      const style = v.conceptStyle || "MODERN_MINIMAL";
      const tags = Array.isArray(v.hashtags) ? v.hashtags : [`#${brandTag}`];
      const captionWithTags = v.caption.includes("#") ? v.caption : `${v.caption}\n\n${tags.join(" ")}`;

      const inserted = await pool.query(
        `INSERT INTO creative_variations (
          id, workspace_id, batch_id, concept_style, headline, caption,
          cta, hashtags, prompt, aspect_ratio, source_topic, source_document_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8::jsonb, $9, '4:5', $10, $11
        ) RETURNING *`,
        [
          variationId,
          opts.workspaceId,
          batchId,
          style,
          v.headline || "Strategic Growth Insight",
          captionWithTags,
          v.cta || "Learn More",
          JSON.stringify(tags),
          v.imagePrompt || v.prompt || "High-tech minimalist artwork, 4:5 vertical",
          opts.topic,
          opts.documentId || null,
        ]
      );
      results.push(this.mapRow(inserted.rows[0]));
    }

    return { batchId, variations: results };
  }

  /**
   * Synthesizes 4:5 Instagram image for a variation and overlays Brand DNA
   */
  async generateVariationImage(opts: {
    variationId: string;
    workspaceId: string;
    userId: string;
    customPrompt?: string;
  }): Promise<{ assetId: string; imageUrl: string; variation: CreativeVariation }> {
    const rowRes = await pool.query(
      `SELECT * FROM creative_variations WHERE id = $1 AND workspace_id = $2`,
      [opts.variationId, opts.workspaceId]
    );
    if (!rowRes.rowCount) throw new NotFoundException("Creative variation not found.");
    const variation = rowRes.rows[0];

    const brandDna = await this.brandDnaService.getBrandDna(opts.workspaceId);
    const promptToUse = opts.customPrompt?.trim() || variation.prompt;

    const clipdropService = new ClipdropService();
    const genResult = await clipdropService.generateImage({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      prompt: `${promptToUse}\nDo not draw text, company logos, words, watermarks or URLs. High aesthetic quality.`,
      aspectRatio: "4:5",
      engine: "flux",
      bypassCache: true,
      headline: variation.headline,
      idempotencyKey: `creative-var:${opts.variationId}:${Date.now()}`,
    });

    const rawAssetId = genResult.assetId;
    const rawImageUrl = genResult.url;

    // Apply Brand DNA Overlay onto the 4:5 visual (1080x1350)
    let finalAssetId = rawAssetId;
    let finalImageUrl = rawImageUrl;

    try {
      const rawRes = await fetch(rawImageUrl);
      const rawBuffer = rawRes.ok ? Buffer.from(await rawRes.arrayBuffer()) : null;

      if (rawBuffer && rawBuffer.length > 0) {
        const bgImg = await loadImage(rawBuffer);
        const canvasW = 1080;
        const canvasH = 1350;
        const canvas = createCanvas(canvasW, canvasH);
        const ctx = canvas.getContext("2d");

        // 1. Draw background image fitted to 4:5
        ctx.drawImage(bgImg, 0, 0, canvasW, canvasH);

        // 2. Subtle top vignette and bottom gradient for clean readability
        const bottomGrad = ctx.createLinearGradient(0, canvasH - 180, 0, canvasH);
        bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
        bottomGrad.addColorStop(1, "rgba(0,0,0,0.65)");
        ctx.fillStyle = bottomGrad;
        ctx.fillRect(0, canvasH - 180, canvasW, 180);

        // 3. Draw Brand Logo (top-right or top-left)
        if (brandDna.logoUrl) {
          try {
            const logoRes = await fetch(brandDna.logoUrl);
            if (logoRes.ok) {
              const logoBuf = Buffer.from(await logoRes.arrayBuffer());
              const logoImg = await loadImage(logoBuf);
              const maxLogoW = 180;
              const maxLogoH = 60;
              const scale = Math.min(maxLogoW / logoImg.width, maxLogoH / logoImg.height, 1);
              const w = logoImg.width * scale;
              const h = logoImg.height * scale;
              const x = canvasW - w - 48;
              const y = 48;

              // Backplate
              ctx.save();
              ctx.fillStyle = "rgba(15, 23, 42, 0.4)";
              ctx.roundRect ? ctx.roundRect(x - 12, y - 8, w + 24, h + 16, 10) : ctx.rect(x - 12, y - 8, w + 24, h + 16);
              ctx.fill();
              ctx.drawImage(logoImg, x, y, w, h);
              ctx.restore();
            }
          } catch {}
        }

        // 4. Draw Domain watermark at bottom center
        if (brandDna.websiteDomain) {
          ctx.save();
          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.font = "bold 20px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(brandDna.websiteDomain.toUpperCase(), canvasW / 2, canvasH - 44);
          ctx.restore();
        }

        const brandedBuf = canvas.toBuffer("image/jpeg", 95);
        const brandedAssetId = randomUUID();
        const { provider, bucket } = getStorageProvider();
        const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${brandedAssetId}/instagram_creative_4x5.jpg`;

        await uploadManagedMedia({
          assetId: brandedAssetId,
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          provider,
          bucket,
          objectKey,
          body: brandedBuf,
          mimeType: "image/jpeg",
          filename: `instagram_creative_${Date.now()}.jpg`,
          type: "GENERATED_ASSET",
          metadata: { variation_id: opts.variationId, branded: true },
        });

        finalAssetId = brandedAssetId;
        finalImageUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 30 * 86400);
      }
    } catch (err) {
      console.warn("[CreativeVariation] Canvas overlay skipped, using raw AI artwork:", err);
    }

    let copy:any;
    try{const {generateImageCaptions}=await import("../ai.controller.js");copy=await generateImageCaptions(opts.workspaceId,opts.userId,rawAssetId,"Instagram",promptToUse);}catch{console.warn("[Creative] Image retained; caption generation can be retried");}
    const updated = await pool.query(
      `UPDATE creative_variations
       SET asset_id = $1, image_url = $2, raw_asset_id = $3, raw_image_url = $4, caption=COALESCE($6,caption),hashtags=COALESCE($7::jsonb,hashtags), updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [finalAssetId, finalImageUrl, rawAssetId, rawImageUrl, opts.variationId,copy?.options?.[0]?.caption||null,copy?.options?.[0]?.hashtags?JSON.stringify(copy.options[0].hashtags):null]
    );

    return {
      assetId: finalAssetId,
      imageUrl: finalImageUrl,
      variation: this.mapRow(updated.rows[0]),
    };
  }

  /**
   * Regenerates a single variation independently while keeping others in the batch
   */
  async regenerateSingleVariation(opts: {
    variationId: string;
    workspaceId: string;
    userId: string;
    customPrompt?: string;
  }): Promise<CreativeVariation> {
    const existing = await pool.query(
      `SELECT * FROM creative_variations WHERE id = $1 AND workspace_id = $2`,
      [opts.variationId, opts.workspaceId]
    );
    if (!existing.rowCount) throw new NotFoundException("Variation not found.");
    const row = existing.rows[0];

    const brandDna = await this.brandDnaService.getBrandDna(opts.workspaceId);
    const llm = getLLMProvider();

    const prompt = `You are an elite Instagram Creative Strategist. Re-roll and generate a fresh, distinctive Instagram concept for:
Style: ${row.concept_style}
Topic / Context: ${row.source_topic}
Brand: ${brandDna.companyName}
Industry: ${brandDna.industry}
Brand Colors: ${brandDna.brandColors.join(", ")}

Generate a new headline, caption, CTA, hashtags, and 4:5 vertical FLUX image prompt.
Return ONLY valid JSON:
{
  "headline": "...",
  "caption": "...",
  "cta": "...",
  "hashtags": ["#Tag1", "#Tag2"],
  "imagePrompt": "..."
}`;

    let parsed: any = {};
    try {
      const res = await llm.generateText({ messages: [{ role: "user", content: prompt }] });
      parsed = JSON.parse((res.text || "").replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim());
    } catch {
      parsed = {
        headline: `${row.concept_style === "PREMIUM_LUXURY" ? "The Sovereign Standard" : row.concept_style === "MODERN_MINIMAL" ? "Frictionless Architecture" : "The Staking Breakthrough"}`,
        caption: `Redefining market expectations with verified discipline.\n\nKey takeaways:\n• Zero unverified assumptions\n• Real-time transparency\n• Compounding velocity`,
        cta: "Explore the Full Framework",
        hashtags: [`#${brandDna.companyName.replace(/[^a-zA-Z0-9]/g, "")}`, "#Alpha", "#Strategy"],
        imagePrompt: `High-fidelity 4:5 vertical artwork, dark obsidian tones, amber accents (${brandDna.brandColors[0] || "#f97316"}), cinematic lighting`,
      };
    }

    const updated = await pool.query(
      `UPDATE creative_variations SET
        headline = $1,
        caption = $2,
        cta = $3,
        hashtags = $4::jsonb,
        prompt = $5,
        asset_id = NULL,
        image_url = NULL,
        raw_asset_id = NULL,
        raw_image_url = NULL,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [
        parsed.headline || row.headline,
        parsed.caption || row.caption,
        parsed.cta || row.cta,
        JSON.stringify(Array.isArray(parsed.hashtags) ? parsed.hashtags : row.hashtags),
        parsed.imagePrompt || parsed.prompt || row.prompt,
        opts.variationId,
      ]
    );

    return this.mapRow(updated.rows[0]);
  }

  /**
   * Converts approved variation into an Instagram draft in ContentOS
   */
  async saveVariationAsInstagramDraft(opts: {
    variationId: string;
    workspaceId: string;
    userId: string;
  }): Promise<{ contentId: string; scheduledPostId: string }> {
    await assertWorkspaceActive(opts.workspaceId, "saving creative content");
    const varRes = await pool.query(
      `SELECT * FROM creative_variations WHERE id = $1 AND workspace_id = $2`,
      [opts.variationId, opts.workspaceId]
    );
    if (!varRes.rowCount) throw new NotFoundException("Creative variation not found.");
    const variation = varRes.rows[0];

    // Mark as selected
    await pool.query(
      `UPDATE creative_variations SET is_selected = (id = $1) WHERE batch_id = $2`,
      [opts.variationId, variation.batch_id]
    );

    const contentId = randomUUID();
    const scheduledPostId = randomUUID();

    // Find Instagram connected account
    const accRes = await pool.query(
      `SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = 'instagram' LIMIT 1`,
      [opts.workspaceId]
    );
    const accountId = accRes.rows[0]?.id;

    // Insert Content row
    await pool.query(
      `INSERT INTO content (
        id, workspace_id, title, body, platforms, status, version, created_by, updated_by, image_asset_id
      ) VALUES (
        $1, $2, $3, $4, '["instagram"]'::jsonb, 'DRAFT', 1, $5, $5, $6
      )`,
      [
        contentId,
        opts.workspaceId,
        `[Instagram Creative] ${variation.headline}`,
        variation.caption,
        opts.userId,
        variation.asset_id || null,
      ]
    );


    return { contentId, scheduledPostId };
  }

  /**
   * Retrieves variations by batchId
   */
  async getBatchVariations(batchId: string, workspaceId: string): Promise<CreativeVariation[]> {
    const res = await pool.query(
      `SELECT * FROM creative_variations WHERE batch_id = $1 AND workspace_id = $2 ORDER BY created_at ASC`,
      [batchId, workspaceId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(r: any): CreativeVariation {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      batchId: r.batch_id,
      conceptStyle: r.concept_style,
      headline: r.headline,
      caption: r.caption,
      cta: r.cta,
      hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
      prompt: r.prompt,
      aspectRatio: r.aspect_ratio || "4:5",
      assetId: r.asset_id || null,
      imageUrl: r.image_url || null,
      rawAssetId: r.raw_asset_id || null,
      rawImageUrl: r.raw_image_url || null,
      isSelected: Boolean(r.is_selected),
      sourceTopic: r.source_topic || "",
      sourceDocumentId: r.source_document_id || null,
      createdAt: r.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: r.updated_at?.toISOString() || new Date().toISOString(),
    };
  }
}
