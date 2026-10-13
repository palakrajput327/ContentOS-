# Master blueprint addendum: Visual Knowledge Extraction & Source Media Reuse

Status: approved product direction; Phase 1 implemented, deployment migration pending. Phases 2–4 remain pending. See [Phase 1 progress](VISUAL_KNOWLEDGE_PHASE1_PROGRESS.md). This document extends the master blueprint without introducing a separate module or navigation destination.

## Product statement

Hindustan Social Network converts business PDFs and resources into a reusable, cited knowledge pool that may include extracted text, OCR text, product images, visual insights, and source-linked media assets. This knowledge can then be transformed into text posts, branded image creatives, posters using original source images, and in later phases, video content.

## Cross-module ownership

| Module | Enhancement responsibility |
| --- | --- |
| M03 Knowledge Intelligence | Extract and retain source images; record document/page provenance; extract OCR and visual insights; expose evidence for knowledge review. |
| M05 AI Content Studio | Browse approved source media in the existing workspace media flow; select “Use source image”; generate branded creatives with source attribution retained internally. |
| M07 Review & Approval | Review extracted visual knowledge and media eligibility; review resulting creatives and source evidence; retain version-specific approval before publishing in Review Mode. |

These module names follow the product owner's proposed mapping. Knowledge approval, source-media reuse approval, and final content approval are distinct decisions; none implicitly grants the others.

## Phase 1: Source media extraction and library integration

- Extract embedded PDF images and retain reusable assets in the existing workspace media library.
- Link each asset to its workspace, source document, and one-based page number; preserve multiple source references when an image repeats.
- Deduplicate repeated image assets within a workspace while retaining provenance.
- Show image thumbnails, extraction status, source page, and reuse eligibility beside the document in Business knowledge and in the existing media picker.
- Handle image-only PDFs. A scanned page may be retained as a page image, clearly distinguished from a standalone product image. Vector-only or composite pages may require page rendering rather than embedded-image extraction.
- Enforce existing upload/storage limits and workspace access. Extraction failures must not discard successfully extracted text or media, and reruns must not duplicate assets.

Acceptance: users can inspect extracted images and navigate back to their source page; another workspace cannot access them; repeated extraction preserves asset identity and source references.

## Phase 2: OCR and visual knowledge review

- Run OCR for text in images and optional visual analysis for products, diagrams, charts, and other relevant visual information.
- Store OCR text separately from model-inferred visual insights, with source page/image evidence and extraction status.
- Present extracted visual knowledge for confirmation, correction, or rejection using the existing knowledge review workflow.
- Feed only eligible, confirmed knowledge into autonomous generation. A pictured product must not acquire unsupported specifications or promotional claims through inference.

Acceptance: users can distinguish source text from visual interpretation, inspect evidence, and prevent rejected or unreviewed claims from entering the generation pool.

## Phase 3: Source-image posters

- Add “Use source image” to the existing poster/creative workflow.
- Support branded layouts with original source imagery, brand colors, logo, caption, and platform dimensions.
- Retain original assets separately from generated derivatives and link every derivative to its source media and document/page.
- Record reuse eligibility independently of knowledge confirmation; respect source usage restrictions and workspace preferences.
- Review the final creative and its claims in M07. Editing the creative invalidates approval according to the existing content-version rules.

Acceptance: an approved source image can produce a branded poster through Studio, retain traceable evidence, and follow the existing approval/scheduling flow.

## Phase 4: Extended formats

- Reuse approved source assets for carousels and advertising creatives.
- Extend to source-image-based video in a later phase, preserving the same asset lineage, review policy, quotas, and publishing safeguards.

## Integration and sequencing

Use the current Studio → Business knowledge → content creation → Approvals → Calendar flow. Do not add a separate visual-knowledge pool or sidebar module.

Publishing readiness, workspace publishing pause, safe retries, subscription enforcement, and explicit Full Auto authorization remain separate unfinished work. This enhancement does not make Full Auto complete or bypass its policies.

Phase 1 storage and Phase 2/3 implementation are present. See [Phase 2/3 progress](VISUAL_KNOWLEDGE_PHASE2_3_PROGRESS.md) for verification and remaining deployment, browser and live-provider checks. Phase 4 follows validation of the shared asset pipeline.
