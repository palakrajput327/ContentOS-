import { pool } from "../db.js";
import { randomUUID } from "node:crypto";
import { getStorageProvider } from "../storage/storage.factory.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
export class BrandIdentityService {
    /**
     * Helper to retrieve or automatically extract brand identity for a specific document
     */
    async getOrCreateBrandIdentity(documentId, workspaceId) {
        const existing = await pool.query(`SELECT * FROM document_brand_identities WHERE document_id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        if (existing.rowCount && existing.rowCount > 0) {
            return this.mapRow(existing.rows[0]);
        }
        // Auto-detect brand identity from PDF document metadata, pages, and extracted media
        return this.autoDetectBrandIdentity(documentId, workspaceId);
    }
    /**
     * Updates brand identity configuration for a document
     */
    async updateBrandIdentity(documentId, workspaceId, data) {
        const current = await this.getOrCreateBrandIdentity(documentId, workspaceId);
        const companyName = data.companyName !== undefined ? data.companyName.trim() : current.companyName;
        const logoUrl = data.logoUrl !== undefined ? data.logoUrl : current.logoUrl;
        const logoAssetId = data.logoAssetId !== undefined ? data.logoAssetId : current.logoAssetId;
        const websiteDomain = data.websiteDomain !== undefined ? data.websiteDomain.trim() : current.websiteDomain;
        const brandColors = Array.isArray(data.brandColors) && data.brandColors.length > 0
            ? data.brandColors
            : current.brandColors;
        const applyToAllPosters = data.applyToAllPosters !== undefined ? Boolean(data.applyToAllPosters) : current.applyToAllPosters;
        const logoPosition = data.logoPosition || current.logoPosition || "bottom-right";
        const domainPosition = data.domainPosition || current.domainPosition || "bottom-center";
        const logoSize = data.logoSize || current.logoSize || "medium";
        const safeMargin = typeof data.safeMargin === "number" ? data.safeMargin : current.safeMargin || 32;
        const status = data.status || "CONFIRMED";
        const updated = await pool.query(`UPDATE document_brand_identities
       SET company_name = $1,
           logo_url = $2,
           logo_asset_id = $3,
           website_domain = $4,
           brand_colors = $5,
           apply_to_all_posters = $6,
           logo_position = $7,
           domain_position = $8,
           logo_size = $9,
           safe_margin = $10,
           status = $11,
           updated_at = NOW()
       WHERE document_id = $12 AND workspace_id = $13
       RETURNING *`, [
            companyName,
            logoUrl,
            logoAssetId,
            websiteDomain,
            JSON.stringify(brandColors),
            applyToAllPosters,
            logoPosition,
            domainPosition,
            logoSize,
            safeMargin,
            status,
            documentId,
            workspaceId,
        ]);
        return this.mapRow(updated.rows[0]);
    }
    /**
     * Upload a custom brand logo image for this document
     */
    async uploadLogo(opts) {
        const { provider, bucket } = getStorageProvider();
        const assetId = randomUUID();
        const ext = opts.filename.includes(".") ? opts.filename.slice(opts.filename.lastIndexOf(".")) : ".png";
        const objectKey = `workspaces/${opts.workspaceId}/brand_logos/${opts.documentId}/${assetId}${ext}`;
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
            metadata: {
                document_id: opts.documentId,
                original_filename: opts.filename,
            },
        });
        const downloadUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 365 * 86400);
        // Save directly to document_brand_identities
        await pool.query(`UPDATE document_brand_identities
       SET logo_url = $1, logo_asset_id = $2, status = 'CONFIRMED', updated_at = NOW()
       WHERE document_id = $3 AND workspace_id = $4`, [downloadUrl, assetId, opts.documentId, opts.workspaceId]);
        return {
            logoUrl: downloadUrl,
            logoAssetId: assetId,
        };
    }
    /**
     * Programmatically composites logo and website domain onto an AI-generated poster
     * Never relies on AI to hallucinate or misspell logos and domains.
     */
    async composeBrandOverlay(opts) {
        const { backgroundBuffer, brand } = opts;
        const bgImage = await loadImage(backgroundBuffer);
        const canvasWidth = bgImage.width || 1024;
        const canvasHeight = bgImage.height || 1024;
        const canvas = createCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext("2d");
        // 1. Draw raw background AI artwork
        ctx.drawImage(bgImage, 0, 0, canvasWidth, canvasHeight);
        const safeMargin = brand.safeMargin || Math.round(canvasWidth * 0.035);
        // 2. Overlay Logo if present
        if (brand.logoUrl && brand.logoUrl.trim().length > 0) {
            try {
                const logoBuffer = await this.fetchBufferFromUrl(brand.logoUrl);
                if (logoBuffer && logoBuffer.length > 0) {
                    const logoImage = await loadImage(logoBuffer);
                    const origW = logoImage.width || 100;
                    const origH = logoImage.height || 100;
                    const aspect = origW / origH;
                    // Target size based on selection
                    let maxDimension = Math.round(canvasWidth * 0.16); // default medium
                    if (brand.logoSize === "small")
                        maxDimension = Math.round(canvasWidth * 0.11);
                    if (brand.logoSize === "large")
                        maxDimension = Math.round(canvasWidth * 0.22);
                    let targetW = maxDimension;
                    let targetH = maxDimension;
                    if (aspect >= 1) {
                        targetH = Math.round(targetW / aspect);
                    }
                    else {
                        targetW = Math.round(targetH * aspect);
                    }
                    // Compute coordinates
                    let posX = safeMargin;
                    let posY = safeMargin;
                    switch (brand.logoPosition) {
                        case "top-left":
                            posX = safeMargin;
                            posY = safeMargin;
                            break;
                        case "top-right":
                            posX = canvasWidth - safeMargin - targetW;
                            posY = safeMargin;
                            break;
                        case "bottom-left":
                            posX = safeMargin;
                            posY = canvasHeight - safeMargin - targetH;
                            break;
                        case "bottom-right":
                        default:
                            posX = canvasWidth - safeMargin - targetW;
                            posY = canvasHeight - safeMargin - targetH;
                            break;
                    }
                    // Subtle, modern glassmorphic container badge for guaranteed contrast
                    const pad = Math.round(maxDimension * 0.12);
                    const badgeX = posX - pad;
                    const badgeY = posY - pad;
                    const badgeW = targetW + pad * 2;
                    const badgeH = targetH + pad * 2;
                    const radius = Math.round(badgeH * 0.2);
                    ctx.save();
                    // Soft shadow
                    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
                    ctx.shadowBlur = 16;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 4;
                    // Frosted background
                    ctx.fillStyle = "rgba(10, 15, 30, 0.72)";
                    ctx.beginPath();
                    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
                    ctx.fill();
                    // Delicate border
                    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
                    ctx.stroke();
                    ctx.restore();
                    // Render pristine logo
                    ctx.drawImage(logoImage, posX, posY, targetW, targetH);
                }
            }
            catch (logoErr) {
                console.warn("[BrandIdentityService] Logo compositing fallback warning:", logoErr);
            }
        }
        // 3. Overlay Website Domain Badge if present
        const rawDomain = (brand.websiteDomain || "").trim();
        if (rawDomain.length > 0) {
            try {
                const displayDomain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/$/, "");
                const fontSize = Math.max(16, Math.round(canvasWidth * 0.022));
                ctx.font = `600 ${fontSize}px sans-serif`;
                const textMetrics = ctx.measureText(displayDomain);
                const textW = textMetrics.width;
                const iconSize = Math.round(fontSize * 0.9);
                const pillPadX = Math.round(fontSize * 1.2);
                const pillPadY = Math.round(fontSize * 0.65);
                const pillW = textW + iconSize + pillPadX * 2 + 10;
                const pillH = fontSize + pillPadY * 2;
                const pillRadius = Math.round(pillH / 2);
                let pillX = (canvasWidth - pillW) / 2;
                let pillY = canvasHeight - safeMargin - pillH;
                switch (brand.domainPosition) {
                    case "top-center":
                        pillX = (canvasWidth - pillW) / 2;
                        pillY = safeMargin;
                        break;
                    case "top-right":
                        pillX = canvasWidth - safeMargin - pillW;
                        pillY = safeMargin;
                        break;
                    case "bottom-left":
                        pillX = safeMargin;
                        pillY = canvasHeight - safeMargin - pillH;
                        break;
                    case "bottom-right":
                        pillX = canvasWidth - safeMargin - pillW;
                        pillY = canvasHeight - safeMargin - pillH;
                        break;
                    case "bottom-center":
                    default:
                        pillX = (canvasWidth - pillW) / 2;
                        pillY = canvasHeight - safeMargin - pillH;
                        break;
                }
                ctx.save();
                // Drop shadow for crisp elevation
                ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
                ctx.shadowBlur = 12;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 4;
                // Frosted glass background
                ctx.fillStyle = "rgba(10, 15, 30, 0.82)";
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pillW, pillH, pillRadius);
                ctx.fill();
                // Elegant border with brand color glow
                const primaryColor = (brand.brandColors && brand.brandColors[0]) || "#38bdf8";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pillW, pillH, pillRadius);
                ctx.stroke();
                ctx.restore();
                // Draw Accent Dot / Globe Indicator in Brand Color
                const dotRadius = Math.round(iconSize * 0.35);
                const dotX = pillX + pillPadX + dotRadius;
                const dotY = pillY + pillH / 2;
                ctx.fillStyle = primaryColor;
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
                ctx.fill();
                // Draw Clean Domain Text
                ctx.fillStyle = "#ffffff";
                ctx.font = `600 ${fontSize}px sans-serif`;
                ctx.textBaseline = "middle";
                ctx.fillText(displayDomain, dotX + dotRadius + 8, dotY);
            }
            catch (domainErr) {
                console.warn("[BrandIdentityService] Domain badge compositing warning:", domainErr);
            }
        }
        return canvas.toBuffer("image/png");
    }
    /**
     * Re-composites a single concept poster using its pristine raw_image_url
     */
    async recomposeConceptPoster(opts) {
        const concept = (await pool.query(`SELECT id, image_url, raw_image_url, asset_id, raw_asset_id
         FROM document_visual_concepts
         WHERE id = $1 AND workspace_id = $2`, [opts.conceptId, opts.workspaceId])).rows[0];
        if (!concept) {
            throw new Error("Visual concept not found.");
        }
        const brand = await this.getOrCreateBrandIdentity(opts.documentId, opts.workspaceId);
        const sourceImageUrl = concept.raw_image_url || concept.image_url;
        if (!sourceImageUrl) {
            throw new Error("No image generated yet for this concept.");
        }
        const bgBuffer = await this.fetchBufferFromUrl(sourceImageUrl);
        const compositedBuffer = await this.composeBrandOverlay({
            backgroundBuffer: bgBuffer,
            brand,
        });
        // Save as new media asset
        const { provider, bucket } = getStorageProvider();
        const assetId = randomUUID();
        const objectKey = `workspaces/${opts.workspaceId}/generated_asset/${assetId}/branded_poster.png`;
        await uploadManagedMedia({
            assetId,
            workspaceId: opts.workspaceId,
            userId: opts.userId,
            provider,
            bucket,
            objectKey,
            body: compositedBuffer,
            mimeType: "image/png",
            filename: `branded_poster_${Date.now()}.png`,
            type: "GENERATED_ASSET",
            metadata: {
                document_id: opts.documentId,
                concept_id: opts.conceptId,
                branded: true,
            },
        });
        const finalUrl = await provider.getSignedDownloadUrl(bucket, objectKey, 30 * 86400);
        // Update concept row: preserve raw_image_url so future recompositions don't require re-generating!
        const rawUrlToSave = concept.raw_image_url || concept.image_url;
        const rawAssetToSave = concept.raw_asset_id || concept.asset_id;
        await pool.query(`UPDATE document_visual_concepts
       SET image_url = $1, asset_id = $2, raw_image_url = $3, raw_asset_id = $4, updated_at = NOW()
       WHERE id = $5`, [finalUrl, assetId, rawUrlToSave, rawAssetToSave, opts.conceptId]);
        return {
            imageUrl: finalUrl,
            assetId,
        };
    }
    /**
     * Re-composites all existing visual concepts for this document
     */
    async recomposeAllDocumentPosters(documentId, workspaceId, userId) {
        const concepts = (await pool.query(`SELECT id, image_url, raw_image_url
         FROM document_visual_concepts
         WHERE document_id = $1 AND workspace_id = $2 AND (image_url IS NOT NULL OR raw_image_url IS NOT NULL)`, [documentId, workspaceId])).rows;
        let updatedCount = 0;
        for (const c of concepts) {
            try {
                await this.recomposeConceptPoster({
                    documentId,
                    conceptId: c.id,
                    workspaceId,
                    userId,
                });
                updatedCount++;
            }
            catch (err) {
                console.warn(`[BrandIdentity] Recompose failed for concept ${c.id}:`, err);
            }
        }
        return { updatedCount };
    }
    /**
     * Auto-detection from document metadata, pages, and extracted source images
     */
    async autoDetectBrandIdentity(documentId, workspaceId) {
        // 1. Fetch document record
        const docRes = await pool.query(`SELECT original_filename FROM documents WHERE id = $1 AND workspace_id = $2`, [documentId, workspaceId]);
        const filename = docRes.rows[0]?.original_filename || "Document.pdf";
        // Clean company name from filename
        let companyName = filename
            .replace(/\.pdf$/i, "")
            .replace(/[_-\s]*(Final|Draft|Version|v\d+|\d+_Page|Business_Plan|Pitch_Deck|Presentation|Deck|Whitepaper|Overview).*/i, "")
            .replace(/[_-\s]+/g, " ")
            .trim();
        if (!companyName)
            companyName = "Brand";
        // 2. Scan document pages for website domain
        const pagesRes = await pool.query(`SELECT clean_text FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC LIMIT 20`, [documentId, workspaceId]);
        let detectedDomain = "";
        const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:live|com|org|io|net|in|ai|app|co|tech|finance|xyz)[a-zA-Z0-9.\-_]*)/i;
        for (const page of pagesRes.rows) {
            const match = (page.clean_text || "").match(domainRegex);
            if (match && match[1]) {
                detectedDomain = match[1].toLowerCase().replace(/\/.*$/, "");
                if (!detectedDomain.startsWith("www.")) {
                    detectedDomain = `www.${detectedDomain}`;
                }
                break;
            }
        }
        // Context fallback: if filename contains tradeorbit or similar brand
        if (!detectedDomain && filename.toLowerCase().includes("tradeorbit")) {
            detectedDomain = "www.tradeorbit.live";
        }
        // 3. Check for cover-page extracted logo from PDF
        const mediaRes = await pool.query(`SELECT dsm.media_asset_id, ma.bucket, ma.object_key
       FROM document_source_media dsm
       JOIN media_assets ma ON ma.id = dsm.media_asset_id
       WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND dsm.page_number = 1
       ORDER BY dsm.image_index ASC LIMIT 1`, [documentId, workspaceId]);
        let logoUrl = null;
        let logoAssetId = null;
        if (mediaRes.rowCount && mediaRes.rowCount > 0) {
            const { provider } = getStorageProvider();
            const row = mediaRes.rows[0];
            try {
                logoUrl = await provider.getSignedDownloadUrl(row.bucket, row.object_key, 365 * 86400);
                logoAssetId = row.media_asset_id;
            }
            catch (urlErr) {
                console.warn("[BrandIdentity] Failed to get signed URL for detected logo:", urlErr);
            }
        }
        // 4. Default brand colors
        const brandColors = ["#2563eb", "#06b6d4", "#f59e0b"];
        // 5. Determine initial status:
        // If both logo and domain are detected, status is DETECTED (ready for one-click confirmation)
        // If either is missing, PENDING_REVIEW (prompting user to configure rather than inventing)
        const status = (logoUrl && detectedDomain) ? "DETECTED" : "PENDING_REVIEW";
        // 6. Insert new record
        const insertRes = await pool.query(`INSERT INTO document_brand_identities (
         document_id, workspace_id, company_name, logo_url, logo_asset_id,
         website_domain, brand_colors, apply_to_all_posters, logo_position,
         domain_position, logo_size, safe_margin, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'bottom-right', 'bottom-center', 'medium', 32, $8, NOW(), NOW())
       ON CONFLICT (document_id) DO UPDATE
       SET company_name = EXCLUDED.company_name, updated_at = NOW()
       RETURNING *`, [
            documentId,
            workspaceId,
            companyName,
            logoUrl,
            logoAssetId,
            detectedDomain,
            JSON.stringify(brandColors),
            status,
        ]);
        return this.mapRow(insertRes.rows[0]);
    }
    /**
     * Universal image buffer fetcher (handles URLs, local paths, base64 data)
     */
    async fetchBufferFromUrl(url) {
        if (url.startsWith("data:")) {
            const base64Data = url.split(",")[1];
            return Buffer.from(base64Data, "base64");
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Failed to fetch image: HTTP ${res.status}`);
            }
            const ab = await res.arrayBuffer();
            return Buffer.from(ab);
        }
        // If local file path
        const fs = await import("node:fs/promises");
        return fs.readFile(url);
    }
    mapRow(r) {
        let brandColors = ["#2563eb", "#06b6d4", "#f59e0b"];
        if (Array.isArray(r.brand_colors)) {
            brandColors = r.brand_colors;
        }
        else if (typeof r.brand_colors === "string") {
            try {
                brandColors = JSON.parse(r.brand_colors);
            }
            catch { }
        }
        return {
            documentId: r.document_id,
            workspaceId: r.workspace_id,
            companyName: r.company_name || "",
            logoUrl: r.logo_url || null,
            logoAssetId: r.logo_asset_id || null,
            websiteDomain: r.website_domain || "",
            brandColors,
            applyToAllPosters: r.apply_to_all_posters ?? true,
            logoPosition: r.logo_position || "bottom-right",
            domainPosition: r.domain_position || "bottom-center",
            logoSize: r.logo_size || "medium",
            safeMargin: r.safe_margin || 32,
            status: r.status || "PENDING_REVIEW",
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
            updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        };
    }
}
