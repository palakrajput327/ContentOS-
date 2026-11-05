import { pool } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { loadImage } from "@napi-rs/canvas";

export interface WorkspaceBrandDna {
  workspaceId: string;
  companyName: string;
  industry: string;
  targetAudience: string;
  communicationTone: string;
  brandColors: string[];
  typographyStyle: string;
  visualStyle: string;
  logoUrl?: string | null;
  logoAssetId?: string | null;
  logoPosition: string;
  websiteDomain: string;
  preferredLanguage: string;
  ctaStyle: string;
  creativeGuidelines: string;
  status: "PENDING_REVIEW" | "APPROVED" | "ACTIVE" | "MANUAL";
  sourceDocumentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class BrandDnaService {
  /**
   * Retrieves or initializes the Brand DNA for a workspace
   */
  async getBrandDna(workspaceId: string): Promise<WorkspaceBrandDna> {
    const existing = await pool.query(
      `SELECT * FROM workspace_brand_dna WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (existing.rowCount && existing.rows[0]) {
      return this.mapRow(existing.rows[0]);
    }

    // Attempt to seed from existing document_brand_identities or workspace name
    const docBrandRes = await pool.query(
      `SELECT * FROM document_brand_identities WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [workspaceId]
    );

    const wsRes = await pool.query(`SELECT name FROM workspaces WHERE id = $1`, [workspaceId]);
    const wsName = wsRes.rows[0]?.name || "My Brand";

    let companyName = wsName;
    let websiteDomain = "";
    let brandColors = ["#f97316", "#0f172a", "#38bdf8"]; // Graphite Orange primary palette
    let logoUrl: string | null = null;
    let logoAssetId: string | null = null;
    let sourceDocumentId: string | null = null;

    if (docBrandRes.rowCount && docBrandRes.rows[0]) {
      const b = docBrandRes.rows[0];
      companyName = b.company_name || wsName;
      websiteDomain = b.website_domain || "";
      if (Array.isArray(b.brand_colors) && b.brand_colors.length) {
        brandColors = b.brand_colors;
      }
      logoUrl = b.logo_url || null;
      logoAssetId = b.logo_asset_id || null;
      sourceDocumentId = b.document_id || null;
    }

    const inserted = await pool.query(
      `INSERT INTO workspace_brand_dna (
        workspace_id, company_name, industry, target_audience, communication_tone,
        brand_colors, typography_style, visual_style, logo_url, logo_asset_id,
        logo_position, website_domain, preferred_language, cta_style, creative_guidelines,
        status, source_document_id
      ) VALUES (
        $1, $2, 'Fintech & Digital Business', 'Entrepreneurs, Executives & Investors', 'Authoritative, Premium & Inspiring',
        $3::jsonb, 'Modern Geometric Sans-Serif', 'Sleek Dark Obsidian & Minimalist Accent', $4, $5,
        'top-right', $6, 'English', 'Explore Frameworks & Staking Solutions', 'Maintain bold contrast, generous whitespace, legible typographic hierarchy, and avoid clutter.',
        'PENDING_REVIEW', $7
      )
      ON CONFLICT (workspace_id) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [workspaceId, companyName, JSON.stringify(brandColors), logoUrl, logoAssetId, websiteDomain, sourceDocumentId]
    );

    return this.mapRow(inserted.rows[0]);
  }

  /**
   * Intelligently extracts Brand DNA from uploaded document chunks or text prompt
   */
  async extractBrandDna(opts: {
    workspaceId: string;
    documentId?: string;
    rawText?: string;
    url?: string;
  }): Promise<WorkspaceBrandDna> {
    let sourceContent = opts.rawText || "";
    let companyNameHint = "";
    let detectedDomain = "";

    if (opts.documentId) {
      const docRes = await pool.query(
        `SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`,
        [opts.documentId, opts.workspaceId]
      );
      if (!docRes.rowCount) throw new NotFoundException("Document not found in workspace.");
      companyNameHint = (docRes.rows[0].original_filename || "")
        .replace(/\.pdf$/i, "")
        .replace(/[_-\s]*(Final|Draft|Version|v\d+|\d+_Page|Business_Plan|Pitch_Deck|Presentation|Deck|Whitepaper|Overview).*/i, "")
        .replace(/[_-\s]+/g, " ")
        .trim();

      const pagesRes = await pool.query(
        `SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 10`,
        [opts.documentId, opts.workspaceId]
      );
      const combinedPages = pagesRes.rows.map((p) => p.clean_text).join("\n\n");
      if (combinedPages.length > 50) {
        sourceContent = combinedPages.slice(0, 8000);
      }

      // Check for website domain
      const domainMatch = combinedPages.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:live|com|org|io|net|in|ai|app|co|tech|world)[a-zA-Z0-9.\-_]*)/i);
      if (domainMatch && domainMatch[1]) {
        detectedDomain = domainMatch[1].toLowerCase().replace(/\/.*$/, "");
        if (!detectedDomain.startsWith("www.")) detectedDomain = `www.${detectedDomain}`;
      }
    }

    const llm = getLLMProvider();
    const prompt = `You are a Chief Brand Officer and Instagram Creative Director. Analyze the following corporate content and extract a comprehensive Brand DNA profile for Instagram content creation:

---
${sourceContent ? sourceContent.slice(0, 4000) : `Company hint: ${companyNameHint || "Digital Business"}`}
---

Return ONLY valid JSON matching this exact structure:
{
  "companyName": "${companyNameHint || "Brand Name"}",
  "industry": "e.g. Fintech, SaaS, E-Commerce, Consulting, Healthcare",
  "targetAudience": "e.g. Tech-forward founders and high-net-worth investors",
  "communicationTone": "e.g. Authoritative, Visionary, Direct & Engaging",
  "brandColors": ["#0f172a", "#f97316", "#38bdf8"],
  "typographyStyle": "e.g. Bold Geometric Sans-Serif",
  "visualStyle": "e.g. Dark Obsidian Glassmorphism with Warm Amber Accents",
  "websiteDomain": "${detectedDomain || "www.example.com"}",
  "preferredLanguage": "English",
  "ctaStyle": "e.g. Swipe to Transform Your Strategy",
  "creativeGuidelines": "Key visual principles for Instagram: high-contrast headings, 4:5 vertical framing, minimal clutter, strong hook slides."
}`;

    let parsed: any = {};
    try {
      const res = await llm.generateText({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });
      const cleaned = (res.text || "").replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {
        companyName: companyNameHint || "TradeOrbit",
        industry: "Financial Technology & Digital Assets",
        targetAudience: "Strategic Investors & Modern Entrepreneurs",
        communicationTone: "Executive, Direct & Visionary",
        brandColors: ["#0f172a", "#f97316", "#38bdf8"],
        typographyStyle: "Bold Clean Sans-Serif",
        visualStyle: "Graphite Obsidian with High-Tech Amber Lighting",
        websiteDomain: detectedDomain || "www.tradeorbit.world",
        preferredLanguage: "English",
        ctaStyle: "Discover More & Elevate Your Portfolio",
        creativeGuidelines: "4:5 vertical canvas, sharp typography, verified metrics, zero fluff.",
      };
    }

    const updated = await pool.query(
      `INSERT INTO workspace_brand_dna (
        workspace_id, company_name, industry, target_audience, communication_tone,
        brand_colors, typography_style, visual_style, website_domain,
        preferred_language, cta_style, creative_guidelines, status, source_document_id, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7, $8, $9,
        $10, $11, $12, 'PENDING_REVIEW', $13, NOW()
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        industry = EXCLUDED.industry,
        target_audience = EXCLUDED.target_audience,
        communication_tone = EXCLUDED.communication_tone,
        brand_colors = EXCLUDED.brand_colors,
        typography_style = EXCLUDED.typography_style,
        visual_style = EXCLUDED.visual_style,
        website_domain = COALESCE(NULLIF(EXCLUDED.website_domain, ''), workspace_brand_dna.website_domain),
        preferred_language = EXCLUDED.preferred_language,
        cta_style = EXCLUDED.cta_style,
        creative_guidelines = EXCLUDED.creative_guidelines,
        status = 'PENDING_REVIEW',
        source_document_id = COALESCE(EXCLUDED.source_document_id, workspace_brand_dna.source_document_id),
        updated_at = NOW()
      RETURNING *`,
      [
        opts.workspaceId,
        parsed.companyName || companyNameHint || "Brand",
        parsed.industry || "Technology",
        parsed.targetAudience || "Business Executives",
        parsed.communicationTone || "Professional & Visionary",
        JSON.stringify(Array.isArray(parsed.brandColors) ? parsed.brandColors.slice(0, 5) : ["#0f172a", "#f97316", "#38bdf8"]),
        parsed.typographyStyle || "Modern Clean Sans-Serif",
        parsed.visualStyle || "Minimal High-Tech",
        parsed.websiteDomain || detectedDomain || "",
        parsed.preferredLanguage || "English",
        parsed.ctaStyle || "Explore Frameworks",
        parsed.creativeGuidelines || "High contrast, verified statistics, clean safe margins.",
        opts.documentId || null,
      ]
    );

    return this.mapRow(updated.rows[0]);
  }

  /**
   * Updates and saves approved Brand DNA
   */
  async updateBrandDna(workspaceId: string, updates: Partial<WorkspaceBrandDna>): Promise<WorkspaceBrandDna> {
    const existing = await this.getBrandDna(workspaceId);

    const companyName = updates.companyName?.trim() || existing.companyName;
    const industry = updates.industry?.trim() || existing.industry;
    const targetAudience = updates.targetAudience?.trim() || existing.targetAudience;
    const communicationTone = updates.communicationTone?.trim() || existing.communicationTone;
    const brandColors = Array.isArray(updates.brandColors) && updates.brandColors.length ? updates.brandColors : existing.brandColors;
    const typographyStyle = updates.typographyStyle?.trim() || existing.typographyStyle;
    const visualStyle = updates.visualStyle?.trim() || existing.visualStyle;
    const websiteDomain = updates.websiteDomain !== undefined ? updates.websiteDomain.trim() : existing.websiteDomain;
    const preferredLanguage = updates.preferredLanguage?.trim() || existing.preferredLanguage;
    const ctaStyle = updates.ctaStyle?.trim() || existing.ctaStyle;
    const creativeGuidelines = updates.creativeGuidelines?.trim() || existing.creativeGuidelines;
    const logoPosition = updates.logoPosition || existing.logoPosition;
    const status = updates.status || "APPROVED";

    const res = await pool.query(
      `UPDATE workspace_brand_dna SET
        company_name = $1,
        industry = $2,
        target_audience = $3,
        communication_tone = $4,
        brand_colors = $5::jsonb,
        typography_style = $6,
        visual_style = $7,
        website_domain = $8,
        preferred_language = $9,
        cta_style = $10,
        creative_guidelines = $11,
        logo_position = $12,
        status = $13,
        updated_at = NOW()
      WHERE workspace_id = $14
      RETURNING *`,
      [
        companyName,
        industry,
        targetAudience,
        communicationTone,
        JSON.stringify(brandColors),
        typographyStyle,
        visualStyle,
        websiteDomain,
        preferredLanguage,
        ctaStyle,
        creativeGuidelines,
        logoPosition,
        status,
        workspaceId,
      ]
    );

    return this.mapRow(res.rows[0]);
  }

  /**
   * Uploads and attaches a logo directly to Brand DNA
   */
  async uploadBrandLogo(opts: {
    workspaceId: string;
    userId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<{ logoUrl: string; logoAssetId: string; brandColors: string[] }> {
    if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(opts.mimeType) || opts.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException("Upload a PNG, JPEG, WebP or SVG logo up to 5MB.");
    }

    const { provider, bucket } = getStorageProvider();
    const assetId = randomUUID();
    const ext = opts.filename.includes(".") ? opts.filename.slice(opts.filename.lastIndexOf(".")) : ".png";
    const objectKey = `workspaces/${opts.workspaceId}/brand_dna/logo_${assetId}${ext}`;

    await uploadManagedMedia({
      assetId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      provider,
      bucket,
      objectKey,
      body: opts.buffer,
      mimeType: opts.mimeType,
      filename: `brand_logo_${opts.filename}`,
      type: "IMAGE",
      metadata: { original_filename: opts.filename },
    });

    const logoUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 365 * 86400);

    // Auto-detect dominant colors from uploaded logo
    let detectedColors: string[] = ["#0f172a", "#f97316", "#38bdf8"];
    try {
      const img = await loadImage(opts.buffer);
      const { createCanvas } = await import("@napi-rs/canvas");
      const canvas = createCanvas(Math.min(img.width, 200), Math.min(img.height, 200));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const colorCounts = new Map<string, number>();
      for (let i = 0; i < imgData.data.length; i += 16) {
        const a = imgData.data[i + 3];
        if (a < 120) continue; // Skip transparency
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        // Skip pure white/black
        if (r > 240 && g > 240 && b > 240) continue;
        if (r < 20 && g < 20 && b < 20) continue;
        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
        colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
      }
      const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
      if (sorted.length > 0) {
        detectedColors = sorted;
      }
    } catch {}

    await pool.query(
      `UPDATE workspace_brand_dna
       SET logo_url = $1, logo_asset_id = $2, brand_colors = $3::jsonb, updated_at = NOW()
       WHERE workspace_id = $4`,
      [logoUrl, assetId, JSON.stringify(detectedColors), opts.workspaceId]
    );

    return { logoUrl, logoAssetId: assetId, brandColors: detectedColors };
  }

  private mapRow(r: any): WorkspaceBrandDna {
    return {
      workspaceId: r.workspace_id,
      companyName: r.company_name || "My Brand",
      industry: r.industry || "Technology",
      targetAudience: r.target_audience || "Decision Makers",
      communicationTone: r.communication_tone || "Professional & Authoritative",
      brandColors: Array.isArray(r.brand_colors) ? r.brand_colors : ["#0f172a", "#f97316", "#38bdf8"],
      typographyStyle: r.typography_style || "Modern Clean Sans-Serif",
      visualStyle: r.visual_style || "Minimal High-Tech",
      logoUrl: r.logo_url || null,
      logoAssetId: r.logo_asset_id || null,
      logoPosition: r.logo_position || "top-right",
      websiteDomain: r.website_domain || "",
      preferredLanguage: r.preferred_language || "English",
      ctaStyle: r.cta_style || "Explore Insights",
      creativeGuidelines: r.creative_guidelines || "",
      status: r.status || "PENDING_REVIEW",
      sourceDocumentId: r.source_document_id || null,
      createdAt: r.created_at?.toISOString() || new Date().toISOString(),
      updatedAt: r.updated_at?.toISOString() || new Date().toISOString(),
    };
  }
}

