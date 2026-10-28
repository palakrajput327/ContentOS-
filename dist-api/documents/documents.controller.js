var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { queueBackend } from '../queue-backend.js';
import { Body, Controller, Delete, Get, Param, Post, Req, Res, NotFoundException, BadRequestException, } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "../db.js";
import { assertPermission, WorkspaceRequired } from "../security.js";
import { createQueue } from '../queues.js';
import { getStorageProvider } from "../storage/storage.factory.js";
import { storageUsage, readSourcePDF } from '../storage/storage-budget.js';
import { extractSourceImages } from './extraction/source-images.js';
import { createHash } from 'node:crypto';
import { visionConfigured } from './visual-knowledge.service.js';
const pdfProcessingQueue = createQueue("pdf-processing", {
    defaultJobOptions: {
        attempts: Number(process.env.PDF_JOB_ATTEMPTS) || 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { age: 7 * 86400 },
        removeOnFail: { age: 30 * 86400 },
    },
});
export const createDocumentSchema = z.object({
    mediaAssetId: z.string().uuid(),
});
let DocumentsController = class DocumentsController {
    async createDocument(r, input) {
        assertPermission(r.workspace.role, "edit");
        const v = createDocumentSchema.parse(input);
        const w = r.workspace.id;
        // Verify media asset exists, belongs to active workspace, is COMPLETED and is PDF
        const assetRes = await pool.query("SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL", [v.mediaAssetId, w]);
        if (!assetRes.rowCount) {
            throw new NotFoundException("Media asset record not found in this workspace.");
        }
        const asset = assetRes.rows[0];
        if (asset.status !== "COMPLETED") {
            throw new BadRequestException("Media asset upload is not completed.");
        }
        if (asset.mime_type !== "application/pdf") {
            throw new BadRequestException("Only PDF documents can be processed.");
        }
        const maxMB = Number(process.env.PDF_MAX_FILE_SIZE_MB) || 50;
        if (Number(asset.size_bytes) > maxMB * 1024 * 1024) {
            throw new BadRequestException(`PDF size exceeds maximum limit of ${maxMB} MB.`);
        }
        const documentId = randomUUID();
        const result = await transaction(async (db) => {
            await db.query(`INSERT INTO documents(id, workspace_id, media_asset_id, original_filename, mime_type, status, created_by)
         VALUES($1, $2, $3, $4, $5, 'QUEUED', $6)`, [
                documentId,
                w,
                asset.id,
                asset.original_filename,
                asset.mime_type,
                r.user.id,
            ]);
            await pdfProcessingQueue.add("extract", {
                documentId,
                workspaceId: w,
                correlationId: r.requestId,
            }, { jobId: documentId }, db);
            await audit(db, w, r.user.id, "DOCUMENT_CREATED", "document", documentId, asset.original_filename);
            return {
                documentId,
                status: "QUEUED",
                filename: asset.original_filename,
            };
        });
        // Proactively start PDF extraction immediately
        import("../pdf-processing.js")
            .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
            .catch((err) => console.warn(`[PDF Immediate Trigger] For ${documentId}:`, err?.message || err));
        return result;
    }
    async listDocuments(r) {
        const w = r.workspace.id;
        const res = await pool.query(`SELECT id, media_asset_id, original_filename, mime_type, status, page_count,
              failure_code, failure_message, created_at, processing_completed_at
       FROM documents WHERE workspace_id = $1 ORDER BY created_at DESC`, [w]);
        return { documents: res.rows };
    }
    async getDocument(r, documentId) {
        const w = r.workspace.id;
        const res = await pool.query(`SELECT id, media_asset_id, original_filename, mime_type, status, page_count,
              processing_version, failure_code, failure_message, created_at, media_extraction_status, media_extraction_message,
              processing_started_at, processing_completed_at
       FROM documents WHERE id = $1 AND workspace_id = $2`, [documentId, w]);
        if (!res.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        const doc = res.rows[0];
        // If document is QUEUED and not yet picked up by worker after 2s, trigger real processing
        if (doc.status === "QUEUED" && (Date.now() - new Date(doc.created_at).getTime()) > 2000) {
            import("../pdf-processing.js")
                .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
                .catch((err) => console.warn(`[PDF Direct Trigger] Failed for ${documentId}:`, err?.message || err));
        }
        return { document: doc };
    }
    async extractSourceMedia(r, documentId) {
        assertPermission(r.workspace.role, 'edit');
        const doc = await pool.query(`SELECT m.bucket,m.object_key FROM documents d JOIN media_assets m ON m.id=d.media_asset_id
      WHERE d.id=$1 AND d.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL AND m.status='COMPLETED'`, [documentId, r.workspace.id]);
        if (!doc.rowCount)
            throw new NotFoundException('Document not found in this workspace.');
        await audit(pool, r.workspace.id, r.user.id, 'SOURCE_MEDIA_EXTRACTION_REQUESTED', 'document', documentId, 'PDF source images');
        const { provider } = getStorageProvider();
        const pdf = await readSourcePDF(provider, doc.rows[0].bucket, doc.rows[0].object_key);
        const { persistDocumentImages } = await import('./source-media.service.js');
        await persistDocumentImages(documentId, r.workspace.id, pdf);
        return this.sourceMedia(r, documentId);
    }
    async sourceOriginal(r, documentId, sourceId, response) {
        const result = await pool.query(`SELECT s.page_number,s.image_index,s.kind,m.checksum,p.bucket,p.object_key
      FROM document_source_media s JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id
      JOIN media_assets m ON m.id=s.media_asset_id AND m.workspace_id=s.workspace_id
      JOIN media_assets p ON p.id=d.media_asset_id AND p.workspace_id=d.workspace_id
      WHERE s.id=$1 AND s.document_id=$2 AND s.workspace_id=$3 AND m.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='COMPLETED'`, [sourceId, documentId, r.workspace.id]);
        if (!result.rowCount)
            throw new NotFoundException('Source image not found in this workspace.');
        const source = result.rows[0], { provider } = getStorageProvider();
        const pdf = await readSourcePDF(provider, source.bucket, source.object_key);
        let original;
        await extractSourceImages(pdf, async (image) => { original = image.data; }, { pageNumber: source.page_number, imageIndex: source.image_index, kind: source.kind, includeFiltered: true });
        if (!original || createHash('sha256').update(original).digest('hex') !== source.checksum)
            throw new BadRequestException('The source PDF/image changed. Re-extract images before using this source.');
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'private, no-store');
        response.setHeader('Content-Disposition', `attachment; filename="source-page-${source.page_number}.png"`);
        return response.send(original);
    }
    async sourceMedia(r, documentId) {
        const w = r.workspace.id;
        const doc = await pool.query(`SELECT d.media_extraction_status,d.media_extraction_message,d.media_extraction_summary,m.bucket,m.object_key
      FROM documents d JOIN media_assets m ON m.id=d.media_asset_id
      WHERE d.id=$1 AND d.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL`, [documentId, w]);
        if (!doc.rowCount)
            throw new NotFoundException('Document not found in this workspace.');
        const result = await pool.query(`SELECT s.id AS source_id,s.page_number,s.image_index,s.kind,m.id AS asset_id,m.original_filename,m.metadata,m.bucket,m.object_key,m.size_bytes,a.ocr_status,a.vision_status,a.error_message,a.lease_until
      FROM document_source_media s JOIN media_assets m ON m.id=s.media_asset_id
      LEFT JOIN source_media_analysis a ON a.media_asset_id=m.id AND a.workspace_id=m.workspace_id
      WHERE s.document_id=$1 AND s.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL AND m.status='COMPLETED'
      ORDER BY s.page_number,s.image_index LIMIT 200`, [documentId, w]);
        const { provider } = getStorageProvider();
        const assets = await Promise.all(result.rows.map(async (row) => {
            const meta = (typeof row.metadata === 'object' && row.metadata !== null) ? row.metadata : {};
            return {
                sourceId: row.source_id,
                assetId: row.asset_id,
                pageNumber: row.page_number,
                imageIndex: row.image_index,
                kind: row.kind,
                previewOnly: meta.originalStored === false,
                sizeBytes: Number(row.size_bytes),
                width: meta.width,
                height: meta.height,
                reuseEligibility: meta.reuseEligibility || 'UNREVIEWED',
                analysis: { ocrStatus: row.ocr_status || 'PENDING', visionStatus: row.vision_status || 'PENDING', error: row.error_message, processing: row.lease_until && new Date(row.lease_until).getTime() > Date.now() },
                url: await provider.getSignedDownloadUrl(row.bucket, row.object_key, 900),
            };
        }));
        return { visionAvailable: visionConfigured(), status: doc.rows[0].media_extraction_status, message: doc.rows[0].media_extraction_message, summary: doc.rows[0].media_extraction_summary, storage: await storageUsage(pool, w),
            sourceUrl: await provider.getSignedDownloadUrl(doc.rows[0].bucket, doc.rows[0].object_key, 900), assets };
    }
    async getVisualConcepts(r, documentId) {
        const { VisualConceptsService } = await import("./visual-concepts.service.js");
        const service = new VisualConceptsService();
        return service.getOrGenerateConcepts(documentId, r.workspace.id);
    }
    async regenerateVisualConcepts(r, documentId) {
        assertPermission(r.workspace.role, "edit");
        const { VisualConceptsService } = await import("./visual-concepts.service.js");
        const service = new VisualConceptsService();
        return service.regenerateConcepts(documentId, r.workspace.id);
    }
    async generateConceptVisual(r, documentId, conceptId, body) {
        assertPermission(r.workspace.role, "edit");
        const { VisualConceptsService } = await import("./visual-concepts.service.js");
        const service = new VisualConceptsService();
        return service.generateConceptVisual({
            documentId,
            conceptId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
            customPrompt: body?.prompt,
            force: body?.force ?? true,
        });
    }
    async dispatchVisualConcept(r, documentId, conceptId, body) {
        assertPermission(r.workspace.role, "schedule");
        const { VisualConceptsService } = await import("./visual-concepts.service.js");
        const service = new VisualConceptsService();
        return service.dispatchConcept({
            documentId,
            conceptId,
            workspaceId: r.workspace.id,
            userId: r.user.id,
            channels: body?.channels,
        });
    }
    async getDocumentPages(r, documentId) {
        const w = r.workspace.id;
        const docCheck = await pool.query("SELECT id FROM documents WHERE id = $1 AND workspace_id = $2", [documentId, w]);
        if (!docCheck.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        const res = await pool.query(`SELECT id, page_number, clean_text, extraction_method, ocr_used, ocr_confidence, character_count
       FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC`, [documentId, w]);
        return { pages: res.rows };
    }
    async getDocumentPage(r, documentId, pageNumberStr) {
        const w = r.workspace.id;
        const pageNum = parseInt(pageNumberStr, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            throw new BadRequestException("Invalid page number.");
        }
        const res = await pool.query(`SELECT id, page_number, raw_text, clean_text, extraction_method, ocr_used, ocr_confidence, character_count
       FROM document_pages WHERE document_id = $1 AND workspace_id = $2 AND page_number = $3`, [documentId, w, pageNum]);
        if (!res.rowCount) {
            throw new NotFoundException("Document page not found.");
        }
        return { page: res.rows[0] };
    }
    async getDocumentChunks(r, documentId) {
        const w = r.workspace.id;
        const docCheck = await pool.query("SELECT id FROM documents WHERE id = $1 AND workspace_id = $2", [documentId, w]);
        if (!docCheck.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        const res = await pool.query(`SELECT id, chunk_index, page_start, page_end, content, character_count, token_count, content_hash
       FROM document_chunks WHERE document_id = $1 AND workspace_id = $2 ORDER BY chunk_index ASC`, [documentId, w]);
        return { chunks: res.rows };
    }
    async reprocessDocument(r, documentId) {
        assertPermission(r.workspace.role, "edit");
        const w = r.workspace.id;
        const docRes = await pool.query("SELECT id, original_filename FROM documents WHERE id = $1 AND workspace_id = $2", [documentId, w]);
        if (!docRes.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        const result = await transaction(async (db) => {
            await db.query("UPDATE documents SET status = 'QUEUED', failure_code = NULL, failure_message = NULL, processing_version = processing_version + 1 WHERE id = $1 AND workspace_id = $2", [documentId, w]);
            await pdfProcessingQueue.add("extract", {
                documentId,
                workspaceId: w,
                correlationId: r.requestId,
            }, { jobId: `${documentId}-reprocess-${Date.now()}` }, db);
            await audit(db, w, r.user.id, "DOCUMENT_REPROCESS_REQUESTED", "document", documentId, docRes.rows[0].original_filename);
            return { documentId, status: "QUEUED" };
        });
        // Proactively start reprocess immediately
        if (queueBackend() === 'bullmq')
            import("../pdf-processing.js")
                .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
                .catch((err) => console.warn(`[PDF Reprocess Trigger] For ${documentId}:`, err?.message || err));
        return result;
    }
    async fastTrackDocument(r, documentId) {
        assertPermission(r.workspace.role, "edit");
        const w = r.workspace.id;
        const docRes = await pool.query("SELECT id, original_filename, status FROM documents WHERE id = $1 AND workspace_id = $2", [documentId, w]);
        if (!docRes.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        try {
            const { processPDFDocument } = await import("../pdf-processing.js");
            const result = await processPDFDocument(documentId, w);
            return {
                documentId,
                status: "READY",
                pageCount: result.pageCount,
                chunkCount: result.chunkCount,
            };
        }
        catch (fastErr) {
            if (queueBackend() === 'postgres') {
                await pdfProcessingQueue.add('extract', { documentId, workspaceId: w }, { jobId: `${documentId}-fast-${Date.now()}` });
                return { documentId, status: 'QUEUED' };
            }
            throw fastErr;
        }
    }
    async getPosterScripts(r, documentId) {
        const w = r.workspace.id;
        const [knowRes, mediaRes, planRes] = await Promise.all([
            pool.query(`SELECT id, knowledge_key, knowledge_type, value, page_start, page_end, source_excerpt, confidence
         FROM document_knowledge
         WHERE document_id = $1 AND workspace_id = $2
           AND knowledge_type NOT IN ('OCR_TEXT', 'RAW_TEXT')
         ORDER BY page_start ASC, created_at ASC`, [documentId, w]),
            pool.query(`SELECT dsm.id, dsm.page_number, dsm.kind, m.bucket, m.object_key, m.id as asset_id
         FROM document_source_media dsm
         JOIN media_assets m ON m.id = dsm.media_asset_id
         WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND m.deleted_at IS NULL
         ORDER BY dsm.page_number ASC`, [documentId, w]),
            pool.query(`SELECT p.id, p.knowledge_id, p.source_snapshot, c.variants, c.title, c.body
         FROM knowledge_content_plans p
         LEFT JOIN content c ON c.id = p.content_id
         WHERE p.workspace_id = $1 AND p.state = 'COMPLETED'`, [w]),
        ]);
        const { provider } = getStorageProvider();
        const pageImageMap = new Map();
        for (const m of mediaRes.rows) {
            if (!pageImageMap.has(m.page_number)) {
                try {
                    const url = await provider.getSignedDownloadUrl(m.bucket, m.object_key, 7 * 86400);
                    pageImageMap.set(m.page_number, { url, assetId: m.asset_id });
                }
                catch { }
            }
        }
        const planMap = new Map();
        for (const row of planRes.rows) {
            if (row.knowledge_id)
                planMap.set(row.knowledge_id, row);
        }
        const firstImage = pageImageMap.values().next().value;
        const scripts = [];
        for (const k of knowRes.rows) {
            const pageNum = k.page_start || 1;
            const media = pageImageMap.get(pageNum) || firstImage || null;
            const concept = typeof k.value === "string" ? k.value : JSON.stringify(k.value);
            const cleanConcept = concept.replace(/["{}]/g, "").trim();
            const cleanTitle = (k.knowledge_key || cleanConcept).replace(/[^\w\s-.,&]/g, "").trim();
            const headline = cleanTitle.length > 45 ? cleanTitle.slice(0, 42) + "..." : cleanTitle;
            const promptSubject = cleanConcept.length > 110 ? cleanConcept.slice(0, 107) + "..." : cleanConcept;
            const dynamicPrompt = `A close-up hero shot representing ${cleanTitle}: ${promptSubject}, centered in a brightly lit modern commercial architectural space, natural daylight, crisp focus, commercial editorial photography, 8k resolution.`;
            const cleanCaption = `🚀 ${headline}\n\n${cleanConcept}\n\nKey takeaways from our latest technical breakdown.`;
            const plan = planMap.get(k.id);
            const visualPrompt = plan?.source_snapshot?.posterPrompt || dynamicPrompt;
            const finalHeadline = plan?.source_snapshot?.headline || headline;
            const imageUrl = plan?.source_snapshot?.mediaUrl || null;
            const assetId = plan?.source_snapshot?.mediaAssetId || null;
            const caption = plan?.variants?.LinkedIn?.caption || plan?.body || cleanCaption;
            const titleTags = cleanTitle.split(/\s+/).filter((w) => w.length > 3).slice(0, 4).map((w) => `#${w.replace(/[^\w]/g, "")}`);
            const hashtags = titleTags.length > 0 ? titleTags : ["#Innovation", "#Strategy", "#Business", "#Leadership"];
            scripts.push({
                id: k.id,
                page: pageNum,
                concept: cleanConcept,
                excerpt: (k.source_excerpt || "").trim(),
                knowledgeType: k.knowledge_type,
                sourceImageUrl: imageUrl,
                mediaAssetId: assetId,
                posterPrompt: visualPrompt,
                headline: finalHeadline,
                caption,
                hashtags,
            });
        }
        return { scripts };
    }
    async deleteDocument(r, documentId) {
        assertPermission(r.workspace.role, "edit");
        const w = r.workspace.id;
        const docRes = await pool.query("SELECT id, original_filename FROM documents WHERE id = $1 AND workspace_id = $2", [documentId, w]);
        if (!docRes.rowCount) {
            throw new NotFoundException("Document not found in this workspace.");
        }
        return transaction(async (db) => {
            // 1. Find all knowledge IDs belonging to this document
            const kRows = await db.query("SELECT id FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2", [documentId, w]);
            const kIds = kRows.rows.map((row) => row.id);
            // 2. Find all autopilot plans linked to this document (by knowledge_id, source_snapshot, or text match)
            let planRows;
            if (kIds.length > 0) {
                planRows = await db.query(`SELECT id, content_id FROM knowledge_content_plans 
           WHERE workspace_id = $1 AND (
             knowledge_id = ANY($2::uuid[]) OR 
             source_snapshot->'sources' @> $3::jsonb OR
             source_snapshot->>'documentId' = $4 OR
             source_snapshot::text LIKE '%' || $4 || '%'
           )`, [w, kIds, JSON.stringify([{ documentId }]), documentId]);
            }
            else {
                planRows = await db.query(`SELECT id, content_id FROM knowledge_content_plans 
           WHERE workspace_id = $1 AND (
             source_snapshot->'sources' @> $2::jsonb OR
             source_snapshot->>'documentId' = $3 OR
             source_snapshot::text LIKE '%' || $3 || '%'
           )`, [w, JSON.stringify([{ documentId }]), documentId]);
            }
            const planContentIds = planRows.rows.map((p) => p.content_id).filter(Boolean);
            const planIds = planRows.rows.map((p) => p.id);
            // Collect any content IDs linked directly to this document via content_sources
            const csRows = await db.query("SELECT content_id FROM content_sources WHERE document_id = $1 AND workspace_id = $2", [documentId, w]);
            const allContentIds = [
                ...new Set([...planContentIds, ...csRows.rows.map((r) => r.content_id).filter(Boolean)]),
            ];
            // 3. Delete knowledge_content_plans FIRST because knowledge_content_plans.content_id has NO ACTION FK on content
            if (planIds.length > 0) {
                await db.query("DELETE FROM knowledge_content_plans WHERE id = ANY($1::uuid[]) AND workspace_id = $2", [planIds, w]);
            }
            if (kIds.length > 0) {
                await db.query("DELETE FROM knowledge_content_plans WHERE knowledge_id = ANY($1::uuid[]) AND workspace_id = $2", [kIds, w]);
            }
            // 4. Delete dependent records of content (approvals, scheduled_posts, published_posts, video_renders, content_versions, content_sources) then content
            if (allContentIds.length > 0) {
                // Disconnect any remaining plans if any
                await db.query("UPDATE knowledge_content_plans SET content_id = NULL WHERE content_id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
                await db.query("DELETE FROM approvals WHERE content_id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
                await db.query("DELETE FROM scheduled_posts WHERE content_id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
                try {
                    // published_posts links to scheduled_posts(id), not directly to content_id
                    await db.query("DELETE FROM published_posts WHERE scheduled_post_id IN (SELECT id FROM scheduled_posts WHERE content_id = ANY($1::uuid[]))", [allContentIds]);
                }
                catch (e) {
                    console.warn("[deleteDocument] published_posts delete skipped/failed:", e);
                }
                await db.query("DELETE FROM video_renders WHERE content_id = ANY($1::uuid[])", [allContentIds]);
                await db.query("DELETE FROM content_versions WHERE content_id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
                await db.query("DELETE FROM content_sources WHERE content_id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
                await db.query("DELETE FROM content WHERE id = ANY($1::uuid[]) AND workspace_id = $2", [allContentIds, w]);
            }
            // 5. Delete document-specific artifacts: media, knowledge, chunks, pages, ai_generations, visual_concepts
            try {
                await db.query("DELETE FROM document_visual_concepts WHERE document_id = $1", [documentId]);
            }
            catch (e) {
                console.warn("[deleteDocument] document_visual_concepts delete skipped/failed:", e);
            }
            await db.query("DELETE FROM document_source_media WHERE document_id = $1 AND workspace_id = $2", [documentId, w]);
            await db.query("DELETE FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2", [documentId, w]);
            await db.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);
            await db.query("DELETE FROM document_pages WHERE document_id = $1", [documentId]);
            await db.query("DELETE FROM ai_generations WHERE workspace_id = $1 AND (input->>'documentId' = $2 OR input->>'document_id' = $2)", [w, documentId]);
            // 6. Delete the document record itself
            await db.query("DELETE FROM documents WHERE id = $1 AND workspace_id = $2", [
                documentId,
                w,
            ]);
            await audit(db, w, r.user.id, "DOCUMENT_DELETED", "document", documentId, docRes.rows[0].original_filename);
            return { success: true, documentId };
        });
    }
};
__decorate([
    WorkspaceRequired(),
    Post(),
    __param(0, Req()),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "createDocument", null);
__decorate([
    WorkspaceRequired(),
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "listDocuments", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocument", null);
__decorate([
    WorkspaceRequired(),
    Post(':documentId/source-media/extract'),
    __param(0, Req()),
    __param(1, Param('documentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "extractSourceMedia", null);
__decorate([
    WorkspaceRequired(),
    Get(':documentId/source-media/:sourceId/original'),
    __param(0, Req()),
    __param(1, Param('documentId')),
    __param(2, Param('sourceId')),
    __param(3, Res()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "sourceOriginal", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/source-media"),
    __param(0, Req()),
    __param(1, Param('documentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "sourceMedia", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/visual-concepts"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getVisualConcepts", null);
__decorate([
    WorkspaceRequired(),
    Post(":documentId/visual-concepts/regenerate"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "regenerateVisualConcepts", null);
__decorate([
    WorkspaceRequired(),
    Post(":documentId/visual-concepts/:conceptId/generate-image"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("conceptId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "generateConceptVisual", null);
__decorate([
    WorkspaceRequired(),
    Post(":documentId/visual-concepts/:conceptId/dispatch"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("conceptId")),
    __param(3, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "dispatchVisualConcept", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/pages"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentPages", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/pages/:pageNumber"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __param(2, Param("pageNumber")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentPage", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/chunks"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getDocumentChunks", null);
__decorate([
    WorkspaceRequired(),
    Post(":documentId/reprocess"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "reprocessDocument", null);
__decorate([
    WorkspaceRequired(),
    Post(":documentId/fast-track"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "fastTrackDocument", null);
__decorate([
    WorkspaceRequired(),
    Get(":documentId/poster-scripts"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "getPosterScripts", null);
__decorate([
    WorkspaceRequired(),
    Delete(":documentId"),
    __param(0, Req()),
    __param(1, Param("documentId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], DocumentsController.prototype, "deleteDocument", null);
DocumentsController = __decorate([
    Controller("documents")
], DocumentsController);
export { DocumentsController };
