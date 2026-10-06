import { Injectable, BadRequestException, ServiceUnavailableException, NotFoundException } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { pool, transaction, audit } from "../db.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { getLLMProvider } from "../ai/llm.service.js";

export interface GenerateImageOptions {
  workspaceId: string;
  userId: string;
  prompt: string;
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
  headline?: string;
  logoText?: string;
  websiteUrl?: string;
  cta?: string;
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

@Injectable()
export class ClipdropService {
  private getApiKey(): string {
    const key = process.env.CLIPDROP_API_KEY;
    if (!key || !key.trim()) {
      throw new ServiceUnavailableException("CLIPDROP_API_KEY is not configured in environment.");
    }
    return key.trim();
  }

  /**
   * Generates a platform-optimized visual prompt using ContentOS LLM
   */
  async suggestPrompt(contentText: string, platform?: string, contextInfo?: string): Promise<{ prompt: string }> {
    const provider = getLLMProvider();
    const systemPrompt = `You are a world-class creative director. Generate a vivid, detailed image prompt for a text-to-image AI (like Clipdrop/DALL-E) based on the provided content text and platform target.
    
Guidelines:
- Platform focus: ${platform || "General social media"}
- Describe visual subjects, lighting, artistic style, color scheme, depth, and mood.
- Keep prompt between 25 and 70 words.
- Do NOT include text instructions or quote marks in the prompt. Return ONLY the raw image prompt string.`;

    const userMessage = `Content text:\n"${contentText.slice(0, 1500)}"\n${contextInfo ? `Context: ${contextInfo}` : ""}`;

    try {
      if (await provider.validateConfiguration()) {
        const res = await provider.generateStructured({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          schema: {
            type: "object",
            properties: { prompt: { type: "string" } },
            required: ["prompt"],
          } as any,
          schemaName: "ImagePromptSuggestion",
        });
        const promptVal = (res.data as any)?.prompt;
        if (promptVal) {
          return { prompt: promptVal };
        }
      }
    } catch (err) {
      console.warn("LLM prompt suggestion fallback:", err);
    }

    // Fallback if LLM unavailable
    const cleaned = contentText.replace(/[\n\r]+/g, " ").slice(0, 120);
    return {
      prompt: `Modern 3D digital illustration representing ${cleaned}, vibrant color palette, high resolution, 8k render, professional social media graphic`,
    };
  }

  /**
   * Generates image via Clipdrop API, applies ContentOS brand overlay (headline/logo/cta),
   * saves as media asset, attaches to existing content draft, and sets status to NEEDS_REVIEW.
   */
  async generateImage(opts: GenerateImageOptions) {
    const apiKey = this.getApiKey();
    const aspectRatio = opts.aspectRatio || "1:1";
    
    // 1. Idempotency Check
    const rawKey = opts.idempotencyKey || `${opts.workspaceId}:${opts.prompt}:${aspectRatio}:${opts.headline || ""}:${opts.contentId || ""}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const existingAssetRes = await pool.query(
      `SELECT * FROM media_assets 
       WHERE workspace_id = $1 
         AND deleted_at IS NULL 
         AND metadata->>'idempotency_key' = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [opts.workspaceId, keyHash]
    );

    if (existingAssetRes.rowCount) {
      const asset = existingAssetRes.rows[0];
      const { provider } = getStorageProvider();
      const downloadUrl = await provider.getSignedDownloadUrl(asset.bucket, asset.object_key, 3600);

      // If contentId provided, ensure content item is linked & updated
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
        contentId: opts.contentId,
        status: opts.contentId ? "NEEDS_REVIEW" : asset.status,
      };
    }

    // 2. Format Prompt for Aspect Ratio & Style
    let finalPrompt = opts.prompt.trim();
    if (aspectRatio === "16:9") finalPrompt += ", 16:9 widescreen composition";
    else if (aspectRatio === "9:16") finalPrompt += ", 9:16 vertical story composition";
    else if (aspectRatio === "4:5") finalPrompt += ", 4:5 vertical portrait composition";
    else finalPrompt += ", 1:1 square centered composition";

    // 3. Call Clipdrop API (Text to Image)
    const formData = new FormData();
    formData.append("prompt", finalPrompt);

    let clipdropResponse: Response;
    try {
      clipdropResponse = await fetch("https://clipdrop-api.co/text-to-image/v1", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
        },
        body: formData,
      });
    } catch (err: any) {
      throw new ServiceUnavailableException(`Network connection to Clipdrop API failed: ${err?.message || err}`);
    }

    // Extract credit headers if provided by Clipdrop
    const remainingCreditsHeader = clipdropResponse.headers.get("x-remaining-credits") || clipdropResponse.headers.get("x-credit-count");
    const remainingCredits = remainingCreditsHeader ? parseInt(remainingCreditsHeader, 10) : null;

    if (!clipdropResponse.ok) {
      let errText = "";
      try {
        errText = await clipdropResponse.text();
      } catch {}
      
      // Preserving draft content state on failure
      throw new BadRequestException(`Clipdrop API Error (${clipdropResponse.status}): ${errText || "Image generation request failed"}`);
    }

    const imageArrayBuffer = await clipdropResponse.arrayBuffer();
    let imageBuffer = Buffer.from(new Uint8Array(imageArrayBuffer));
    let mimeType = clipdropResponse.headers.get("content-type") || "image/png";

    // 4. ContentOS SVG/Canvas Brand Composite Overlay
    if (opts.headline || opts.logoText || opts.websiteUrl || opts.cta) {
      const composited = await this.renderBrandOverlay(imageBuffer, mimeType, aspectRatio, {
        headline: opts.headline,
        logoText: opts.logoText || "Hindustan Software Solution",
        websiteUrl: opts.websiteUrl || "hindustansoftwaresolution.com",
        cta: opts.cta,
      });
      imageBuffer = Buffer.from(composited.buffer);
      mimeType = composited.mimeType;
    }

    // 5. Store in Object Storage
    const assetId = randomUUID();
    const { provider, bucket } = getStorageProvider();
    const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? ".jpg" : mimeType.includes("svg") ? ".svg" : ".png";
    const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${assetId}/clipdrop_visual${ext}`;

    await provider.upload({
      bucket,
      objectKey,
      body: imageBuffer,
      mimeType,
    });

    // 6. DB Record in media_assets
    const filename = `clipdrop_${Date.now()}${ext}`;
    await pool.query(
      `INSERT INTO media_assets(id, workspace_id, type, storage_provider, bucket, object_key, mime_type, size_bytes, original_filename, status, metadata, created_by)
       VALUES($1, $2, 'GENERATED_ASSET', 's3', $3, $4, $5, $6, $7, 'COMPLETED', $8, $9)`,
      [
        assetId,
        opts.workspaceId,
        bucket,
        objectKey,
        mimeType,
        imageBuffer.length,
        filename,
        JSON.stringify({
          idempotency_key: keyHash,
          prompt: opts.prompt,
          aspect_ratio: aspectRatio,
          headline: opts.headline || null,
          logo_text: opts.logoText || null,
          cta: opts.cta || null,
          remaining_credits: remainingCredits,
          content_id: opts.contentId || null,
        }),
        opts.userId,
      ]
    );

    const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 3600);

    // 7. Attach to Content Item & set status to NEEDS_REVIEW
    if (opts.contentId) {
      await this.attachAssetToContent(opts.workspaceId, opts.contentId, assetId, downloadUrl, opts.userId, opts.platform);
    }

    // Audit Log
    await audit(
      pool,
      opts.workspaceId,
      opts.userId,
      "CLIPDROP_IMAGE_GENERATED",
      "media_asset",
      assetId,
      filename,
      null,
      { prompt: opts.prompt, aspectRatio, remainingCredits }
    );

    return {
      assetId,
      url: downloadUrl,
      filename,
      mimeType,
      remainingCredits,
      cached: false,
      contentId: opts.contentId,
      status: opts.contentId ? "NEEDS_REVIEW" : "COMPLETED",
    };
  }

  /**
   * Clipdrop Background Removal Endpoint
   */
  async removeBackground(opts: RemoveBackgroundOptions) {
    const apiKey = this.getApiKey();
    let buffer: Buffer;
    let originalName = "image_input.png";

    if (opts.fileBuffer) {
      buffer = opts.fileBuffer;
      originalName = opts.filename || originalName;
    } else if (opts.assetId) {
      const assetRes = await pool.query(
        "SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
        [opts.assetId, opts.workspaceId]
      );
      if (!assetRes.rowCount) throw new NotFoundException("Asset not found in workspace.");
      const asset = assetRes.rows[0];
      const { provider } = getStorageProvider();

      // Read file buffer from storage
      const stream = await provider.read(asset.bucket, asset.object_key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      buffer = Buffer.concat(chunks);
      originalName = asset.original_filename;
    } else {
      throw new BadRequestException("Either assetId or fileBuffer must be supplied.");
    }

    // Call Clipdrop API (Remove Background)
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: opts.mimeType || "image/png" });
    formData.append("image_file", blob, originalName);

    let clipdropResponse: Response;
    try {
      clipdropResponse = await fetch("https://clipdrop-api.co/remove-background/v1", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
        },
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
    const outBuffer = Buffer.from(outArrayBuffer);
    const mimeType = "image/png";

    // Store cleaned image
    const assetId = randomUUID();
    const { provider, bucket } = getStorageProvider();
    const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${assetId}/nobg_${assetId}.png`;

    await provider.upload({
      bucket,
      objectKey,
      body: outBuffer,
      mimeType,
    });

    const filename = `nobg_${originalName.replace(/\.[^/.]+$/, "")}.png`;
    await pool.query(
      `INSERT INTO media_assets(id, workspace_id, type, storage_provider, bucket, object_key, mime_type, size_bytes, original_filename, status, metadata, created_by)
       VALUES($1, $2, 'GENERATED_ASSET', 's3', $3, $4, $5, $6, $7, 'COMPLETED', $8, $9)`,
      [
        assetId,
        opts.workspaceId,
        bucket,
        objectKey,
        mimeType,
        outBuffer.length,
        filename,
        JSON.stringify({ operation: "remove-background", remaining_credits: remainingCredits }),
        opts.userId,
      ]
    );

    const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 3600);
    return {
      assetId,
      url: downloadUrl,
      filename,
      mimeType,
      remainingCredits,
    };
  }

  /**
   * Helper to attach media asset to existing content item and set status to NEEDS_REVIEW
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

      // Update variant for target platform or all platforms
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
   * Renders high quality SVG container with visual background + Hindustan Software Solution headline, logo, and website URL
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
    const logoText = this.escapeXml(brand.logoText || "Hindustan Software Solution");
    const websiteUrl = this.escapeXml(brand.websiteUrl || "hindustansoftwaresolution.com");
    const ctaText = brand.cta ? this.escapeXml(brand.cta) : "";

    const overlayY = Math.floor(height * 0.52);
    const overlayHeight = height - overlayY;

    const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="overlayGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19" stop-opacity="0" />
      <stop offset="35%" stop-color="#0b0f19" stop-opacity="0.80" />
      <stop offset="100%" stop-color="#070a12" stop-opacity="0.98" />
    </linearGradient>
    <linearGradient id="topBarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0f172a" stop-opacity="0.92" />
      <stop offset="100%" stop-color="#1e1b4b" stop-opacity="0.92" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
  </defs>

  <!-- Clipdrop Base Visual -->
  <image href="${base64Image}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />

  <!-- Top Glassmorphism Brand Bar (HSS Logo + Website URL) -->
  <g transform="translate(36, 28)" filter="url(#shadow)">
    <rect width="${width - 72}" height="72" rx="18" fill="url(#topBarGrad)" stroke="rgba(239, 68, 68, 0.45)" stroke-width="1.5" />
    
    <!-- HSS Vector Logo Group -->
    <g transform="translate(20, 7)">
      <!-- Grey Matrix Squares -->
      <rect x="22" y="0" width="8" height="8" rx="1.5" fill="#94a3b8" />
      
      <rect x="11" y="10" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="22" y="10" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="33" y="10" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="44" y="10" width="8" height="8" rx="1.5" fill="#94a3b8" />

      <rect x="11" y="20" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="22" y="20" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="33" y="20" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="55" y="20" width="8" height="8" rx="1.5" fill="#94a3b8" />

      <rect x="0" y="30" width="8" height="8" rx="1.5" fill="#94a3b8" />
      
      <!-- Red H S S Boxes -->
      <rect x="22" y="30" width="9" height="9" rx="1.5" fill="#ef4444" />
      <text x="26.5" y="37.5" font-family="Inter, Arial, sans-serif" font-size="7" font-weight="900" fill="#ffffff" text-anchor="middle">H</text>

      <rect x="33" y="30" width="9" height="9" rx="1.5" fill="#ef4444" />
      <text x="37.5" y="37.5" font-family="Inter, Arial, sans-serif" font-size="7" font-weight="900" fill="#ffffff" text-anchor="middle">S</text>

      <rect x="44" y="30" width="9" height="9" rx="1.5" fill="#ef4444" />
      <text x="48.5" y="37.5" font-family="Inter, Arial, sans-serif" font-size="7" font-weight="900" fill="#ffffff" text-anchor="middle">S</text>

      <rect x="11" y="40" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="22" y="40" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="33" y="40" width="8" height="8" rx="1.5" fill="#94a3b8" />
      <rect x="44" y="40" width="8" height="8" rx="1.5" fill="#94a3b8" />

      <rect x="33" y="50" width="8" height="8" rx="1.5" fill="#94a3b8" />

      <!-- Typography HINDUSTAN SOFTWARE SOLUTION -->
      <text x="68" y="23" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12" font-weight="900" fill="#f8fafc" letter-spacing="1">HINDUSTAN</text>
      <text x="68" y="36" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12" font-weight="900" fill="#cbd5e1" letter-spacing="1">SOFTWARE</text>
      <text x="68" y="49" font-family="Inter, Helvetica, Arial, sans-serif" font-size="12" font-weight="900" fill="#94a3b8" letter-spacing="1">SOLUTION</text>
    </g>

    <!-- Website URL (Right aligned) -->
    <text x="${width - 96}" y="43" text-anchor="end" font-family="Inter, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#38bdf8" letter-spacing="0.5">🌐 ${websiteUrl}</text>
  </g>

  <!-- ContentOS Brand Overlay Gradient -->
  <rect x="0" y="${overlayY}" width="${width}" height="${overlayHeight}" fill="url(#overlayGrad)" />

  <!-- Headline Text -->
  ${
    headlineText
      ? `<text x="48" y="${overlayY + 80}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${height > 1500 ? 44 : 32}" font-weight="800" fill="#ffffff" filter="url(#shadow)">
    ${headlineText}
  </text>`
      : ""
  }

  <!-- CTA Button Badge -->
  ${
    ctaText
      ? `<g transform="translate(48, ${height - 85})">
    <rect width="${Math.max(180, ctaText.length * 14 + 48)}" height="48" rx="24" fill="#6366f1" filter="url(#shadow)"/>
    <text x="24" y="31" font-family="Inter, Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">${ctaText} →</text>
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
