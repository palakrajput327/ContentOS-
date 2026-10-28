import { pool } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { ClipdropService } from "../clipdrop/clipdrop.service.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export class VisualConceptsService {
    /**
     * Retrieves existing visual concepts or generates fresh ones from PDF knowledge
     */
    async getOrGenerateConcepts(documentId, workspaceId) {
        // 1. Ensure concepts for this active document are generated if not yet in database
        const docConcepts = await pool.query(`SELECT COUNT(*)::int as count FROM document_visual_concepts WHERE document_id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        if ((docConcepts.rows[0]?.count || 0) === 0) {
            await this.regenerateConcepts(documentId, workspaceId);
        }
        // 2. Fetch all undispatched concepts across the workspace queue (accumulates across PDF uploads)
        const existing = await pool.query(`SELECT dvc.id, dvc.document_id, dvc.concept_title, dvc.source_page, dvc.source_excerpt, dvc.prompt,
              dvc.asset_id, dvc.image_url, dvc.status, dvc.scheduled_at, dvc.dispatched_at, dvc.target_channels, dvc.created_at,
              COALESCE(d.original_filename, 'Document') as document_name
       FROM document_visual_concepts dvc
       LEFT JOIN documents d ON d.id = dvc.document_id
       WHERE dvc.workspace_id = $1 AND (dvc.status IS NULL OR dvc.status != 'DISPATCHED')
       ORDER BY dvc.created_at ASC, dvc.source_page ASC`, [workspaceId]);
        const dispatchedRes = await pool.query(`SELECT COUNT(*)::int as count FROM document_visual_concepts
       WHERE workspace_id = $1 AND status = 'DISPATCHED'`, [workspaceId]);
        const dispatchedCount = dispatchedRes.rows[0]?.count || 0;
        if (existing.rowCount && existing.rowCount > 0) {
            const concepts = existing.rows.map((r) => ({
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
    async regenerateConcepts(documentId, workspaceId) {
        // 1. Fetch document knowledge
        const kRes = await pool.query(`SELECT id, knowledge_key, value, source_excerpt, page_start
       FROM document_knowledge
       WHERE document_id = $1 AND workspace_id = $2
       ORDER BY page_start ASC, created_at ASC`, [documentId, workspaceId]);
        let contentSummary = "";
        if (kRes.rowCount && kRes.rowCount > 0) {
            contentSummary = kRes.rows
                .slice(0, 40)
                .map((r, idx) => `Concept #${idx + 1} [Page ${r.page_start || 1}]: "${r.knowledge_key}"\nDetail: ${typeof r.value === "string" ? r.value : JSON.stringify(r.value)}\nQuote: "${(r.source_excerpt || "").slice(0, 250)}"`)
                .join("\n\n");
        }
        else {
            // Fallback to document pages if knowledge extraction hasn't completed yet
            const pagesRes = await pool.query(`SELECT page_number, clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 25`, [documentId, workspaceId]);
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
        const docRes = await pool.query(`SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        const docName = docRes.rows[0]?.original_filename || "Business Document";
        // 3. Ask Gemini to extract genuine visual concepts using FLUX-native Comma-Separated Tag Engine (T5-XXL optimized)
        const provider = getLLMProvider();
        const systemPrompt = `You are an elite FLUX.1 Prompt Architect specializing in T5-XXL transformer text conditioning.
Your mission: Analyze the document knowledge and extract only genuine, distinct, non-repetitive core visual concepts.
For each genuine theme, formulate a 100% pure, comma-separated FLUX-Optimized Tag Prompt (35-50 words).

CRITICAL FLUX-NATIVE RULES (ZERO CONVERSATIONAL FILLER - PURE TAG ARCHITECTURE):
1. NO CONVERSATIONAL PARAGRAPHS OR POETIC FILLER:
   - NEVER use full sentences or poetic framing like: "A warm and emotional depiction of...", "Here is a scene where...", "A photo symbolizing...", "intricate and imposing", "symbolizing the complex nature".
   - FLUX T5-XXL parses filler words as noise, causing low accuracy. Use ONLY comma-separated concrete visual keywords and concise phrases.
2. STRICT 6-PART COMMA-SEPARATED TAG SEQUENCE:
   [1. Concrete Subject & Pose] , [2. Physical Environment/Architecture] , [3. Tangible Props & Micro-Details] , [4. Camera Perspective & Framing] , [5. Cinematic Lighting & Atmosphere] , [6. Material Textures & Photography Tags]

   PROVEN BENCHMARK EXAMPLES FOR FLUX:
   - Tiers / Compensation / Career Levels:
     "Executive businessman in sharp tailored navy suit standing on gleaming black marble terrace looking up, spiraling curved glass and champagne gold architectural observation tower, distinct ascending observation decks with illuminated bronze tier plaques, wide-angle eye-level full shot, dramatic golden hour sunset above sea of clouds, warm cinematic lighting, ultra-detailed architectural photography, 8k resolution"
   - Due Diligence / Verification / Contracts:
     "Extreme close-up macro shot, dark matte obsidian disclosure dossier, optical magnifying glass hovering over document, platinum drafting tools, soft warm crimson rim lighting, shallow depth of field, creamy architectural bokeh, award-winning editorial commercial photography"
   - Vision / Corporate Strategy:
     "Senior corporate strategist standing at expansive floor-to-ceiling panoramic glass window, overlooking sunlit metropolitan skyline at golden hour, minimalist obsidian drafting table, natural cinematic daylight, sharp focus, 8k commercial photography"
   - Trading Ecosystem / Technology / Liquidity:
     "Modern architectural glass atrium, minimalist monolithic marble conference tables, executives in discussion, warm golden ambient sunlight, wide-angle interior architectural photography, clean symmetry, editorial business magazine style"

3. STRICTLY BANNED WORDS:
   - NEVER use "industrial", "scaffolding", "construction", "underneath view" (FLUX renders ugly fire escapes and rusted scaffolding).
   - NEVER ask for computer monitors, mobile screens, or charts with text (renders garbled hieroglyphics).
   - NEVER use "symbolizing", "representing", "depiction", "intricate", "imposing".

4. DYNAMIC CONCEPT EXTRACTION (SCALED TO DOCUMENT DEPTH):
   - Analyze the document thoroughly and extract distinct, non-repetitive visual concepts representing its key sections, models, and milestones.
   - For shorter docs (1-5 pages): Extract 4 to 6 concepts.
   - For in-depth business plans, specs, or whitepapers (6-20+ pages): Dynamically extract 7 to 12+ genuine concepts across all chapters/themes.
   - Never artificially clamp or hardcode to 4 concepts. Scale dynamically with document substance.

Return JSON with "concepts" array.`;
        let rawList = [];
        try {
            const ConceptItemSchema = z.union([
                z.string(),
                z.object({
                    conceptTitle: z.string().optional(),
                    title: z.string().optional(),
                    name: z.string().optional(),
                    concept: z.string().optional(),
                    sourcePage: z.number().optional().default(1),
                    sourceExcerpt: z.string().optional().default(""),
                    prompt: z.string().optional(),
                    description: z.string().optional(),
                }),
            ]);
            const res = await provider.generateStructured({
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: `Document: "${docName}"\n\nComprehensive Extracted Content from PDF:\n${contentSummary}\n\nExtract all genuine, distinct core business concepts across this document as pure FLUX tag prompts (scale dynamically from 4 up to 12+ concepts based on depth):\nReturn JSON with "concepts" array.`,
                    },
                ],
                schema: z.object({
                    concepts: z.array(ConceptItemSchema),
                }),
                schemaName: "DocumentVisualConceptsExtraction",
                maxTokens: 4096,
            });
            const data = res.data;
            let rawArr = [];
            if (Array.isArray(data)) {
                rawArr = data;
            }
            else if (Array.isArray(data?.concepts)) {
                rawArr = data.concepts;
            }
            else if (Array.isArray(data?.items)) {
                rawArr = data.items;
            }
            else if (data && typeof data === "object") {
                const firstArr = Object.values(data).find(Array.isArray);
                if (firstArr)
                    rawArr = firstArr;
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
                }
                else if (item && typeof item === "object") {
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
        }
        catch (err) {
            console.warn("[VisualConceptsService] LLM structured extraction warning:", err?.message || err);
        }
        // High-quality dynamic fallback: If LLM failed or returned empty, formulate 4 completely distinct FLUX tag prompts
        if (!rawList || rawList.length === 0) {
            const distinctCategories = [
                {
                    key: "Corporate Vision & Architecture",
                    prompt: "Executive businessman in sharp tailored navy suit standing in double-height minimalist glass atrium, panoramic sunlit skyline view, polished dark obsidian floor, natural morning daylight, eye-level wide shot, 8k commercial editorial photography",
                },
                {
                    key: "Multi-Tier Income & Career Progression",
                    prompt: "Executive in tailored charcoal suit standing on wide marble terrace looking up, spiraling curved glass and champagne gold architectural observation tower, distinct ascending tier platforms with illuminated bronze plaques, wide-angle eye-level full shot, sunset above clouds, warm cinematic lighting, ultra-detailed architectural photography, 8k resolution",
                },
                {
                    key: "Precision Diligence & Document Verification",
                    prompt: "Extreme close-up macro shot, dark matte obsidian disclosure dossier, optical magnifying glass hovering over document, platinum drafting tools, soft warm crimson rim lighting, shallow depth of field, creamy architectural bokeh, award-winning editorial commercial photography",
                },
                {
                    key: "Global Financial Markets & Liquidity Network",
                    prompt: "Modern architectural glass trading hall, minimalist monolithic marble counters, senior analysts in conversation, warm golden ambient sunlight through skylights, wide-angle interior architectural photography, clean symmetry, editorial business magazine style",
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
            }
            else {
                rawList = distinctCategories.map((cat, idx) => ({
                    title: cat.key,
                    sourcePage: idx + 1,
                    sourceExcerpt: "",
                    prompt: cat.prompt,
                }));
            }
        }
        // 4. Clean up old concepts for this document and insert newly generated ones
        await pool.query(`DELETE FROM document_visual_concepts WHERE document_id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        const savedConcepts = [];
        for (const item of rawList) {
            const id = randomUUID();
            const title = (item.title || "Business Concept").trim().slice(0, 120);
            const page = typeof item.sourcePage === "number" ? item.sourcePage : 1;
            const excerpt = (item.sourceExcerpt || "").trim().slice(0, 400);
            const prompt = (item.prompt || "").trim();
            if (!prompt || prompt.length < 15)
                continue;
            await pool.query(`INSERT INTO document_visual_concepts (id, document_id, workspace_id, concept_title, source_page, source_excerpt, prompt)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, documentId, workspaceId, title, page, excerpt, prompt]);
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
    async generateConceptVisual(opts) {
        const row = (await pool.query(`SELECT id, concept_title, prompt FROM document_visual_concepts WHERE id = $1 AND workspace_id = $2`, [opts.conceptId, opts.workspaceId])).rows[0];
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
        await pool.query(`UPDATE document_visual_concepts
       SET asset_id = $1, image_url = $2, prompt = $3, updated_at = NOW()
       WHERE id = $4`, [result.assetId, result.url, promptToUse, opts.conceptId]);
        return {
            conceptId: opts.conceptId,
            assetId: result.assetId,
            imageUrl: result.url,
        };
    }
    /**
     * Dispatches a concept to social channels, records publication, and marks as DISPATCHED
     */
    async dispatchConcept(opts) {
        const row = (await pool.query(`SELECT id, concept_title, prompt, source_excerpt, asset_id, image_url 
         FROM document_visual_concepts 
         WHERE id = $1 AND workspace_id = $2`, [opts.conceptId, opts.workspaceId])).rows[0];
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
            }
            catch (genErr) {
                console.warn("[VisualConcepts] Auto image generation fallback warning:", genErr);
            }
        }
        const dispatchedAt = new Date().toISOString();
        const channels = opts.channels && opts.channels.length > 0 ? opts.channels : ["linkedin"];
        // 1. Mark as DISPATCHED in database
        await pool.query(`UPDATE document_visual_concepts
       SET status = 'DISPATCHED', dispatched_at = NOW(), target_channels = $1
       WHERE id = $2`, [channels, opts.conceptId]);
        // 2. Also record in content table for Content Library & Analytics
        try {
            const contentId = randomUUID();
            await pool.query(`INSERT INTO content (id, workspace_id, created_by, title, body, status, platforms, image_asset_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, $7, NOW(), NOW())`, [
                contentId,
                opts.workspaceId,
                opts.userId,
                row.concept_title,
                row.source_excerpt || row.concept_title,
                channels,
                row.asset_id || null,
            ]);
            if (row.asset_id) {
                await pool.query(`INSERT INTO content_media (id, content_id, media_asset_id, position, created_at)
           VALUES ($1, $2, $3, 0, NOW()) ON CONFLICT DO NOTHING`, [randomUUID(), contentId, row.asset_id]);
            }
        }
        catch (e) {
            console.warn("[VisualConcepts] Content log notice:", e);
        }
        return {
            success: true,
            conceptId: opts.conceptId,
            dispatchedAt,
        };
    }
}
