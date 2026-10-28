import { Injectable, BadRequestException, ServiceUnavailableException, NotFoundException } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import { pool, transaction, audit } from "../db.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { z } from "zod";
import { ImagePromptArchitect, StructuredVisualSpecification } from "../ai/prompt-architect.js";
import { BusinessProfileService } from "../knowledge/business-profile.service.js";
import type { ImageGenerator, ImageGenerationInput, ImageGenerationOutput } from "../ai/image-generator.interface.js";

export interface GenerateImageOptions {
  workspaceId: string;
  userId: string;
  prompt: string;
  engine?: "clipdrop" | "flux";
  stylePreset?: string;
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
  headline?: string;
  logoText?: string;
  websiteUrl?: string;
  cta?: string;
  enableOverlay?: boolean;
  contentId?: string;
  platform?: string;
  idempotencyKey?: string;
}

export interface RemoveBackgroundOptions {
  workspaceId: string;
  userId: string;
  assetId?: string;
  fileBuffer?: Buffer;
  filename?: string;
  mimeType?: string;
}

export interface AttachAndSaveOptions {
  workspaceId: string;
  userId: string;
  contentId?: string;
  title: string;
  body: string;
  platforms: string[];
  assetId: string;
  mediaUrl: string;
  status?: "DRAFT" | "NEEDS_REVIEW";
}

@Injectable()
export class ClipdropService implements ImageGenerator {
  readonly providerName = "clipdrop";

  async generate(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const res = await this.generateImage({
      workspaceId: input.workspaceId,
      userId: input.userId || "",
      prompt: input.prompt,
      headline: input.headline,
      aspectRatio: (input.aspectRatio as any) || "1:1",
      platform: input.platform,
      contentId: input.contentId,
      enableOverlay: input.brandOverlay,
    });
    return {
      assetUrl: res.url,
      assetId: res.assetId,
      provider: res.engine || "clipdrop",
      providerJobId: (res as any).providerJobId || res.assetId,
      promptHash: createHash("sha256").update(input.prompt).digest("hex"),
      generatedAt: new Date().toISOString(),
    };
  }

  private getApiKey(): string | null {
    const key = process.env.CLIPDROP_API_KEY;
    return key && key.trim() ? key.trim() : null;
  }

  /**
   * Generates a platform-optimized visual prompt using ImagePromptArchitect
   */
  async suggestPrompt(contentText: string, platform?: string, contextInfo?: string): Promise<{ prompt: string; headline?: string; spec?: StructuredVisualSpecification }> {
    const architect = new ImagePromptArchitect();
    const spec = await architect.generateSpecification({
      knowledgeConcept: contentText,
      platform,
      documentName: contextInfo,
    });
    return { prompt: spec.generationPrompt, headline: spec.headline, spec };
  }

  /**
   * Generates a structured, brand-aware visual poster prompt using the 9-part Image Prompt Architect & Business Profile
   */
  async suggestPosterPrompt(opts: {
    knowledgeConcept: string;
    excerpt?: string;
    sourceVisualContext?: string;
    title?: string;
    documentName?: string;
    documentId?: string;
    workspaceId?: string;
    brand?: {
      primary_color?: string;
      secondary_color?: string;
      tone?: string;
      name?: string;
      cta?: string;
    };
    platform?: string;
    aspectRatio?: string;
  }): Promise<{ prompt: string; headline: string; spec?: StructuredVisualSpecification }> {
    let brandProfile = undefined;
    if (opts.documentId && opts.workspaceId) {
      try {
        const bpService = new BusinessProfileService();
        brandProfile = await bpService.getOrBuildProfile(opts.documentId, opts.workspaceId);
      } catch (err: any) {
        console.warn("[suggestPosterPrompt] Profile loading fallback:", err.message || err);
      }
    }

    const architect = new ImagePromptArchitect();
    const spec = await architect.generateSpecification({
      knowledgeConcept: opts.knowledgeConcept,
      excerpt: opts.excerpt,
      title: opts.title,
      documentName: opts.documentName,
      platform: opts.platform,
      aspectRatio: opts.aspectRatio,
      brandProfile: brandProfile || {
        companyName: opts.brand?.name || opts.documentName?.replace(/\.[^/.]+$/, ""),
        brandColors: opts.brand?.primary_color ? [opts.brand.primary_color] : [],
        visualPersonality: opts.brand?.tone,
      },
    });

    return {
      prompt: spec.generationPrompt,
      headline: spec.headline,
      spec,
    };
  }

  /**
   * Generates image via Clipdrop API or FLUX.1 Pro, applies optional brand overlay,
   * saves as media asset, and links to content draft.
   */
  async generateImage(opts: GenerateImageOptions) {
    const aspectRatio = opts.aspectRatio || "1:1";
    const requestedEngine = opts.engine || "clipdrop";
    // 1. Intelligent Prompt Optimization & Entity Extraction (ChatGPT / Gemini style)
    const { visualPrompt, extractedHeadline, extractedCompany } = this.cleanAndOptimizePrompt(opts.prompt);

    const headline = opts.headline || extractedHeadline;
    const logoText = opts.logoText || extractedCompany;
    const enableOverlay = Boolean(opts.enableOverlay);

    // Style presets modifier - only enrich if prompt lacks explicit visual styling
    let finalPrompt = visualPrompt;
    const hasExistingStyle = /cinematic|photography|photo|render|illustration|cyberpunk|macro|lens|lighting|bokeh|aesthetic|high-contrast/i.test(visualPrompt);
    if (opts.stylePreset && !hasExistingStyle) {
      switch (opts.stylePreset) {
        case "3d-render":
          finalPrompt += ", 3D digital render, volumetric rim lighting, clean composition";
          break;
        case "cinematic":
          finalPrompt += ", cinematic photography, dramatic rim lighting, depth of field";
          break;
        case "minimal-saas":
          finalPrompt += ", modern minimal vector illustration, sleek pastel gradients";
          break;
        case "cyberpunk":
          finalPrompt += ", futuristic cyberpunk aesthetic, neon lights, dark moody lighting";
          break;
        case "editorial":
          finalPrompt += ", high-fashion editorial magazine cover visual, sophisticated art";
          break;
      }
    }

    // Aspect ratio composition instructions
    if (aspectRatio === "16:9") finalPrompt += ", 16:9 widescreen composition";
    else if (aspectRatio === "9:16") finalPrompt += ", 9:16 vertical story composition";
    else if (aspectRatio === "4:5") finalPrompt += ", 4:5 vertical portrait composition";
    else finalPrompt += ", 1:1 square centered composition";

    // 2. Idempotency Check
    const rawKey = opts.idempotencyKey || `${opts.workspaceId}:${finalPrompt}:${aspectRatio}:${enableOverlay ? headline || "" : "raw"}:${opts.contentId || ""}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const existingAssetRes = await pool.query(
      `SELECT * FROM media_assets 
       WHERE workspace_id = $1 
         AND deleted_at IS NULL AND status='COMPLETED'
         AND mime_type != 'image/svg+xml'
         AND metadata->>'idempotency_key' = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [opts.workspaceId, keyHash]
    );

    if (existingAssetRes.rowCount) {
      const asset = existingAssetRes.rows[0];
      const { provider } = getStorageProvider();

      let fileExists = true;
      try {
        const uploadBase = process.env.STORAGE_LOCAL_DIR || path.resolve(process.cwd(), "uploads");
        const fullLocalPath = path.resolve(uploadBase, asset.bucket, asset.object_key);
        const fsMod = await import("node:fs");
        if (!fsMod.existsSync(fullLocalPath)) {
          fileExists = false;
        }
      } catch {
        fileExists = false;
      }

      if (fileExists) {
        const downloadUrl = await provider.getSignedDownloadUrl(asset.bucket, asset.object_key, 30 * 86400);

        if (opts.contentId) {
          await this.attachAssetToContent(opts.workspaceId, opts.contentId, asset.id, downloadUrl, opts.userId, opts.platform);
        }

        return {
          assetId: asset.id,
          url: downloadUrl,
          filename: asset.original_filename,
          mimeType: asset.mime_type,
          remainingCredits: asset.metadata?.remaining_credits ?? null,
          cached: true,
          engine: asset.metadata?.engine || requestedEngine,
          contentId: opts.contentId,
          status: opts.contentId ? "NEEDS_REVIEW" : asset.status,
          extractedCompany,
          extractedHeadline,
          promptHash: keyHash,
          prompt: finalPrompt,
        };
      }
    }

    // 2. Execute Image Generation with Bidirectional Fallback
    let imageBuffer: Buffer | null = null;
    let mimeType = "image/png";
    let usedEngine = requestedEngine;
    let remainingCredits: number | null = null;

    const clipdropKey = this.getApiKey();

    const tryClipdrop = async (): Promise<boolean> => {
      if (!clipdropKey) return false;
      try {
        const formData = new FormData();
        formData.append("prompt", finalPrompt);

        const res = await fetch("https://clipdrop-api.co/text-to-image/v1", {
          method: "POST",
          headers: { "x-api-key": clipdropKey },
          body: formData,
          signal: AbortSignal.timeout(35000),
        });

        const creditsHdr = res.headers.get("x-remaining-credits") || res.headers.get("x-credit-count");
        remainingCredits = creditsHdr ? parseInt(creditsHdr, 10) : null;

        if (res.ok) {
          const arr = await res.arrayBuffer();
          imageBuffer = Buffer.from(new Uint8Array(arr));
          mimeType = res.headers.get("content-type") || "image/png";
          usedEngine = "clipdrop";
          return true;
        } else {
          console.warn(`Clipdrop API returned status ${res.status}`);
        }
      } catch (err: any) {
        console.warn("Clipdrop API call failed:", err?.message || err);
      }
      return false;
    };

    const tryFlux = async (): Promise<boolean> => {
      let width = 1024;
      let height = 1024;
      if (aspectRatio === "16:9") { width = 1280; height = 720; }
      else if (aspectRatio === "9:16") { width = 720; height = 1280; }
      else if (aspectRatio === "4:5") { width = 1024; height = 1280; }

      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        finalPrompt
      )}?width=${width}&height=${height}&model=flux&nologo=true`;

      try {
        const res = await fetch(pollinationsUrl, { signal: AbortSignal.timeout(35000) });
        if (res.ok) {
          const arr = await res.arrayBuffer();
          imageBuffer = Buffer.from(new Uint8Array(arr));
          mimeType = res.headers.get("content-type") || "image/jpeg";
          usedEngine = "flux";
          return true;
        } else {
          console.warn(`FLUX image generation returned HTTP ${res.status}`);
        }
      } catch (err: any) {
        console.warn("FLUX image generation error:", err?.message || err);
      }
      return false;
    };

    if (requestedEngine === "clipdrop") {
      const ok = await tryClipdrop();
      if (!ok) {
        console.warn("Clipdrop failed, falling back to FLUX engine");
        await tryFlux();
      }
    } else {
      const ok = await tryFlux();
      if (!ok) {
        console.warn("FLUX returned error/402, automatically falling back to Clipdrop SDXL");
        await tryClipdrop();
      }
    }

    if (!imageBuffer) {
      throw new ServiceUnavailableException("All visual generation engines are currently busy. Please try again with a different prompt.");
    }

    const finalBuffer: Buffer = imageBuffer!;

    // 3. Object Storage - Always store native high-res raster buffer (PNG/JPEG)
    // Avoid SVG wrappers to ensure full browser compatibility and native social network publishing support
    const assetId = randomUUID();
    const { provider, bucket } = getStorageProvider();
    const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg" : ".png";
    const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${assetId}/visual_${usedEngine}${ext}`;

    const filename=`${usedEngine}_visual_${Date.now()}${ext}`;
    await uploadManagedMedia({assetId,workspaceId:opts.workspaceId,userId:opts.userId,provider,bucket,objectKey,body:finalBuffer,mimeType,filename,type:'GENERATED_ASSET',metadata:{idempotency_key:keyHash,prompt:opts.prompt,engine:usedEngine,aspect_ratio:aspectRatio,headline:opts.headline||null,logo_text:opts.logoText||null,cta:opts.cta||null,remaining_credits:remainingCredits,content_id:opts.contentId||null}});

    const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 30 * 86400);

    // 6. Attach to Content Item & set status to NEEDS_REVIEW
    if (opts.contentId) {
      await this.attachAssetToContent(opts.workspaceId, opts.contentId, assetId, downloadUrl, opts.userId, opts.platform);
    }

    // Audit Log
    await audit(
      pool,
      opts.workspaceId,
      opts.userId,
      "IMAGE_GENERATED",
      "media_asset",
      assetId,
      filename,
      null,
      { prompt: opts.prompt, aspectRatio, engine: usedEngine, remainingCredits }
    );

    return {
      assetId,
      url: downloadUrl,
      filename,
      mimeType,
      engine: usedEngine,
      remainingCredits,
      cached: false,
      contentId: opts.contentId,
      status: opts.contentId ? "NEEDS_REVIEW" : "COMPLETED",
      extractedCompany,
      extractedHeadline,
    };
  }

  /**
   * Background Removal Endpoint (Clipdrop)
   */
  async removeBackground(opts: RemoveBackgroundOptions) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new BadRequestException("Clipdrop API key is required for background removal.");
    }

    let inputBuffer = opts.fileBuffer;
    let originalName = opts.filename || "image.png";

    if (opts.assetId) {
      const assetRes = await pool.query(
        "SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
        [opts.assetId, opts.workspaceId]
      );
      if (!assetRes.rowCount) throw new NotFoundException("Asset not found");
      const asset = assetRes.rows[0];
      originalName = asset.original_filename;
      const { provider } = getStorageProvider();
      const stream = await provider.read(asset.bucket, asset.object_key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      inputBuffer = Buffer.concat(chunks);
    }

    if (!inputBuffer) {
      throw new BadRequestException("No valid image buffer or assetId provided.");
    }

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(inputBuffer)], { type: "image/png" });
    formData.append("image_file", blob, "input.png");

    let clipdropResponse: Response;
    try {
      clipdropResponse = await fetch("https://clipdrop-api.co/remove-background/v1", {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: formData,
      });
    } catch (err: any) {
      throw new ServiceUnavailableException(`Clipdrop background removal failed: ${err?.message || err}`);
    }

    const remainingCreditsHeader = clipdropResponse.headers.get("x-remaining-credits") || clipdropResponse.headers.get("x-credit-count");
    const remainingCredits = remainingCreditsHeader ? parseInt(remainingCreditsHeader, 10) : null;

    if (!clipdropResponse.ok) {
      let errText = "";
      try { errText = await clipdropResponse.text(); } catch {}
      throw new BadRequestException(`Clipdrop Background Removal Error (${clipdropResponse.status}): ${errText || "Failed"}`);
    }

    const outArrayBuffer = await clipdropResponse.arrayBuffer();
    const outBuffer = Buffer.from(new Uint8Array(outArrayBuffer));
    const mimeType = "image/png";

    const assetId = randomUUID();
    const { provider, bucket } = getStorageProvider();
    const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${assetId}/nobg.png`;

    const filename=`nobg_${originalName.replace(/\.[^/.]+$/, "")}.png`;
    await uploadManagedMedia({assetId,workspaceId:opts.workspaceId,userId:opts.userId,provider,bucket,objectKey,body:outBuffer,mimeType,filename,type:'GENERATED_ASSET',metadata:{operation:'remove-background',remaining_credits:remainingCredits}});

    const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 30 * 86400);
    return {
      assetId,
      url: downloadUrl,
      filename,
      mimeType,
      remainingCredits,
    };
  }

  /**
   * Saves post with attached visual asset and sets post to NEEDS_REVIEW or DRAFT
   */
  async attachAndSave(opts: AttachAndSaveOptions) {
    const contentId = opts.contentId || randomUUID();
    const status = opts.status || "NEEDS_REVIEW";

    return transaction(async (db) => {
      const existing = await db.query(
        "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [contentId, opts.workspaceId]
      );

      const variants: Record<string, any> = {};
      for (const p of opts.platforms) {
        variants[p] = {
          caption: opts.body,
          mediaAssetId: opts.assetId,
          mediaUrl: opts.mediaUrl,
          mediaType: "image",
        };
      }

      let postRow;
      if (existing.rowCount) {
        postRow = (
          await db.query(
            `UPDATE content 
             SET title = $3, body = $4, variants = $5, platforms = $6, status = $7, updated_by = $8, updated_at = NOW()
             WHERE id = $1 AND workspace_id = $2
             RETURNING *`,
            [
              contentId,
              opts.workspaceId,
              opts.title,
              opts.body,
              JSON.stringify(variants),
              JSON.stringify(opts.platforms),
              status,
              opts.userId,
            ]
          )
        ).rows[0];
      } else {
        postRow = (
          await db.query(
            `INSERT INTO content(id, workspace_id, title, body, platforms, variants, status, created_by, updated_by)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $8)
             RETURNING *`,
            [
              contentId,
              opts.workspaceId,
              opts.title,
              opts.body,
              JSON.stringify(opts.platforms),
              JSON.stringify(variants),
              status,
              opts.userId,
            ]
          )
        ).rows[0];
      }

      await audit(
        db,
        opts.workspaceId,
        opts.userId,
        "content_saved_with_visual",
        "content",
        contentId,
        opts.title,
        null,
        { assetId: opts.assetId, status }
      );

      return {
        id: postRow.id,
        title: postRow.title,
        status: postRow.status,
        platforms: postRow.platforms,
        mediaAssetId: opts.assetId,
        mediaUrl: opts.mediaUrl,
      };
    });
  }

  /**
   * Helper to attach media asset to existing content item
   */
  private async attachAssetToContent(workspaceId: string, contentId: string, assetId: string, mediaUrl: string, userId: string, targetPlatform?: string) {
    await transaction(async (db) => {
      const res = await db.query(
        "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [contentId, workspaceId]
      );
      if (!res.rowCount) return;

      const post = res.rows[0];
      const variants = typeof post.variants === "string" ? JSON.parse(post.variants) : (post.variants || {});
      const platforms = (post.platforms as string[]) || ["LinkedIn"];

      const targetPlatforms = targetPlatform ? [targetPlatform] : platforms;
      for (const p of targetPlatforms) {
        const existing = variants[p] || {};
        if (typeof existing === "string") {
          variants[p] = { caption: existing, mediaAssetId: assetId, mediaUrl, mediaType: "image" };
        } else {
          variants[p] = { ...existing, mediaAssetId: assetId, mediaUrl, mediaType: "image" };
        }
      }

      await db.query(
        `UPDATE content 
         SET variants = $3, status = 'NEEDS_REVIEW', updated_by = $4, updated_at = NOW() 
         WHERE id = $1 AND workspace_id = $2`,
        [contentId, workspaceId, JSON.stringify(variants), userId]
      );
    });
  }

  /**
   * Cleans conversational filler words and enriches visual scene prompts (ChatGPT / Midjourney style)
   */
  private cleanAndOptimizePrompt(raw: string): {
    visualPrompt: string;
    extractedHeadline?: string;
    extractedCompany?: string;
  } {
    let text = raw.trim();
    let extractedCompany: string | undefined;
    let extractedHeadline: string | undefined;

    // 1. Detect Company / Brand Name
    const companyMatch = text.match(/(?:by|from)\s+([a-zA-Z0-9\s&]{2,45}?(?:pvt|private|limited|ltd|company|corp|solutions|tech))/i);
    if (companyMatch) {
      extractedCompany = companyMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // 2. Detect Occasion / Festivity
    if (/diwali|deepavali/i.test(text)) {
      extractedHeadline = "Happy Diwali";
    } else if (/new\s*year/i.test(text)) {
      extractedHeadline = "Happy New Year";
    } else if (/christmas|xmas/i.test(text)) {
      extractedHeadline = "Merry Christmas";
    } else if (/eid/i.test(text)) {
      extractedHeadline = "Eid Mubarak";
    } else if (/independence\s*day/i.test(text)) {
      extractedHeadline = "Happy Independence Day";
    } else if (/holi/i.test(text)) {
      extractedHeadline = "Happy Holi";
    }

    // 3. Remove conversational instruction phrases that confuse image diffusion models
    let visual = text
      .replace(/^generate\s+(?:an?\s+)?(?:image|poster|photo|picture|graphic|banner)\s+(?:of|for)?\s+/i, "")
      .replace(/^create\s+(?:an?\s+)?(?:image|poster|photo|picture|graphic|banner)\s+(?:of|for)?\s+/i, "")
      .replace(/^make\s+(?:an?\s+)?(?:image|poster|photo|picture|graphic|banner)\s+(?:of|for)?\s+/i, "")
      .replace(/wishing\s+you\s+(?:all\s+)?(?:a\s+)?/gi, "")
      .replace(/wish\s+by\s+[a-zA-Z0-9\s&]{2,45}?(?:company|limited|pvt|ltd)?/gi, "")
      .replace(/by\s+[a-zA-Z0-9\s&]{2,45}?(?:private\s+limited|pvt\s+ltd|limited|company)/gi, "")
      .replace(/having\s+good\s+greeting\s+for\s+[a-zA-Z0-9\s]+/gi, "")
      .replace(/with\s+good\s+greeting\s+for\s+[a-zA-Z0-9\s]+/gi, "")
      .replace(/having\s+good\s+greeting/gi, "")
      .replace(/make\s+it\s+real(?:istic)?/gi, "")
      .trim();

    // 4. Only expand short greeting headlines into full visual festival scenes if the prompt is brief (<= 6 words)
    const wordCount = visual.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 6) {
      if (/diwali|deepavali/i.test(visual)) {
        extractedHeadline = "Happy Diwali";
        visual = "A breathtaking, luxurious Diwali festival celebration, glowing traditional clay diyas with radiant warm flickering golden flames, intricate colorful floral rangoli mandala with fresh marigold petals, glowing floating sky lanterns against deep twilight evening sky, festive golden bokeh lights, warm celebratory Diwali atmosphere, ultra-detailed 8k, cinematic photography, rich vibrant colors, masterpiece, clean image, no text, no words, no letters, no watermark";
      } else if (/new\s*year/i.test(visual)) {
        extractedHeadline = "Happy New Year";
        visual = "Spectacular New Year fireworks illuminating midnight city skyline, sparkling champagne flutes, golden confetti, glamorous celebration atmosphere, cinematic lighting";
      } else if (/christmas|xmas/i.test(visual)) {
        extractedHeadline = "Merry Christmas";
        visual = "Cozy Christmas evening, decorated pine tree with warm glowing fairy lights, fireplace hearth, wrapped luxury gift boxes, soft snow outside window, cinematic warmth";
      } else if (/eid/i.test(visual)) {
        extractedHeadline = "Eid Mubarak";
        visual = "Majestic crescent moon shining over an architectural mosque with illuminated minarets, glowing lanterns, golden arabesque patterns, tranquil night sky, cinematic elegance";
      } else if (/independence\s*day/i.test(visual)) {
        extractedHeadline = "Happy Independence Day";
        visual = "Grand national monuments illuminated with vibrant tri-color patriotic lighting, dramatic sky, celebratory atmosphere, cinematic photography";
      } else if (/holi/i.test(visual)) {
        extractedHeadline = "Happy Holi";
        visual = "Joyful explosion of vibrant colorful gulal powder clouds in slow motion, bright sunlight, energetic festive celebration, high-speed photography";
      } else if (wordCount <= 3) {
        visual = `Cinematic visual artwork representing ${visual}, dramatic studio lighting, rich colors, shallow depth of field, award-winning photography`;
      }
    }

    return {
      visualPrompt: visual,
      extractedHeadline,
      extractedCompany,
    };
  }

  /**
   * Renders high quality brand overlay with dynamic brand branding
   */
  private async renderBrandOverlay(
    baseImageBuffer: Buffer,
    mimeType: string,
    aspectRatio: string,
    brand: { headline?: string; logoText?: string; websiteUrl?: string; cta?: string }
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    let width = 1024;
    let height = 1024;

    if (aspectRatio === "16:9") { width = 1280; height = 720; }
    else if (aspectRatio === "9:16") { width = 1080; height = 1920; }
    else if (aspectRatio === "4:5") { width = 1024; height = 1280; }

    const base64Image = `data:${mimeType};base64,${baseImageBuffer.toString("base64")}`;
    const headlineText = brand.headline ? this.escapeXml(brand.headline) : "";
    const logoText = this.escapeXml(brand.logoText || "ContentOS");
    const websiteUrl = brand.websiteUrl ? this.escapeXml(brand.websiteUrl) : "";
    const ctaText = brand.cta ? this.escapeXml(brand.cta) : "";

    const overlayY = Math.floor(height * 0.65);
    const overlayHeight = height - overlayY;

    const brandInitial = (logoText.replace(/[^a-zA-Z0-9]/g, "").charAt(0) || "B").toUpperCase();

    const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="overlayGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#050811" stop-opacity="0" />
      <stop offset="35%" stop-color="#050811" stop-opacity="0.85" />
      <stop offset="100%" stop-color="#020409" stop-opacity="0.98" />
    </linearGradient>
    <linearGradient id="topBarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.94" />
      <stop offset="100%" stop-color="#1e1b4b" stop-opacity="0.94" />
    </linearGradient>
    <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1" />
      <stop offset="100%" stop-color="#a855f7" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Base Visual -->
  <image href="${base64Image}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />

  <!-- Top Glassmorphism Brand Bar -->
  <g transform="translate(36, 28)" filter="url(#shadow)">
    <rect width="${width - 72}" height="64" rx="16" fill="url(#topBarGrad)" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1.2" />
    
    <g transform="translate(20, 14)">
      <circle cx="18" cy="18" r="16" fill="url(#badgeGrad)" />
      <text x="18" y="24" font-family="Inter, Arial, sans-serif" font-size="15" font-weight="900" fill="#ffffff" text-anchor="middle">${brandInitial}</text>
      <text x="44" y="24" font-family="Inter, Helvetica, Arial, sans-serif" font-size="16" font-weight="800" fill="#f8fafc" letter-spacing="0.5">${logoText.toUpperCase()}</text>
    </g>

    ${websiteUrl ? `<text x="${width - 96}" y="42" text-anchor="end" font-family="Inter, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#38bdf8" letter-spacing="0.5">🌐 ${websiteUrl}</text>` : ""}
  </g>

  <!-- Bottom Brand Overlay Gradient -->
  <rect x="0" y="${overlayY}" width="${width}" height="${overlayHeight}" fill="url(#overlayGrad)" />

  ${
    headlineText
      ? `<g transform="translate(48, ${overlayY + 65})">
    <text x="0" y="0" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${height > 1200 ? 46 : 38}" font-weight="900" fill="#ffffff" filter="url(#shadow)" letter-spacing="-0.5">
      ${headlineText}
    </text>
    <text x="0" y="32" font-family="Inter, Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="#cbd5e1" opacity="0.9">
      Warmest greetings & best wishes from ${logoText}
    </text>
  </g>`
      : ""
  }

  ${
    ctaText
      ? `<g transform="translate(${width - 240}, ${height - 65})">
    <rect width="190" height="42" rx="21" fill="url(#badgeGrad)" filter="url(#shadow)"/>
    <text x="95" y="26" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${ctaText} →</text>
  </g>`
      : ""
  }
</svg>`;

    return {
      buffer: Buffer.from(svg, "utf-8"),
      mimeType: "image/svg+xml",
    };
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
