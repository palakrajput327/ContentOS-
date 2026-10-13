# PDF image storage efficiency audit

Date: 12 October 2026. This storage prerequisite takes priority over Visual Knowledge Phases 2–3. It extends the existing extraction/storage paths; it does not replace document knowledge or publishing workflows.

## Audit findings

The Phase 1 implementation already used workspace-scoped SHA-256 deduplication, advisory locks, deterministic keys and document/page provenance. However, each unique image was stored as a full decoded PNG, bitmap-free pages were rendered indiscriminately, and file-size caps were not workspace quotas. Re-extraction preserved identity, but orphaned assets had no retention inventory.

PostgreSQL stores media metadata and provenance, not image buffers/base64. `media_assets` maps each asset to its provider/bucket/key and recorded byte size. `document_source_media` maps document/page/image index to an asset. Original PDFs are separate DOCUMENT assets. Storage uses configured S3-compatible object storage, or a local `uploads` directory when S3 configuration is absent. cPanel local storage therefore includes both PDFs and derived media; S3 media generally consumes object storage rather than cPanel disk, while PostgreSQL remains on its configured database host.

Some legacy auto/festival poster writes created objects without media rows. Their production call sites now pass workspace context and reserve managed-media records before upload. Existing poster rendering and URLs are preserved. Older uncatalogued objects still require reconciliation; they cannot be assigned to a workspace or deleted safely solely from age or filename.

Local read-only inventory found 132 files totaling approximately 55.8 MiB, including 13 PDFs totaling 35.2 MiB. This includes development/test artifacts and is not a production cPanel or representative customer sample. No production database inventory, cPanel measurement, or live S3 access was performed.

## Implemented controls

| Concern | Result |
| --- | --- |
| Persistent image copies | New PDF source media stores compact WebP previews; original image bytes stay in the PDF. |
| Thumbnail size | Maximum long edge 512px; quality starts at 72 with size fallback; each preview is capped at 96 KiB. Original dimensions remain in metadata. |
| Useful-image filtering | Skip images below 96px in either dimension, below 40,000 pixels area, extreme strips above 15:1 aspect, and near-uniform sampled images. This is a heuristic, not semantic usefulness detection. |
| Page screenshots | Skip screenshot storage for text-rich pages (80+ extracted characters). Render visual/scanned/vector pages when no useful embedded bitmap exists; near-blank renderings are filtered. |
| Per-document previews | Up to 100 distinct useful previews / 8 MiB. Existing decoded-image/page safety limits remain. Repeated page references do not count as duplicate preview bytes. |
| Deduplication | Exact full-image SHA-256 within a workspace; one stored preview can have many document/page references. Similar but differently encoded images and duplicate original PDF uploads are not semantically deduplicated. |
| Re-extraction | Reuse asset IDs and object keys; no new files for matching images. Filtering preserves existing source references, PDFs and knowledge. |
| On-demand originals | Authenticated, workspace-scoped original-image download reconstructs the selected embedded image from its PDF in memory, checks its checksum and sends it with private/no-store headers. No persistent full-resolution cache is created. Vector-page renditions use a 1200px render; the PDF remains the scalable original. |
| Workspace quota | Migration 019 adds a default 1 GiB managed-media budget, adjustable by operators per workspace. A PostgreSQL trigger serializes increases and counts pending reservations plus retained/failed/soft-deleted media until physical purge is recorded. Concurrent writes cannot overbook recorded capacity. |
| Upload bounds | Upload presigning checks workspace capacity; S3 upload signing binds declared content length; completion verifies actual size and prevents changes to completed assets. Existing local upload size enforcement remains. |
| Generated media | Clipdrop, background removal, automatic text posters and festival posters reserve catalogued bytes before provider writes. Quota rejection happens before a new object is written. |
| User feedback | Business knowledge shows compressed-preview labels, storage usage, filtered count and on-demand original download. |
| Retention audit | A read-only candidate inventory excludes active source, document, content, version, knowledge and derivative references and requires 30 days without a source reference. |

Existing full-resolution source assets are retained and reused. This update does not silently replace assets used by existing posts or delete legacy files. Their recorded bytes continue to count toward the quota. Real usage may therefore stay high until an explicit, reference-aware compaction/reconciliation is completed.

Managed-media quota accounting is conservative metadata accounting, not a filesystem scan. Pre-existing uncatalogued objects, PostgreSQL WAL/backups, filesystem block overhead, and objects left by an upload followed by a transaction rollback are outside these totals. Deterministic thumbnail keys prevent repeated extraction failures from creating multiple differently named previews. Generated-asset transaction rollback still requires object reconciliation; SQL transactions cannot atomically commit external object storage. If changing storage provider, reconcile legacy provider labels and physical locations before cleanup.

## Estimated consumption

These are planning estimates, not measurements. MiB = 1,048,576 bytes; GiB = 1,024 MiB. Both scales assume unique PDFs in one or more appropriately sized workspaces, exact-image deduplication within each workspace, no retained high-resolution derivatives, and no original-PDF duplicates.

Typical assumptions per PDF:

- Original PDF: 5 MiB, about 20 pages.
- 12 useful image previews at an average 40 KiB each.
- 20% repeated image bytes deduplicated across documents in the same workspace: 384 KiB / 0.375 MiB additional previews per PDF.
- PostgreSQL text/chunks/knowledge/media metadata and indexes: estimated 0.2 MiB per PDF. Actual density varies substantially; images are not stored in PostgreSQL.

| Component | 100 PDFs | 1,000 PDFs |
| --- | ---: | ---: |
| Original PDFs | 500 MiB | 5,000 MiB / 4.88 GiB |
| Compressed unique previews | 37.5 MiB | 375 MiB / 0.37 GiB |
| PostgreSQL records/index estimate | 20 MiB | 200 MiB / 0.20 GiB |
| Combined estimate | **557.5 MiB / 0.54 GiB** | **5,575 MiB / 5.44 GiB** |

Without the assumed 20% deduplication, the combined totals become approximately 0.55 GiB and 5.54 GiB. With the former full-image approach at 1.5 MiB per extracted image, the equivalent estimates are about 2.27 GiB and 22.66 GiB before any extra page screenshots. The preview change reduces derived-image bytes by about 98% under those assumptions, not original PDF storage.

Image-heavy scenario: 20 MiB PDF, 40 useful previews averaging 60 KiB, 10% duplicate-image reduction, and 0.5 MiB PostgreSQL records/indexes per PDF. Combined estimate: **2.21 GiB for 100 PDFs** and **22.08 GiB for 1,000 PDFs**. If each PDF reaches both the 50 MiB input ceiling and 8 MiB preview cap, media alone could reach 5.66 GiB / 56.64 GiB, so the normal per-workspace quota remains the governing bound.

Keep 25–30% free operational headroom, and budget backups/WAL separately. Typical 1,000-PDF use needs roughly 7 GiB usable capacity before other creative/video assets and backup copies. The initial 1 GiB workspace quota is not a promise of sufficient space for 1,000 PDFs; operators must set the appropriate workspace limit after inventorying existing usage.

## Recommended cleanup and retention

1. Keep original PDFs for the lifetime of an active business resource. Never age-delete active PDFs or confirmed knowledge. Document removal and legal retention remain explicit workspace decisions.
2. Keep active thumbnails. Consider unused source previews for cleanup only after 30 days without references; preserve assets referenced by content, historical versions, knowledge or derivatives. Inspect the dry-run inventory before enabling any physical cleanup.
3. Reconcile abandoned uploads after at least 24 hours (well beyond signed-upload expiry). Check there is no document/content reference and verify physical object state. Only then remove the object and record `storage_purged_at` to release quota. Failed physical deletes must retain their reserved accounting and retry later.
4. Keep full-resolution source images uncached by default. If later Phase 3 requires a temporary working cache, cap it, deduplicate it, expire it after 24 hours and pin anything referenced by a final creative. Retain approved final posters as independent derivatives with source lineage.
5. Reconcile legacy `auto-posters`/`festival-posters` folders and older full-resolution source assets separately. Back up, map keys to documents/posts, and compact or remove only proven unreferenced derivatives. Unidentified objects should be reported, not automatically erased.
6. Schedule a weekly read-only inventory initially. Add a guarded cleanup job only after reference checks and object reconciliation are operational. Prefer external S3-compatible storage for growing media libraries on constrained cPanel disk, using the existing provider implementation.

## Validation and activation

Isolated PostgreSQL tests cover real PDF extraction, WebP bounds, small/blank filtering, original reconstruction, concurrent deduplication and quota reservation, stable reruns, knowledge preservation, tenant isolation, failure retention, and retention candidate/reference/grace-period checks. No production PDFs or knowledge were deleted.

Apply migrations 018 (if not applied) and 019 before restarting the API/PDF worker with the current build. Existing workspaces default to 1 GiB; inspect their usage and set limits before activation. Production migrations were not run during this task.

Read-only retention inventory after deployment:

```powershell
node scripts/audit-source-retention.mjs WORKSPACE_UUID
```

The inventory script never deletes files or rows. Phase 2 OCR/visual review and Phase 3 source-image posters remain pending while this prerequisite is finalized.
