import { PLATFORM_CAPABILITIES } from "../platform-capabilities.js";
import { assertWorkspaceActive } from "../billing/entitlement.service.js";
import { pool, transaction } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { ClipdropService } from "../clipdrop/clipdrop.service.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildRichCaption,
  formatCaptionForPlatform,
  extractContactInfoFromText,
  formatBrandName,
} from "./caption-generator.js";

export interface VisualConceptItem {
  id: string;
  documentId: string;
  documentName?: string;
  conceptTitle: string;
  sourcePage: number;
  sourceExcerpt: string;
  prompt: string;
  caption?: string;
  assetId?: string | null;
  imageUrl?: string | null;
  rawImageUrl?: string | null;
  rawAssetId?: string | null;
  status?: string;
  scheduledAt?: string | null;
  dispatchedAt?: string | null;
  targetChannels?: string[];
  createdAt: string;
}

export class VisualConceptsService {
  /**
   * Retrieves existing visual concepts or generates fresh ones from PDF knowledge
   */
  async getOrGenerateConcepts(documentId: string, workspaceId: string): Promise<{
    concepts: VisualConceptItem[];
    count: number;
    notice: string;
    allDispatched?: boolean;
  }> {
    // 0. Ensure caption column exists in database
    await pool.query("ALTER TABLE document_visual_concepts ADD COLUMN IF NOT EXISTS caption text").catch(() => {});

    // 1. Ensure concepts for this active document are generated if not yet in database
    const docConcepts = await pool.query(
      `SELECT COUNT(*)::int as count FROM document_visual_concepts WHERE document_id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );
    if ((docConcepts.rows[0]?.count || 0) === 0) {
      await this.regenerateConcepts(documentId, workspaceId);
    }

    // 2. Fetch all undispatched concepts across the workspace queue (accumulates across PDF uploads)
    const existing = await pool.query(
      `SELECT dvc.id, dvc.document_id, dvc.concept_title, dvc.source_page, dvc.source_excerpt, dvc.prompt, dvc.caption,
              dvc.asset_id, dvc.image_url, dvc.raw_image_url, dvc.raw_asset_id, dvc.status, dvc.scheduled_at, dvc.dispatched_at, dvc.target_channels, dvc.created_at,
              COALESCE(d.original_filename, 'Document') as document_name
       FROM document_visual_concepts dvc
       LEFT JOIN documents d ON d.id = dvc.document_id
       WHERE dvc.workspace_id = $1 AND (dvc.status IS NULL OR dvc.status != 'DISPATCHED')
       ORDER BY dvc.created_at ASC, dvc.source_page ASC`,
      [workspaceId]
    );

    const dispatchedRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM document_visual_concepts
       WHERE workspace_id = $1 AND status = 'DISPATCHED'`,
      [workspaceId]
    );
    const dispatchedCount = dispatchedRes.rows[0]?.count || 0;

    if (existing.rowCount && existing.rowCount > 0) {
      // Lazy load brand & contact information for rich caption backfill
      const { BrandIdentityService } = await import("./brand-identity.service.js");
      const brandService = new BrandIdentityService();
      let brandInfo: any = {};
      try {
        brandInfo = await brandService.getOrCreateBrandIdentity(documentId, workspaceId);
      } catch {}

      let contactInfo: any = {};
      try {
        const pagesRes = await pool.query(
          `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`,
          [documentId, workspaceId]
        );
        contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ""));
      } catch {}

      const concepts: VisualConceptItem[] = [];
      for (const r of existing.rows) {
        let conceptCaption = (r.caption || "").trim();
        const titleL = (r.concept_title || "").toLowerCase();
        const isBoosterTopic = titleL.includes("booster") || titleL.includes("accelerator");
        const hasRepetitiveBronze = !isBoosterTopic && conceptCaption.includes("Bronze Tier – Begin Your Journey");
        const hasBrandMismatch =
          (titleL + " " + (r.prompt || "")).toLowerCase().includes("tradeorbit") &&
          conceptCaption.includes("Regulus Liquidity");

        // Backfill or refresh rich caption if missing, legacy boilerplate, or repetitive template mismatch
        if (
          !conceptCaption ||
          conceptCaption.includes("In modern enterprise governance, foundational clarity") ||
          hasRepetitiveBronze ||
          hasBrandMismatch
        ) {
          conceptCaption = buildRichCaption({
            title: r.concept_title,
            companyName: r.document_name || brandInfo.companyName,
            websiteDomain: brandInfo.websiteDomain || contactInfo.website,
            phoneNumber: contactInfo.phone,
            excerpt: r.source_excerpt,
            prompt: r.prompt,
            sourcePage: r.source_page || 1,
          });
          pool
            .query("UPDATE document_visual_concepts SET caption = $1 WHERE id = $2", [conceptCaption, r.id])
            .catch(() => {});
        }

        concepts.push({
          id: r.id,
          documentId: r.document_id,
          documentName: r.document_name,
          conceptTitle: r.concept_title,
          sourcePage: r.source_page || 1,
          sourceExcerpt: r.source_excerpt || "",
          prompt: r.prompt,
          caption: conceptCaption,
          assetId: r.asset_id,
          imageUrl: r.image_url,
          rawImageUrl: r.raw_image_url || r.image_url,
          rawAssetId: r.raw_asset_id || r.asset_id,
          status: r.status || "PENDING",
          scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
          dispatchedAt: r.dispatched_at ? new Date(r.dispatched_at).toISOString() : null,
          targetChannels: r.target_channels || ["linkedin"],
          createdAt: r.created_at,
        });
      }

      return {
        concepts,
        count: concepts.length,
        notice: `Dispatch queue active: ${concepts.length} queued visual concept${concepts.length > 1 ? "s" : ""} scheduled across your document batch.`,
      };
    }

    if (dispatchedCount > 0) {
      return {
        concepts: [],
        count: 0,
        allDispatched: true,
        notice: "All visual posts from this PDF have been successfully published! Please upload a new PDF document to generate and schedule your next content batch.",
      };
    }

    return {
      concepts: [],
      count: 0,
      allDispatched: false,
      notice: "Document content is currently being analyzed and extracted by AI. Visual concepts will appear automatically.",
    };
  }

  /**
   * Forces fresh regeneration of visual concepts directly from document content using Gemini
   */
  async regenerateConcepts(documentId: string, workspaceId: string): Promise<{
    concepts: VisualConceptItem[];
    count: number;
    notice: string;
    allDispatched?: boolean;
  }> {
    await assertWorkspaceActive(workspaceId,"visual concept generation");
    // 1. Fetch document knowledge
    const kRes = await pool.query(
      `SELECT id, knowledge_key, value, source_excerpt, page_start
       FROM document_knowledge
       WHERE document_id = $1 AND workspace_id = $2
       ORDER BY page_start ASC, created_at ASC`,
      [documentId, workspaceId]
    );

    let contentSummary = "";
    if (kRes.rowCount && kRes.rowCount > 0) {
      contentSummary = kRes.rows
        .slice(0, 40)
        .map(
          (r, idx) =>
            `Concept #${idx + 1} [Page ${r.page_start || 1}]: "${r.knowledge_key}"\nDetail: ${typeof r.value === "string" ? r.value : JSON.stringify(r.value)}\nQuote: "${(r.source_excerpt || "").slice(0, 250)}"`
        )
        .join("\n\n");
    } else {
      // Fallback to document pages if knowledge extraction hasn't completed yet
      const pagesRes = await pool.query(
        `SELECT page_number, clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`,
        [documentId, workspaceId]
      );
      if (pagesRes.rowCount && pagesRes.rowCount > 0) {
        contentSummary = pagesRes.rows
          .map((p) => `Page ${p.page_number}:\n${p.clean_text.slice(0, 800)}`)
          .join("\n\n");
      }
    }

    if (!contentSummary.trim()) {
      return {
        concepts: [],
        count: 0,
        allDispatched: false,
        notice: "Document content is currently being analyzed and extracted by AI. Visual concepts will appear automatically.",
      };
    }

    // 2. Fetch document title & brand / contact identity
    const docRes = await pool.query(
      `SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );
    const docName = docRes.rows[0]?.original_filename || "Business Document";

    const { BrandIdentityService } = await import("./brand-identity.service.js");
    const brandService = new BrandIdentityService();
    let brandInfo: any = {};
    try {
      brandInfo = await brandService.getOrCreateBrandIdentity(documentId, workspaceId);
    } catch {}

    let contactInfo: any = {};
    try {
      const pagesRes = await pool.query(
        `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`,
        [documentId, workspaceId]
      );
      contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ""));
    } catch {}

    const brandName = formatBrandName(brandInfo.companyName || docName);
    const websiteDomain = brandInfo.websiteDomain || contactInfo.website || "";
    const phoneNumber = contactInfo.phone || "";

    // 3. Ask Gemini to extract genuine visual concepts and structured social media captions
    const provider = getLLMProvider();
    const systemPrompt = `You are an elite Commercial Advertising Creative Director, Social Media Copywriter & FLUX.1 Visual Prompt Architect.
Your mission: Analyze the uploaded business PDF / pitch deck / whitepaper, deeply understand its REAL business model, products, figures, and offerings, and create 100% ACCURATE, highly relevant commercial advertising visuals AND complete, beautifully formatted, high-converting social media captions.

STRICT ACCURACY RULES (ZERO HARDCODED ANIMALS OR IRRELEVANT TROPES):
1. NO RANDOM ANIMALS: Do NOT add bulls, lions, eagles, or animals unless the PDF explicitly features an animal in its brand or text.
2. 100% CONTENT-ACCURATE VISUALS:
   - If the page is about Global Infrastructure / Tech: Visualize futuristic global financial network, glowing fiber-optic data streams, clean algorithmic digital systems.
   - If the page is about Daily ROI / Profit Distribution: Visualize executive trading command desk with clean rising candlestick charts, glowing upward growth vectors, and the exact return figures.
   - If the page is about Packages / Capital Entry: Visualize sleek digital asset vault, cryptocurrency allocation interface, and BEP-20 verification badges.
   - If the page is about Referral / Network Income: Visualize interconnected professional leadership network nodes and collaborative digital links.
   - If the page is about Royalty Club / Leadership Rewards: Visualize prestigious executive achievement awards, golden milestone trophies, and global turnover revenue streams.
   - If the page is about Security / Compliance: Visualize high-tech cryptographic security shield, verified blockchain ledger blocks, and auditable protocol interfaces.

CRITICAL TEXT & SPELLING ACCURACY RULES (PREVENTS GIBBERISH & TYPOS):
- FLUX achieves 100% spelling accuracy ONLY when text is kept to 1 to 3 SHORT words maximum (e.g. "${brandName.toUpperCase()}", "1% - 3% DAILY", "SMART FINTECH", "10% DIRECT", "5X ACCELERATOR", "ROYALTY CLUB").
- NEVER prompt long sentences or multi-line paragraphs into the image.
- Explicitly instruct FLUX: 'The text "[EXACT_SHORT_PHRASE]" is displayed in sharp, clean, bold metallic lettering with 100% correct spelling, zero typos, and clean legible typography.'
- Explicit negative constraints in every prompt: 'no misspelled words, no gibberish letters, no random floating characters, no duplicate text, clean sharp typography, 8k commercial photography'.

CAPTION FORMAT & ABSOLUTE DIVERSITY REQUIREMENTS (MANDATORY):
Every single concept MUST have a COMPLETELY DIFFERENT, UNIQUE social media caption tailored strictly to that concept's specific page topic and offering. NEVER repeat the same tier bullets or descriptions across concepts!
1. High-energy headline with emojis tailored to the specific concept topic (e.g. 👑 EXECUTIVE ROYALTY CLUB – GLOBAL TURNOVER LEADERSHIP! 🌍💎, 📈 DAILY PROFIT DISTRIBUTION – CONSISTENT SMART YIELDS! 💰🔥, 🛡️ RISK MANAGEMENT & TCA – INSTITUTIONAL PRECISION! ⚡📊)
2. Hook line specifically referencing the concept topic and brand (e.g. 💎 Step into the elite executive tier and share in worldwide platform turnover with ${brandName}!)
3. Engaging 2-3 sentence narrative description detailing the specific offering, system, or vision from that page.
4. Structured key highlights or milestone bullet points with distinct emojis tailored to that concept (e.g. for Royalty Club: Global Turnover Pool, Executive Prestige, Lifetime Passive Streams; for Daily Yields: Smart Automated Yields, Compounding Growth, Seamless Liquidity; for Booster: Bronze/Silver/Gold/Platinum/Diamond 5X tiers). DO NOT use Bronze/Silver tiers on topics that are not about tiers!
5. Motivational call to action lines with emojis tailored to the concept.
6. Website link line if website is present (e.g. 🌐 [${websiteDomain || "www.tradeorbit.live"}](http://${websiteDomain || "www.tradeorbit.live"}/)).
7. Contact / phone number line if phone is present in document${phoneNumber ? ` (e.g. 📞 Helpline / WhatsApp Support: ${phoneNumber})` : ""}.
8. Subtle professional compliance/risk disclaimer (e.g. Rewards and eligibility are subject to the official ${brandName} business plan. Financial participation involves risk; rewards are not guaranteed.).
9. 12-16 high-impact hashtags tailored specifically to the company name and THIS CONCEPT'S unique keywords.

Scale dynamically across the document: Extract 6 to 14 distinct concepts covering all key pages and sections.
Return JSON with "concepts" array.`;

    let rawList: any[] = [];
    try {
      const ConceptItemSchema = z.union([
        z.string(),
        z.object({
          conceptTitle: z.string().optional(),
          title: z.string().optional(),
          name: z.string().optional(),
          concept: z.string().optional(),
          sourcePage: z.any().optional(),
          sourceExcerpt: z.string().optional(),
          prompt: z.string().optional(),
          description: z.string().optional(),
          caption: z.string().optional(),
        }).passthrough(),
      ]);

      const res = await provider.generateStructured({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Document: "${docName}"\nBrand Name: "${brandName}"\nWebsite: "${websiteDomain}"\nPhone: "${phoneNumber}"\n\nComprehensive Extracted Content from PDF:\n${contentSummary}\n\nExtract all distinct core business concepts across this document as accurate commercial FLUX prompts AND complete social captions:\nReturn JSON with "concepts" array.`,
          },
        ],
        schema: z.object({
          concepts: z.array(ConceptItemSchema),
        }).passthrough(),
        schemaName: "DocumentVisualConceptsExtraction",
        maxTokens: 4096,
      });

      const data = res.data as any;
      let rawArr: any[] = [];
      if (Array.isArray(data)) {
        rawArr = data;
      } else if (Array.isArray(data?.concepts)) {
        rawArr = data.concepts;
      } else if (Array.isArray(data?.items)) {
        rawArr = data.items;
      } else if (data && typeof data === "object") {
        const firstArr = Object.values(data).find(Array.isArray);
        if (firstArr) rawArr = firstArr as any[];
      }

      // Map dynamically with real unique titles from Gemini!
      rawList = rawArr.map((item, idx) => {
        let title = "";
        let prompt = "";
        let page = idx + 1;
        let excerpt = "";
        let caption = "";

        if (typeof item === "string") {
          prompt = item.trim();
          const firstTag = prompt.split(",")[0]?.trim() || `Core Pillar #${idx + 1}`;
          title = firstTag.slice(0, 60).replace(/^(a|an|the)\s+/i, "");
          title = title.charAt(0).toUpperCase() + title.slice(1);
        } else if (item && typeof item === "object") {
          title = (item.conceptTitle || item.title || item.name || item.concept || "").trim();
          prompt = (item.prompt || item.description || "").trim();
          if (!title && prompt) {
            const firstTag = prompt.split(",")[0]?.trim() || `Core Pillar #${idx + 1}`;
            title = firstTag.slice(0, 60).replace(/^(a|an|the)\s+/i, "");
            title = title.charAt(0).toUpperCase() + title.slice(1);
          }
          page = typeof item.sourcePage === "number" ? item.sourcePage : (idx + 1);
          excerpt = (item.sourceExcerpt || "").trim();
          caption = (item.caption || "").trim();
        }

        const effectiveTitle = title || `Core Pillar #${idx + 1}`;
        if (!caption || caption.length < 50 || caption.includes("In modern enterprise governance, foundational clarity")) {
          caption = buildRichCaption({
            title: effectiveTitle,
            companyName: brandName,
            websiteDomain,
            phoneNumber,
            excerpt,
            prompt,
            sourcePage: page,
          });
        }

        return {
          title: effectiveTitle,
          sourcePage: page,
          sourceExcerpt: excerpt,
          prompt,
          caption,
        };
      }).filter((c) => c.prompt && c.prompt.length > 15);
      console.log(`[VisualConceptsService] Successfully extracted ${rawList.length} dynamic concepts with unique titles and rich captions via Gemini`);
    } catch (err: any) {
      console.warn("[VisualConceptsService] LLM structured extraction warning:", err?.message || err);
    }

    // High-quality dynamic fallback: If LLM failed or returned empty, formulate 4 completely distinct FLUX tag prompts with rich formatted captions
    if (!rawList || rawList.length === 0) {
      const distinctCategories = [
        {
          key: "Global Financial Infrastructure & Platform Vision",
          prompt: `Commercial financial technology advertising creative for ${docName.replace(/\.pdf$/i, '')}, sharp bold metallic typography "GLOBAL FINTECH" at top with 100% correct spelling, luminous fiber-optic digital world globe with golden and cobalt blue data streams connecting international financial hubs, sleek obsidian marble background, volumetric studio lighting, clean legible typography, no typos, no gibberish, 8k commercial photography`,
        },
        {
          key: "Daily Profit Distribution & Earning Engine",
          prompt: `Commercial luxury financial advertising creative for ${docName.replace(/\.pdf$/i, '')}, clear bold 3D golden numbers "1% - 3% DAILY" with exact spelling, executive trading workstation with rising financial candlestick charts under warm amber and deep navy ambient lighting, sleek marble desk, sharp typography, zero typos, no random letters, 8k resolution, cinematic commercial photography`,
        },
        {
          key: "Smart Execution Engine & Risk Control",
          prompt: `High-tech commercial fintech creative for ${docName.replace(/\.pdf$/i, '')}, sharp 3D metallic typography "SMART EXECUTION" with 100% correct spelling, futuristic algorithmic trading node with clean holographic risk management analytics, glowing cyan and gold light circuits, clean sharp focus, no spelling mistakes, 8k resolution`,
        },
        {
          key: "Multi-Tier Accelerator & Leadership Rewards",
          prompt: `Commercial financial rewards creative for ${docName.replace(/\.pdf$/i, '')}, sharp 3D metallic typography "5X ACCELERATOR" with exact spelling, ascending luxury golden achievement tiers with floating metallic black and gold VIP cards, volumetric light beams, luxury dark aesthetic, zero typos, 8k commercial photography`,
        },
      ];

      if (kRes.rowCount && kRes.rowCount > 0) {
        rawList = kRes.rows.slice(0, 10).map((r, idx) => {
          const cat = distinctCategories[idx % distinctCategories.length];
          const catTitle = r.knowledge_key || cat.key;
          const catExcerpt = (r.source_excerpt || "").slice(0, 250);
          return {
            title: catTitle,
            sourcePage: r.page_start || idx + 1,
            sourceExcerpt: catExcerpt,
            prompt: cat.prompt,
            caption: buildRichCaption({
              title: catTitle,
              companyName: brandName,
              websiteDomain,
              phoneNumber,
              excerpt: catExcerpt,
              prompt: cat.prompt,
              sourcePage: r.page_start || idx + 1,
            }),
          };
        });
      } else {
        rawList = distinctCategories.map((cat, idx) => ({
          title: cat.key,
          sourcePage: idx + 1,
          sourceExcerpt: "",
          prompt: cat.prompt,
          caption: buildRichCaption({
            title: cat.key,
            companyName: brandName,
            websiteDomain,
            phoneNumber,
            prompt: cat.prompt,
            sourcePage: idx + 1,
          }),
        }));
      }
    }
    // 4. Clean up old concepts for this document and insert newly generated ones
    await pool.query(
      `DELETE FROM document_visual_concepts WHERE document_id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );

    const savedConcepts: VisualConceptItem[] = [];
    for (const item of rawList) {
      const id = randomUUID();
      const title = (item.title || "Business Concept").trim().slice(0, 120);
      const page = typeof item.sourcePage === "number" ? item.sourcePage : 1;
      const excerpt = (item.sourceExcerpt || "").trim().slice(0, 400);
      const prompt = (item.prompt || "").trim();
      const caption = (item.caption || "").trim() || buildRichCaption({
        title,
        companyName: brandName,
        websiteDomain,
        phoneNumber,
        excerpt,
        prompt,
        sourcePage: page,
      });

      if (!prompt || prompt.length < 15) continue;

      await pool.query(
        `INSERT INTO document_visual_concepts (id, document_id, workspace_id, concept_title, source_page, source_excerpt, prompt, caption)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, documentId, workspaceId, title, page, excerpt, prompt, caption]
      );

      savedConcepts.push({
        id,
        documentId,
        conceptTitle: title,
        sourcePage: page,
        sourceExcerpt: excerpt,
        prompt,
        caption,
        createdAt: new Date().toISOString(),
      });
    }

    const count = savedConcepts.length;
    return {
      concepts: savedConcepts,
      count,
      notice: `Extracted ${count} high-impact visual concepts from this document. (If you require additional unique visual angles, consider uploading documents with further business details or expanded sections).`,
    };
  }

  /**
   * Generates a 1024x1024 visual via FLUX.1 for a specific concept
   */
  async generateConceptVisual(opts: {
    documentId: string;
    conceptId: string;
    workspaceId: string;
    userId: string;
    customPrompt?: string;
    force?: boolean;
  }): Promise<{
    conceptId: string;
    assetId: string;
    imageUrl: string;
    caption?: string;
  }> {
    await assertWorkspaceActive(opts.workspaceId, "visual content");
    const row = (
      await pool.query(
        `SELECT id, document_id, concept_title, prompt FROM document_visual_concepts WHERE id = $1 AND workspace_id = $2`,
        [opts.conceptId, opts.workspaceId]
      )
    ).rows[0];

    if (!row) {
      throw new Error("Visual concept not found.");
    }

    const effectiveDocId = row.document_id || opts.documentId;

    const promptToUse = (opts.customPrompt && opts.customPrompt.trim().length > 10)
      ? opts.customPrompt.trim()
      : row.prompt;

    const { BrandIdentityService } = await import("./brand-identity.service.js");
    const brandService = new BrandIdentityService();

    const isForce = opts.force ?? true;
    const clipdropService = new ClipdropService();
    const result = await clipdropService.generateImage({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      prompt: promptToUse + "\nDo not draw company logos, domains or URLs. Approved branding is added afterward.",
      enableOverlay: false,
      headline: row.concept_title,
      aspectRatio: "1:1",
      engine: "flux",
      bypassCache: isForce,
      idempotencyKey: isForce ? `concept-visual:${opts.conceptId}:${Date.now()}` : undefined,
    });

    // Store raw AI generated artwork separately!
    let finalAssetId = result.assetId;
    let finalImageUrl = result.url;
    const rawAssetId = result.assetId;
    const rawImageUrl = result.url;

    const branded = await brandService.brandGeneratedImage({ documentId: effectiveDocId, workspaceId: opts.workspaceId, userId: opts.userId, assetId: result.assetId, url: result.url });
    finalAssetId = branded.assetId;
    finalImageUrl = branded.url;

    let generatedCaption:string|undefined;
    try{const {generateImageCaptions}=await import('../ai.controller.js');const copy=await generateImageCaptions(opts.workspaceId,opts.userId,rawAssetId,'Instagram',promptToUse);generatedCaption=copy.options[0]?.caption;}catch(e){console.warn('[VisualConcepts] Image retained; caption generation can be retried');}
    // Save both final (branded) poster and raw (pure AI artwork) to concept row
    await pool.query(
      `UPDATE document_visual_concepts
       SET asset_id = $1, image_url = $2, raw_asset_id = $3, raw_image_url = $4, prompt = $5, caption=COALESCE($7,caption), updated_at = NOW()
       WHERE id = $6`,
      [finalAssetId, finalImageUrl, rawAssetId, rawImageUrl, promptToUse, opts.conceptId,generatedCaption||null]
    );

    return {
      conceptId: opts.conceptId,
      caption:generatedCaption,
      assetId: finalAssetId,
      imageUrl: finalImageUrl,
    };
  }

  /**
   * Dispatches a concept to social channels, records publication, and marks as DISPATCHED
   */
  async dispatchConcept(opts: {
    documentId: string;
    conceptId: string;
    workspaceId: string;
    userId: string;
    channels?: string[];
    caption?: string;
    variants?: Record<string, any>;
  }): Promise<{ success: boolean; conceptId: string; dispatchedAt: string; publishedCount?: number; contentId?: string; results?: any[] }> {
    const row = (
      await pool.query(
        `SELECT id, document_id, concept_title, prompt, source_excerpt, caption, asset_id, image_url 
         FROM document_visual_concepts 
         WHERE id = $1 AND workspace_id = $2`,
        [opts.conceptId, opts.workspaceId]
      )
    ).rows[0];

    if (!row) {
      throw new Error("Visual concept not found.");
    }

    const effectiveDocId = row.document_id || opts.documentId;

    // Auto-Safety Guarantee: If no visual was generated manually, auto-generate via FLUX before dispatching!
    if (!row.image_url || !row.asset_id) {
      console.log(`[VisualConcepts] Concept ${opts.conceptId} has no visual yet. Auto-synthesizing FLUX visual before dispatch...`);
      try {
        const genRes = await this.generateConceptVisual({
          documentId: effectiveDocId,
          conceptId: opts.conceptId,
          workspaceId: opts.workspaceId,
          userId: opts.userId,
        });
        row.image_url = genRes.imageUrl;
        row.asset_id = genRes.assetId;
        console.log(`[VisualConcepts] Auto visual synthesis complete: ${genRes.imageUrl}`);
      } catch (genErr) {
        throw genErr;
      }
    }

    const { BrandIdentityService } = await import("./brand-identity.service.js");
    const brandService = new BrandIdentityService();
    let brand: any = {};
    try {
      brand = await brandService.getOrCreateBrandIdentity(effectiveDocId, opts.workspaceId);

      if (brandService.isBrandReady(brand)) {
        try {
          const branded = await brandService.recomposeConceptPoster({ ...opts, documentId: effectiveDocId });
          row.image_url = branded.imageUrl;
          row.asset_id = branded.assetId;
        } catch { await brandService.warnOptionalBrand(effectiveDocId, opts.workspaceId); }
      } else {
        await brandService.warnOptionalBrand(effectiveDocId, opts.workspaceId);
      }
    } catch { await brandService.warnOptionalBrand(effectiveDocId, opts.workspaceId); }

    const dispatchedAt = new Date().toISOString();
    const channels = Array.isArray(opts.channels) && opts.channels.length > 0 ? opts.channels : ["linkedin"];

    // Fetch connected accounts for this workspace
    const accountsRes = await pool.query(
      `SELECT id, platform, name FROM social_accounts WHERE workspace_id = $1 AND lower(state) = 'connected'`,
      [opts.workspaceId]
    );
    const connectedAccounts = accountsRes.rows;

    // Resolve high-converting structured caption with website, phone, highlights & hashtags
    let caption = (opts.caption && opts.caption.trim()) || (row.caption && row.caption.trim());
    if (!caption || caption.includes("In modern enterprise governance, foundational clarity")) {
      let contactInfo: any = {};
      try {
        const pagesRes = await pool.query(
          `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`,
          [effectiveDocId, opts.workspaceId]
        );
        contactInfo = extractContactInfoFromText(pagesRes.rows.map((p) => p.clean_text || ""));
      } catch {}

      caption = buildRichCaption({
        title: row.concept_title,
        companyName: brand.companyName,
        websiteDomain: brand.websiteDomain || contactInfo.website,
        phoneNumber: contactInfo.phone,
        excerpt: row.source_excerpt,
        prompt: row.prompt,
      });
      pool.query("UPDATE document_visual_concepts SET caption = $1 WHERE id = $2", [caption, row.id]).catch(() => {});
    }

    // Build platform-specific caption variants
    const variants: Record<string, any> = {};
    for (const ch of channels) {
      const customVariant = opts.variants?.[ch]?.caption;
      const platformCaption = customVariant || formatCaptionForPlatform(caption, ch);
      variants[ch] = {
        caption: platformCaption,
        mediaAssetId: row.asset_id,
        mediaUrl: row.image_url,
      };
    }

    const prepared = await transaction(async db => {
      const concept = (await db.query("SELECT content_id FROM document_visual_concepts WHERE id=$1 AND workspace_id=$2 FOR UPDATE",[opts.conceptId,opts.workspaceId])).rows[0];
      if (!concept) throw new Error("Visual concept not found.");
      if (concept.content_id && (await db.query("SELECT id FROM content WHERE id=$1 AND workspace_id=$2",[concept.content_id,opts.workspaceId])).rowCount) return concept.content_id;
      const id=randomUUID();
      await db.query("INSERT INTO content(id,workspace_id,created_by,updated_by,title,body,variants,platforms,status,image_asset_id) VALUES($1,$2,$3,$3,$4,$5,$6,$7,'DRAFT',$8)",[id,opts.workspaceId,opts.userId,row.concept_title,caption,JSON.stringify(variants),JSON.stringify(channels.map(ch=>Object.keys(PLATFORM_CAPABILITIES).find(p=>p.toLowerCase()===ch.toLowerCase())||ch)),row.asset_id||null]);
      await db.query("INSERT INTO content_versions(id,workspace_id,content_id,version,snapshot,created_by) SELECT $1,workspace_id,id,version,to_jsonb(content),$2 FROM content WHERE id=$3",[randomUUID(),opts.userId,id]);
      await db.query("UPDATE document_visual_concepts SET content_id=$1 WHERE id=$2 AND workspace_id=$3",[id,opts.conceptId,opts.workspaceId]);
      return id;
    });
    const results:any[]=[];
    const {publishContentNow}=await import("../publishing.js");
    for (const ch of channels) {
      const account=connectedAccounts.find((a:any)=>a.platform.toLowerCase()===ch.toLowerCase());
      if (!account) { results.push({platform:ch,success:false,error:"No healthy account"}); continue; }
      const done=(await pool.query("SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id=$2 AND account_id=$3 AND state='PUBLISHED'",[opts.workspaceId,prepared,account.id])).rowCount;
      if(done){results.push({platform:ch,success:true});continue;}
      try { results.push({platform:ch,...await publishContentNow(opts.workspaceId,opts.userId,prepared,account.id)}); }
      catch(e:any){results.push({platform:ch,success:false,error:e.message});}
    }
    const publishedCount=results.filter(r=>r.success).length;
    const success=results.length>0 && publishedCount===results.length;
    await pool.query("UPDATE document_visual_concepts SET status=CASE WHEN $1 THEN 'DISPATCHED' ELSE status END,dispatched_at=CASE WHEN $1 THEN now() ELSE dispatched_at END,target_channels=$2,post_result=$3::jsonb WHERE id=$4 AND workspace_id=$5",[success,JSON.stringify(channels),JSON.stringify(results),opts.conceptId,opts.workspaceId]);
    return {success,conceptId:opts.conceptId,dispatchedAt:success?dispatchedAt:"",publishedCount,contentId:prepared,results};
  }

  /**
   * Syncs and persists automated dispatch slots to the database
   */
  async syncSchedule(opts: {
    documentId: string;
    workspaceId: string;
    userId: string;
    slots: Array<{ time: string; label: string }>;
    channels: string[];
    timezone?: string;
  }): Promise<{
    success: boolean;
    scheduledCount: number;
    slots: any[];
  }> {
    const { documentId, workspaceId, slots } = opts;
    const safeChannels = Array.isArray(opts.channels) && opts.channels.length > 0 ? opts.channels : ["linkedin"];
    if (!slots || slots.length === 0) {
      return { success: false, scheduledCount: 0, slots: [] };
    }

    const sortedSlots = [...slots].sort((a, b) => a.time.localeCompare(b.time));

    const concepts = (
      await pool.query(
        `SELECT id, concept_title, source_page, prompt
         FROM document_visual_concepts
         WHERE document_id = $1 AND workspace_id = $2 AND (status IS NULL OR status != 'DISPATCHED')
         ORDER BY source_page ASC, created_at ASC`,
        [documentId, workspaceId]
      )
    ).rows;

    let timezone = opts.timezone;
    if (!timezone) {
      const wsRes = await pool.query(`SELECT timezone FROM workspaces WHERE id = $1`, [workspaceId]);
      timezone = wsRes.rows[0]?.timezone || 'Asia/Kolkata';
    }

    const now = new Date();
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const curHourStr = nowParts.find((p) => p.type === 'hour')?.value || '00';
    const curMinStr = nowParts.find((p) => p.type === 'minute')?.value || '00';
    const currentHour = parseInt(curHourStr === '24' ? '0' : curHourStr, 10);
    const currentMin = parseInt(curMinStr, 10);

    let dayOffset = 0;
    let slotIdx = sortedSlots.findIndex((s) => {
      const [h, m] = s.time.split(':').map(Number);
      return h > currentHour || (h === currentHour && m > currentMin);
    });

    if (slotIdx === -1) {
      dayOffset = 1;
      slotIdx = 0;
    }

    function parseDateInTz(y: string, mo: string, da: string, h: number, mi: number, tz: string): Date {
      const isoLocal = `${y}-${mo}-${da}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
      try {
        const d = new Date(isoLocal + 'Z');
        const targetStr = d.toLocaleString('en-US', { timeZone: tz });
        const targetDate = new Date(targetStr);
        const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
        const utcDate = new Date(utcStr);
        const offsetMs = targetDate.getTime() - utcDate.getTime();
        return new Date(d.getTime() - offsetMs);
      } catch {
        return new Date(isoLocal + 'Z');
      }
    }

    let count = 0;
    for (const c of concepts) {
      const slot = sortedSlots[slotIdx];
      const checkBase = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(checkBase);

      const y = parts.find((p) => p.type === 'year')?.value || '2026';
      const mo = parts.find((p) => p.type === 'month')?.value || '01';
      const da = parts.find((p) => p.type === 'day')?.value || '01';

      const [sh, sm] = slot.time.split(':').map(Number);
      const targetUtcDate = parseDateInTz(y, mo, da, sh, sm, timezone || 'Asia/Kolkata');

      await pool.query(
        `UPDATE document_visual_concepts
         SET scheduled_at = $1, target_channels = $2, status = 'PENDING', updated_at = NOW()
         WHERE id = $3`,
        [targetUtcDate.toISOString(), safeChannels, c.id]
      );
      count++;

      slotIdx++;
      if (slotIdx >= sortedSlots.length) {
        slotIdx = 0;
        dayOffset++;
      }
    }

    console.log(`[VisualConcepts] Successfully synced schedule for ${count} visual concepts on document ${documentId}`);
    return {
      success: true,
      scheduledCount: count,
      slots: sortedSlots,
    };
  }

  /**
   * Updates and saves the customized social media caption for a concept
   */
  async updateConceptCaption(opts: {
    documentId: string;
    conceptId: string;
    workspaceId: string;
    caption: string;
  }): Promise<{ success: boolean; conceptId: string; caption: string }> {
    await pool.query(
      `UPDATE document_visual_concepts
       SET caption = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [opts.caption.trim(), opts.conceptId, opts.workspaceId]
    );
    return {
      success: true,
      conceptId: opts.conceptId,
      caption: opts.caption.trim(),
    };
  }
}
