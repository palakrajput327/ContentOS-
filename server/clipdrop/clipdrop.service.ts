import { Injectable, BadRequestException, ServiceUnavailableException, NotFoundException } from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { pool, transaction, audit } from "../db.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { getLLMProvider } from "../ai/llm.service.js";

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
export class ClipdropService {
  private getApiKey(): string | null {
    const key = process.env.CLIPDROP_API_KEY;
    return key && key.trim() ? key.trim() : null;
  }

  /**
   * Generates a platform-optimized visual prompt using ContentOS LLM (Groq / Gemini / OpenRouter)
   */
  async suggestPrompt(contentText: string, platform?: string, contextInfo?: string): Promise<{ prompt: string }> {
    const provider = getLLMProvider();
    const systemPrompt = `You are an elite creative visual director for high-growth tech brands and social media marketing.
Analyze the provided content and formulate a vivid, compelling image generation prompt for modern text-to-image AI (FLUX / Clipdrop / Midjourney).

STRICT RULES:
1. Extract the primary core concept, visual metaphor, or key message.
2. Build a cinematic scene description: subject, environment, lighting (soft studio glow, rim light, volumetric lighting), style (clean 3D glassmorphic render, photorealistic, or sleek modern SaaS).
3. Do NOT copy raw sentences or quote fragments from the post. Turn thoughts into tangible visual art!
4. Do NOT include phrases like "Create an image of", "Illustration of", or quotation marks.
5. Return 35 to 65 words of rich, descriptive visual keywords.`;

    const userMessage = `Content text:\n"${contentText.slice(0, 1500)}"\n${contextInfo ? `Context: ${contextInfo}` : ""}\nTarget Platform: ${platform || "Social Media"}`;

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
        if (promptVal && promptVal.trim().length > 15) {
          return { prompt: promptVal.trim() };
        }
      }
    } catch (err) {
      console.warn("LLM prompt suggestion fallback:", err);
    }

    // High quality thematic fallbacks if LLM unavailable
    const subject = contentText.split(/[.\n]/)[0]?.replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 80) || "digital innovation";
    return {
      prompt: `Futuristic 3D minimalist digital workspace representing ${subject}, glowing holographic data interface, floating geometric glass cubes, sleek violet and cyan studio lighting, ultra-detailed 8k octane render`,
    };
  }

  /**
   * Generates a platform-optimized visual poster prompt directly from PDF knowledge concepts & brand guidelines
   */
  async suggestPosterPrompt(opts: {
    knowledgeConcept: string;
    excerpt?: string;
    sourceVisualContext?: string;
    title?: string;
    brand?: {
      primary_color?: string;
      secondary_color?: string;
      tone?: string;
      name?: string;
      cta?: string;
    };
    platform?: string;
  }): Promise<{ prompt: string; headline: string }> {
    const provider = getLLMProvider();
    const primaryColor = opts.brand?.primary_color || "vibrant violet and cyan";
    const systemPrompt = `You are a world-class creative art director and prompt engineer for high-growth tech brands and viral social media visual posters.
Your job is to read extracted knowledge facts/concepts from a document, along with any source visual context (diagrams/infographics from the PDF), and craft:
1. A descriptive, high-quality text-to-image prompt (for FLUX / Midjourney / Clipdrop) that visually represents the core concept as an eye-catching social media poster.
2. A short, punchy 3-6 word visual headline for the poster.

STRICT RULES FOR IMAGE PROMPT:
1. Translate conceptual/technical ideas and source visual themes into tangible visual metaphors: e.g. glowing 3D isometric data structures, sleek futuristic holographic interfaces, minimalist frosted glass cubes, clean studio product podiums, or cinematic atmospheric lighting.
2. Specify lighting (soft studio rim light, volumetric lighting, bioluminescent glow, subtle neon accents), color palette (harmonious with brand: ${primaryColor}), and style (ultra-modern 3D render, Octane render, 8k resolution, minimalist SaaS aesthetic).
3. Do NOT copy raw document text or citations into the prompt.
4. Do NOT include phrases like "Create an image of", "Poster of", or quotes.
5. Return 35 to 65 words of rich visual keywords.

SCHEMA:
Return JSON matching schema:
{
  "prompt": "35-65 words image generation prompt",
  "headline": "3-6 words bold title"
}`;

    const userMessage = `Knowledge Concept: "${opts.knowledgeConcept.slice(0, 1000)}"
${opts.excerpt ? `Source Excerpt: "${opts.excerpt.slice(0, 800)}"` : ""}
${opts.sourceVisualContext ? `Extracted PDF Visual Context: "${opts.sourceVisualContext}"` : ""}
${opts.title ? `Working Title: "${opts.title}"` : ""}
Brand Tone: ${opts.brand?.tone || "Professional, Modern"}
Platform: ${opts.platform || "Instagram"}`;

    try {
      if (await provider.validateConfiguration()) {
        const res = await provider.generateStructured({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          schema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              headline: { type: "string" },
            },
            required: ["prompt", "headline"],
          } as any,
          schemaName: "PosterPromptSuggestion",
        });
        const data = res.data as any;
        if (data?.prompt && data.prompt.trim().length > 15) {
          return {
            prompt: data.prompt.trim(),
            headline: (data.headline || opts.title || "Key Insight").trim().slice(0, 60),
          };
        }
      }
    } catch (err) {
      console.warn("[ClipdropService] suggestPosterPrompt LLM warning:", (err as Error)?.message || err);
    }

    // Dynamic smart fallback if LLM is offline
    const cleanSubject = (opts.title || opts.knowledgeConcept || "innovation")
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .trim()
      .slice(0, 60);

    return {
      prompt: `Futuristic 3D minimalist tech poster visual representing ${cleanSubject}, floating frosted glass nodes, glowing volumetric violet and cyan lighting, sleek isometric composition, ultra-detailed 8k octane render`,
      headline: (opts.title || cleanSubject).slice(0, 40),
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

    // Style presets modifier
    let finalPrompt = visualPrompt;
    if (opts.stylePreset) {
      switch (opts.stylePreset) {
        case "3d-render":
          finalPrompt += ", 3D digital render, octane render, smooth glassmorphism, soft ambient occlusion, 8k resolution";
          break;
        case "cinematic":
          finalPrompt += ", cinematic photography, 35mm film photograph, dramatic rim lighting, depth of field, photorealistic";
          break;
        case "minimal-saas":
          finalPrompt += ", modern SaaS product illustration, minimalist geometric composition, sleek pastel gradients, vector aesthetics";
          break;
        case "cyberpunk":
          finalPrompt += ", futuristic cyberpunk aesthetic, glowing neon lights, holographic user interface, dark moody atmospheric lighting";
          break;
        case "editorial":
          finalPrompt += ", high-fashion editorial magazine cover visual, bold color contrast, sophisticated minimalist art";
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
      const downloadUrl = await provider.getSignedDownloadUrl(asset.bucket, asset.object_key, 3600);

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
      };
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
      )}?width=${width}&height=${height}&nologo=true`;

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

    const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 3600);

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

    // 4. Enrich specific themes with rich visual metaphors (DALL-E 3 / Midjourney style)
    // Diffusion models like SDXL produce garbled text when asked to write letters.
    // Strictly generate pure, ultra-clean, photorealistic visuals with zero text/watermarks.
    if (/diwali|deepavali/i.test(text)) {
      visual = "A breathtaking, luxurious Diwali festival celebration, glowing traditional clay diyas with radiant warm flickering golden flames, intricate colorful floral rangoli mandala with fresh marigold petals, glowing floating sky lanterns against deep twilight evening sky, festive golden bokeh lights, warm celebratory Diwali atmosphere, ultra-detailed 8k, cinematic photography, rich vibrant colors, masterpiece, clean image, no text, no words, no letters, no watermark";
    } else if (/waterfall/i.test(text) && /rainbow/i.test(text)) {
      visual = "Majestic cascading mountain waterfall, vibrant bright double rainbow arching over crystal turquoise waters, lush green mossy canyon cliffs, sunrays piercing through morning mist, realistic 8k nature photography, ultra-detailed, cinematic lighting, no text, no words";
    } else {
      visual += ", clean focused visual composition, volumetric studio lighting, rich colors, 8k resolution, photorealistic, masterpiece, clean background, no text, no words, no letters";
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
