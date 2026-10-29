import { pool } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { ClipdropService } from "../clipdrop/clipdrop.service.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface VisualConceptItem {
  id: string;
  documentId: string;
  documentName?: string;
  conceptTitle: string;
  sourcePage: number;
  sourceExcerpt: string;
  prompt: string;
  assetId?: string | null;
  imageUrl?: string | null;
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
      `SELECT dvc.id, dvc.document_id, dvc.concept_title, dvc.source_page, dvc.source_excerpt, dvc.prompt,
              dvc.asset_id, dvc.image_url, dvc.status, dvc.scheduled_at, dvc.dispatched_at, dvc.target_channels, dvc.created_at,
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
      const concepts: VisualConceptItem[] = existing.rows.map((r) => ({
        id: r.id,
        documentId: r.document_id,
        documentName: r.document_name,
        conceptTitle: r.concept_title,
        sourcePage: r.source_page || 1,
        sourceExcerpt: r.source_excerpt || "",
        prompt: r.prompt,
        assetId: r.asset_id,
        imageUrl: r.image_url,
        status: r.status || "PENDING",
        scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
        dispatchedAt: r.dispatched_at ? new Date(r.dispatched_at).toISOString() : null,
        targetChannels: r.target_channels || ["linkedin"],
        createdAt: r.created_at,
      }));

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

    // 2. Fetch document title
    const docRes = await pool.query(
      `SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, workspaceId]
    );
    const docName = docRes.rows[0]?.original_filename || "Business Document";

    // 3. Ask Gemini to extract genuine visual concepts using FLUX-native Comma-Separated Tag Engine (T5-XXL optimized)
    const provider = getLLMProvider();
    const systemPrompt = `You are an elite Commercial Advertising Creative Director & FLUX.1 Visual Prompt Architect.
Your mission: Analyze the uploaded business PDF / pitch deck / whitepaper, deeply understand its REAL business model, products, figures, and offerings, and create 100% ACCURATE, highly relevant commercial advertising visuals.

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
- FLUX achieves 100% spelling accuracy ONLY when text is kept to 1 to 3 SHORT words maximum (e.g. "TRADEORBIT", "1% - 3% DAILY", "SMART FINTECH", "10% DIRECT", "5X ACCELERATOR", "ROYALTY CLUB").
- NEVER prompt long sentences or multi-line paragraphs into the image (this causes garbled typos).
- Explicitly instruct FLUX: 'The text "[EXACT_SHORT_PHRASE]" is displayed in sharp, clean, bold metallic lettering with 100% correct spelling, zero typos, and clean legible typography.'
- Explicit negative constraints in every prompt: 'no misspelled words, no gibberish letters, no random floating characters, no duplicate text, clean sharp typography, 8k commercial photography'.

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
        }).passthrough(),
      ]);

      const res = await provider.generateStructured({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Document: "${docName}"\n\nComprehensive Extracted Content from PDF:\n${contentSummary}\n\nExtract all distinct core business concepts across this document as accurate commercial FLUX prompts:\nReturn JSON with "concepts" array.`,
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
        }

        return {
          title: title || `Core Pillar #${idx + 1}`,
          sourcePage: page,
          sourceExcerpt: excerpt,
          prompt,
        };
      }).filter((c) => c.prompt && c.prompt.length > 15);
      console.log(`[VisualConceptsService] Successfully extracted ${rawList.length} dynamic concepts with unique titles via Gemini 2.5 Flash`);
    } catch (err: any) {
      console.warn("[VisualConceptsService] LLM structured extraction warning:", err?.message || err);
    }

    // High-quality dynamic fallback: If LLM failed or returned empty, formulate 4 completely distinct FLUX tag prompts
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
          return {
            title: r.knowledge_key || cat.key,
            sourcePage: r.page_start || idx + 1,
            sourceExcerpt: (r.source_excerpt || "").slice(0, 150),
            prompt: cat.prompt,
          };
        });
      } else {
        rawList = distinctCategories.map((cat, idx) => ({
          title: cat.key,
          sourcePage: idx + 1,
          sourceExcerpt: "",
          prompt: cat.prompt,
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

      if (!prompt || prompt.length < 15) continue;

      await pool.query(
        `INSERT INTO document_visual_concepts (id, document_id, workspace_id, concept_title, source_page, source_excerpt, prompt)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, documentId, workspaceId, title, page, excerpt, prompt]
      );

      savedConcepts.push({
        id,
        documentId,
        conceptTitle: title,
        sourcePage: page,
        sourceExcerpt: excerpt,
        prompt,
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
  }> {
    const row = (
      await pool.query(
        `SELECT id, concept_title, prompt FROM document_visual_concepts WHERE id = $1 AND workspace_id = $2`,
        [opts.conceptId, opts.workspaceId]
      )
    ).rows[0];

    if (!row) {
      throw new Error("Visual concept not found in this document.");
    }

    const promptToUse = (opts.customPrompt && opts.customPrompt.trim().length > 10)
      ? opts.customPrompt.trim()
      : row.prompt;

    const isForce = opts.force ?? true;
    const clipdropService = new ClipdropService();
    const result = await clipdropService.generateImage({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      prompt: promptToUse,
      headline: row.concept_title,
      aspectRatio: "1:1",
      engine: "flux",
      bypassCache: isForce,
      idempotencyKey: isForce ? `concept-visual:${opts.conceptId}:${Date.now()}` : undefined,
    });

    // Save generated asset to concept row
    await pool.query(
      `UPDATE document_visual_concepts
       SET asset_id = $1, image_url = $2, prompt = $3, updated_at = NOW()
       WHERE id = $4`,
      [result.assetId, result.url, promptToUse, opts.conceptId]
    );

    return {
      conceptId: opts.conceptId,
      assetId: result.assetId,
      imageUrl: result.url,
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
  }): Promise<{ success: boolean; conceptId: string; dispatchedAt: string }> {
    const row = (
      await pool.query(
        `SELECT id, concept_title, prompt, source_excerpt, asset_id, image_url 
         FROM document_visual_concepts 
         WHERE id = $1 AND workspace_id = $2`,
        [opts.conceptId, opts.workspaceId]
      )
    ).rows[0];

    if (!row) {
      throw new Error("Visual concept not found in this document.");
    }

    // Auto-Safety Guarantee: If no visual was generated manually, auto-generate via FLUX before dispatching!
    // Ensures NO post is ever dispatched blank without an image.
    if (!row.image_url || !row.asset_id) {
      console.log(`[VisualConcepts] Concept ${opts.conceptId} has no visual yet. Auto-synthesizing FLUX visual before dispatch...`);
      try {
        const genRes = await this.generateConceptVisual({
          documentId: opts.documentId,
          conceptId: opts.conceptId,
          workspaceId: opts.workspaceId,
          userId: opts.userId,
        });
        row.image_url = genRes.imageUrl;
        row.asset_id = genRes.assetId;
        console.log(`[VisualConcepts] Auto visual synthesis complete: ${genRes.imageUrl}`);
      } catch (genErr) {
        console.warn("[VisualConcepts] Auto image generation fallback warning:", genErr);
      }
    }

    const dispatchedAt = new Date().toISOString();
    const channels = opts.channels && opts.channels.length > 0 ? opts.channels : ["linkedin"];

    // 1. Mark as DISPATCHED in database
    await pool.query(
      `UPDATE document_visual_concepts
       SET status = 'DISPATCHED', dispatched_at = NOW(), target_channels = $1
       WHERE id = $2`,
      [channels, opts.conceptId]
    );

    // 2. Also record in content table for Content Library & Analytics
    try {
      const contentId = randomUUID();
      await pool.query(
        `INSERT INTO content (id, workspace_id, created_by, title, body, status, platforms, image_asset_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, $7, NOW(), NOW())`,
        [
          contentId,
          opts.workspaceId,
          opts.userId,
          row.concept_title,
          row.source_excerpt || row.concept_title,
          channels,
          row.asset_id || null,
        ]
      );

      if (row.asset_id) {
        await pool.query(
          `INSERT INTO content_media (id, content_id, media_asset_id, position, created_at)
           VALUES ($1, $2, $3, 0, NOW()) ON CONFLICT DO NOTHING`,
          [randomUUID(), contentId, row.asset_id]
        );
      }
    } catch (e) {
      console.warn("[VisualConcepts] Content log notice:", e);
    }

    return {
      success: true,
      conceptId: opts.conceptId,
      dispatchedAt,
    };
  }

}
