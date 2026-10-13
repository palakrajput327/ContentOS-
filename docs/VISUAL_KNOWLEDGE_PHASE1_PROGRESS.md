# Visual Knowledge & Media Reuse — Phase 1

Implemented source-image extraction within M03 and source inspection in the existing M05 Business knowledge screen. No new sidebar module or separate knowledge pool.

Storage follow-up: [PDF storage efficiency audit](PDF_STORAGE_EFFICIENCY_AUDIT.md) supersedes the original full-resolution storage behavior and limits described below. New assets are compressed previews with originals reconstructed from the PDF on demand; workspace quota controls require migration 019. Existing source assets/knowledge remain preserved.

## Delivered

- PDF worker extracts embedded images into existing workspace `media_assets` storage. Pages without embedded bitmaps receive explicitly labeled page renditions, including vector-only pages.
- Migration 018 stores document/page/image-index provenance independently of replaceable extracted text pages. Composite foreign keys enforce workspace consistency.
- Workspace-scoped SHA-256 deduplication with advisory locks preserves asset identity across repeated images, concurrent documents and extraction reruns. Successful reruns remove obsolete provenance; failed runs retain available images and report the error.
- Existing Business knowledge screen shows responsive image cards, original image links, source PDF page links, extraction errors and refresh. Signed URLs refresh while the screen remains open.
- Authorized editors can extract/re-extract images on older documents without replacing extracted facts, changing their approvals, or regenerating content. API permission checks enforce the same edit roles as document management; manual requests are logged.
- Media is marked `UNREVIEWED` for reuse. Extraction does not approve image usage or generated claims. Visual insight review and poster selection remain later phases.
- Processing is page-by-page, bounded to 200 images, 20 MB per image and 100 MB total output; manual source reads are capped at 50 MB. These technical limits do not substitute for pending subscription/storage metering.

## Validation

Backend and frontend TypeScript checks and production frontend build pass. Existing large frontend bundle warning remains.

`node scripts/test-source-media.mjs` uses generated PDFs and isolated PostgreSQL/local storage; it does not use the application database or social accounts. Tests verify embedded images, repeated images across pages, vector rendering, page references, concurrent deduplication, stable rerun asset identity, tenant isolation, failure retention and source-reference deletion. A pdf-parse shared-image wait across sequential page calls was found and fixed using fresh parsers per page.

Read-only browser fixture confirms source thumbnails, page links and pending-review labels. Mobile 390px layout has loaded images and no document horizontal overflow; dark/light switching preserves the view. This does not certify live S3 credentials or all real-world PDF encodings.

## Activation

Apply migration `018_document_source_media.sql` through the existing migration runner before restarting the API/PDF worker with the new build. The application database was not migrated during implementation. Older PDFs can then use **Extract images** in AI Studio → Business knowledge. New PDF processing includes extraction automatically.

Deletion removes document provenance but retains shared media assets; automatic orphaned-asset garbage collection is outside this phase. Source page links use the viewer's standard `#page=N` fragment, which depends on PDF viewer support.

Next: Phase 2, OCR and visual insight extraction with evidence review; then Phase 3, “Use source image” in the branded poster flow.
