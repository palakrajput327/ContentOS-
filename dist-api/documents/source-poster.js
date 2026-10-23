import { createHash, randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { z } from "zod";
import { pool, transaction, audit } from "../db.js";
import { sourceReference, sourceOriginalBuffer } from "./source-original.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { uploadManagedMedia } from "../storage/managed-media.js";
export const sourcePosterSchema = z.object({
    headline: z.string().trim().min(1).max(100),
    subtitle: z.string().trim().max(180).default(""),
    cta: z.string().trim().max(48).default(""),
    format: z.enum(["square", "portrait", "landscape"]).default("square"),
    primaryColor: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .default("#704bd6"),
    logoAssetId: z.string().uuid().optional(),
});
function fitLines(ctx, text, width, size, maxLines) {
    for (let font = size; font >= 18; font -= 2) {
        ctx.font = `bold ${font}px sans-serif`;
        const lines = [];
        let line = "", overflow = false;
        for (const word of text.split(/\s+/)) {
            if (ctx.measureText(word).width > width) {
                overflow = true;
                break;
            }
            if (ctx.measureText(`${line} ${word}`.trim()).width > width) {
                lines.push(line);
                line = word;
            }
            else
                line = `${line} ${word}`.trim();
        }
        if (line)
            lines.push(line);
        if (!overflow && lines.length && lines.length <= maxLines)
            return { lines, font };
    }
    throw new BadRequestException("Poster text does not fit this format. Use shorter words or text.");
}
export async function renderSourcePoster(buffer, input, brand, logo) {
    const [w, h] = input.format === "portrait"
        ? [1080, 1350]
        : input.format === "landscape"
            ? [1200, 628]
            : [1080, 1080];
    const canvas = createCanvas(w, h), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111622";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = input.primaryColor;
    ctx.fillRect(0, 0, w, 12);
    const pad = 56, photoTop = 118, photoHeight = Math.floor(h * (input.format === "landscape" ? 0.34 : 0.49));
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(pad, photoTop, w - pad * 2, photoHeight);
    const image = await loadImage(buffer), scale = Math.min((w - pad * 2 - 32) / image.width, (photoHeight - 32) / image.height);
    ctx.drawImage(image, pad + (w - pad * 2 - image.width * scale) / 2, photoTop + (photoHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
    let nameX = pad;
    if (logo) {
        const badge = await loadImage(logo), logoScale = Math.min(130 / badge.width, 60 / badge.height);
        ctx.drawImage(badge, pad, 34, badge.width * logoScale, badge.height * logoScale);
        nameX += 150;
    }
    ctx.fillStyle = "#ffffff";
    const name = fitLines(ctx, String(brand.name || "Your business").slice(0, 120), w - nameX - pad, 30, 1);
    ctx.font = `bold ${name.font}px sans-serif`;
    ctx.fillText(name.lines[0], nameX, 76);
    let y = photoTop + photoHeight + 54;
    const headline = fitLines(ctx, input.headline, w - pad * 2, input.format === "landscape" ? 42 : 52, input.format === "landscape" ? 2 : 3);
    ctx.font = `bold ${headline.font}px sans-serif`;
    for (const line of headline.lines) {
        ctx.fillText(line, pad, y);
        y += headline.font * 1.16;
    }
    if (input.subtitle) {
        const sub = fitLines(ctx, input.subtitle, w - pad * 2, input.format === "landscape" ? 22 : 26, input.format === "landscape" ? 2 : 3);
        ctx.font = `${sub.font}px sans-serif`;
        ctx.fillStyle = "#ced3df";
        y += 16;
        for (const line of sub.lines) {
            ctx.fillText(line, pad, y);
            y += sub.font * 1.2;
        }
    }
    if (y > h - 100)
        throw new BadRequestException("Text is too long for this poster format. Shorten the headline or description.");
    const cta = input.cta || brand.cta || "", footer = String(cta).slice(0, 48);
    ctx.fillStyle = input.primaryColor;
    ctx.fillRect(pad, h - 78, w - pad * 2, 3);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(footer, pad, h - 34, (w - pad * 2) * (brand.website ? 0.45 : 1));
    if (brand.website) {
        ctx.font = "18px sans-serif";
        ctx.fillStyle = "#ced3df";
        ctx.textAlign = "right";
        ctx.fillText(String(brand.website).slice(0, 70), w - pad, h - 34, (w - pad * 2) * 0.45);
        ctx.textAlign = "left";
    }
    const jpeg = canvas.toBuffer("image/jpeg", 86);
    if (jpeg.length > 3 * 1024 * 1024)
        throw new BadRequestException("Rendered poster exceeds the 3 MiB asset limit.");
    return { buffer: jpeg, width: w, height: h };
}
export async function approveSourceReuse(db, workspaceId, source, actorId, allowed) {
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
        workspaceId,
    ]);
    const row = (await db.query("SELECT metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE", [source.media_asset_id, workspaceId])).rows[0];
    if (!row)
        throw new BadRequestException("Source media is unavailable.");
    const state = allowed ? "APPROVED" : "REJECTED";
    const revision = row.metadata.reuseEligibility === state
        ? Number(row.metadata.reuseVersion || 0)
        : Number(row.metadata.reuseVersion || 0) + 1;
    await db.query("UPDATE media_assets SET metadata=metadata || $3::jsonb WHERE id=$1 AND workspace_id=$2", [
        source.media_asset_id,
        workspaceId,
        JSON.stringify({
            reuseEligibility: state,
            reuseVersion: revision,
            reuseReviewedBy: actorId,
            reuseReviewedAt: new Date().toISOString(),
        }),
    ]);
    await audit(db, workspaceId, actorId, "SOURCE_REUSE_" + state, "media_asset", source.media_asset_id, source.original_filename);
    return { reuseEligibility: state, reuseVersion: revision };
}
export class SourcePosterService {
    read;
    constructor(read = sourceOriginalBuffer) {
        this.read = read;
    }
    async create(workspaceId, documentId, sourceId, actorId, input) {
        const source = await sourceReference(pool, workspaceId, documentId, sourceId);
        if (source.metadata.reuseEligibility !== "APPROVED")
            throw new BadRequestException("Approve this source image for promotional reuse first.");
        const brand = (await pool.query("SELECT data FROM brand_kits WHERE workspace_id=$1", [
            workspaceId,
        ])).rows[0]?.data || {};
        const { provider, bucket } = getStorageProvider();
        let logo;
        if (input.logoAssetId) {
            const asset = (await pool.query("SELECT bucket,object_key,size_bytes,metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status='COMPLETED' AND mime_type IN ('image/png','image/jpeg','image/webp')", [input.logoAssetId, workspaceId])).rows[0];
            if (!asset ||
                Number(asset.size_bytes) > 2 * 1024 * 1024 ||
                asset.metadata?.origin === "PDF_SOURCE")
                throw new BadRequestException("Choose a separately uploaded workspace logo image smaller than 2 MiB.");
            const stream = await provider.read(asset.bucket, asset.object_key), parts = [];
            let size = 0;
            for await (const chunk of stream) {
                size += chunk.length;
                if (size > 2 * 1024 * 1024) {
                    stream.destroy();
                    throw new BadRequestException("Logo exceeds the 2 MiB limit.");
                }
                parts.push(Buffer.from(chunk));
            }
            logo = Buffer.concat(parts);
        }
        const original = await this.read(source), rendered = await renderSourcePoster(original, input, brand, logo);
        const key = createHash("sha256")
            .update(JSON.stringify([
            sourceId,
            source.checksum,
            source.metadata.reuseVersion,
            input,
            brand.name,
            brand.cta,
            brand.website,
            logo ? createHash("sha256").update(logo).digest("hex") : null,
        ]))
            .digest("hex");
        const record = await transaction(async (db) => {
            await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
                workspaceId,
            ]);
            const current = await sourceReference(db, workspaceId, documentId, sourceId);
            const checked = (await db.query("SELECT metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 FOR SHARE", [source.media_asset_id, workspaceId])).rows[0];
            if (current.checksum !== source.checksum ||
                checked.metadata.reuseEligibility !== "APPROVED" ||
                checked.metadata.reuseVersion !== source.metadata.reuseVersion)
                throw new BadRequestException("Source reuse approval changed during rendering. Refresh and review the image.");
            const old = (await db.query("SELECT * FROM media_assets WHERE workspace_id=$1 AND metadata->>'origin'='SOURCE_POSTER' AND metadata->>'renderKey'=$2 AND deleted_at IS NULL AND status='COMPLETED'", [workspaceId, key])).rows[0];
            if (old)
                return old;
            const assetId = randomUUID(), objectKey = `workspaces/${workspaceId}/source-posters/${key}.jpg`;
            const metadata = {
                origin: "SOURCE_POSTER",
                renderKey: key,
                width: rendered.width,
                height: rendered.height,
                sourceMediaAssetId: source.media_asset_id,
                sourceReferenceId: sourceId,
                documentId,
                pageNumber: source.page_number,
                documentName: source.original_filename,
                sourceChecksum: source.checksum,
                reuseVersion: source.metadata.reuseVersion,
                logoAssetId: input.logoAssetId || null,
            };
            await uploadManagedMedia({
                assetId,
                workspaceId,
                userId: actorId,
                provider,
                bucket,
                objectKey,
                body: rendered.buffer,
                mimeType: "image/jpeg",
                filename: "source-poster.jpg",
                type: "GENERATED_ASSET",
                metadata,
            }, db);
            await audit(db, workspaceId, actorId, "SOURCE_POSTER_CREATED", "media_asset", assetId, input.headline, null, metadata);
            return { id: assetId, bucket, object_key: objectKey, metadata };
        });
        return {
            assetId: record.id,
            url: await provider.getSignedDownloadUrl(record.bucket, record.object_key, 900),
            filename: "source-poster.jpg",
            sourceEvidence: record.metadata,
        };
    }
}
