import { pool } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { z } from "zod";
const businessProfileSchema = z.object({
    companyName: z.string().default("Business Entity"),
    industry: z.string().default("General Business"),
    targetAudience: z.string().default("Professional & Commercial"),
    positioning: z.string().default("Modern Professional Solutions"),
    brandColors: z.array(z.string()).default([]),
    visualPersonality: z.string().default("Premium Editorial & Architectural"),
    productsAndOfferings: z.array(z.object({
        name: z.string(),
        features: z.array(z.string()).default([]),
        tiersOrPricing: z.string().optional(),
    })).default([]),
    numericDataAndTiers: z.array(z.object({
        metric: z.string(),
        value: z.string(),
        rulesOrQualifications: z.string().default(""),
    })).default([]),
    differentiators: z.array(z.string()).default([]),
    restrictions: z.array(z.string()).default([]),
});
export class BusinessProfileService {
    /**
     * Loads cached Business Knowledge Profile or builds one from document chunks
     */
    async getOrBuildProfile(documentId, workspaceId, forceRebuild = false) {
        if (!forceRebuild) {
            const cached = await pool.query(`SELECT value FROM document_knowledge 
         WHERE document_id = $1 AND workspace_id = $2 AND knowledge_key = 'BUSINESS_KNOWLEDGE_PROFILE'`, [documentId, workspaceId]);
            if (cached.rows.length > 0 && cached.rows[0].value) {
                return cached.rows[0].value;
            }
        }
        // 1. Gather document details & chunks
        const docRes = await pool.query(`SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        const docName = docRes.rows[0]?.original_filename || "Business Document";
        // Grab first 8 chunks or highest density chunks
        const chunksRes = await pool.query(`SELECT content, page_start FROM document_chunks 
       WHERE document_id = $1 AND workspace_id = $2 
       ORDER BY chunk_index ASC LIMIT 10`, [documentId, workspaceId]);
        // Also grab existing extracted knowledge facts if available
        const factsRes = await pool.query(`SELECT knowledge_key, value, source_excerpt, page_start FROM document_knowledge 
       WHERE document_id = $1 AND workspace_id = $2 AND knowledge_key != 'BUSINESS_KNOWLEDGE_PROFILE'
       LIMIT 15`, [documentId, workspaceId]);
        const docText = chunksRes.rows.map((c) => `[Page ${c.page_start}] ${c.content}`).join("\n\n");
        const factsSummary = factsRes.rows.map((f) => `- ${f.knowledge_key}: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`).join("\n");
        const provider = getLLMProvider();
        const systemPrompt = `You are an elite Business Knowledge Analyst and Corporate Profiler.
Your job is to read an uploaded business document and extract a comprehensive, structured "Business Knowledge Profile".
This profile will be cached and reused to direct corporate communication, creative art direction, and brand-aware image generation.

EXTRACTION OBJECTIVES:
1. Company Name & Industry: Deduce the exact organization and domain (e.g. Finance, Healthcare, Real Estate, SaaS, Renewable Energy).
2. Positioning & Audience: Commercial standing, target market, tone.
3. Brand Colors & Visual Personality: Identify explicit brand colors or recommend an authentic, elegant palette suited for this industry (e.g. navy blue and platinum silver, forest green and warm brass, charcoal and copper).
4. Products / Services: Discrete offerings, features, structures.
5. Numeric Data & Tiers: Any pricing tiers, milestone levels, qualifications, percentages, or metrics.
6. Differentiators: What sets this entity apart.
7. Content Restrictions: Things the document does NOT support, forbidden buzzwords, or unverified claims that visual generators must avoid (e.g. do not show floating money, generic crypto coins, random holograms, or unrelated festive elements like diyas/garlands).`;
        const userMessage = `Document Filename: "${docName}"

EXTRACTED KNOWLEDGE FACTS:
${factsSummary || "None available yet."}

DOCUMENT EXCERPTS:
${docText.slice(0, 4000) || "No document text available."}`;
        try {
            if (await provider.validateConfiguration()) {
                const res = await provider.generateStructured({
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMessage },
                    ],
                    schema: businessProfileSchema,
                    schemaName: "BusinessKnowledgeProfileExtraction",
                });
                const parsed = businessProfileSchema.parse(res.data);
                const profile = {
                    ...parsed,
                    sourceCitations: chunksRes.rows.slice(0, 5).map((c) => ({
                        page: c.page_start,
                        passage: (c.content || "").slice(0, 150),
                    })),
                    extractedAt: new Date().toISOString(),
                };
                // Cache into document_knowledge
                await pool.query(`INSERT INTO document_knowledge (
            id, workspace_id, document_id, knowledge_type, knowledge_key, value, confidence, status, created_at, updated_at
           ) VALUES (
            gen_random_uuid(), $1, $2, 'BUSINESS_PROFILE', 'BUSINESS_KNOWLEDGE_PROFILE', $3, 0.98, 'READY', NOW(), NOW()
           )
           ON CONFLICT DO NOTHING`, [workspaceId, documentId, JSON.stringify(profile)]);
                return profile;
            }
        }
        catch (err) {
            console.warn("[BusinessProfileService] Extraction warning:", err.message || err);
        }
        // Fallback baseline profile
        const fallbackProfile = {
            companyName: docName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
            industry: "Corporate & Professional",
            targetAudience: "Professional Stakeholders",
            positioning: "Commercial Excellence",
            brandColors: ["#1E3A8A", "#64748B", "#F8FAFC"],
            visualPersonality: "Clean Architectural Editorial",
            productsAndOfferings: [],
            numericDataAndTiers: [],
            differentiators: ["Clear systematic structure"],
            restrictions: [
                "Do not generate generic sci-fi holograms or random floating symbols",
                "Do not depict unrelated festive decorations like diyas or firecrackers",
                "Do not invent unverified financial returns or currency symbols",
            ],
            sourceCitations: [],
            extractedAt: new Date().toISOString(),
        };
        return fallbackProfile;
    }
}
