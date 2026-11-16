# ContentOS Feature Registry (FEATURE_REGISTRY.md)

This registry catalogs every major system feature in ContentOS, its architecture connections, relevant backend controllers/services, frontend components/pages, database tables, and external platform interactions.

---

## 1. Feature Index

| # | Feature Domain | Key Controllers / Services | Primary UI Views | Database Tables |
|---|---|---|---|---|
| 1 | **Authentication & Multi-Tenancy** | `phase-auth.controller.ts`, `security.ts`, `workspace.controller.ts` | `Auth.tsx`, `Authentication.tsx`, `EmailCode.tsx` | `users`, `auth_sessions`, `workspaces`, `workspace_members` |
| 2 | **Bulk Post Deletion** | `content.controller.ts`, `post-deletion.service.ts`, `social-platform-delete.service.ts` | `BulkDeletePostsModal.tsx`, `Library.tsx` | `scheduled_posts`, `published_posts`, `content`, `activity_logs` |
| 3 | **PDF Knowledge Automation & Visual Concepts** | `documents.controller.ts`, `visual-concepts.service.ts`, `brand-identity.service.ts`, `caption-generator.ts` | `AIStudio.tsx` (`tab=pdf`), `DocumentVisualConceptsHub.tsx`, `BrandIdentityModal.tsx` | `documents`, `document_chunks`, `document_visual_concepts`, `document_brand_identities` |
| 4 | **AI Visual Studio & Poster Generation** | `clipdrop.controller.ts`, `clipdrop.service.ts`, `openai-image.ts` | `ClipdropImageModal.tsx`, `AIStudio.tsx` | `media_assets`, `content` |
| 5 | **Multi-Platform Composer & Publishing** | `content.controller.ts`, `publishing.ts`, `meta.publishing.ts`, `youtube.service.ts` | `Composer.tsx`, `YouTubeComposer.tsx`, `PublishPreviewModal.tsx` | `content`, `scheduled_posts`, `published_posts` |
| 6 | **Calendar & Posting Slots Automation** | `calendar.controller.ts`, `posting-slots.service.ts`, `auto-scheduler.ts` | `Calendar.tsx`, `PostingSlotsModal.tsx`, `BatchRescheduleModal.tsx` | `posting_slots`, `scheduled_posts` |
| 7 | **Indian Festival Automation** | `festival.controller.ts`, `festival.service.ts`, `festival-auto-scheduler.ts` | `FestivalAutomation.tsx`, `Calendar.tsx` (festival badges) | `festival_campaigns`, `scheduled_posts` |
| 8 | **Social Accounts & OAuth Integration** | `social.controller.ts`, `social.oauth.ts`, `meta.api.ts`, `youtube.api.ts` | `Manage.tsx` (channels view), `Shell.tsx` | `social_accounts`, `social_account_tokens` |
| 9 | **Content Library & Collaboration** | `content.controller.ts`, `comments.controller.ts`, `notifications.controller.ts` | `Library.tsx`, `ContentDiscussionPanel.tsx`, `NotificationBell.tsx` | `content`, `content_comments`, `notifications` |
| 10 | **Super Admin & Billing** | `admin.controller.ts`, `billing.controller.ts`, `entitlement.service.ts` | `Admin.tsx`, `Billing.tsx` | `users`, `subscriptions`, `admin_audit_logs` |
| 11 | **Instagram AI Creative Studio** | `instagram-studio.controller.ts`, `brand-dna.service.ts`, `creative-variation.service.ts`, `carousel.service.ts` | `AIStudio.tsx` (`tab=instagram`), `BrandDnaModal.tsx`, `InstagramCreativeLab.tsx`, `InstagramCarouselBuilder.tsx` | `workspace_brand_dna`, `creative_variations`, `instagram_carousels`, `instagram_carousel_slides` |

---

## 2. Deep-Dive Feature Specifications

### 2.1 Bulk Post Deletion
* **Purpose:** Safely delete posts in bulk with granular scopes and live social platform removal.
* **Supported Scopes:**
  1. `all` - All posts across the workspace.
  2. `today` - Only posts scheduled or published today (respecting client timezone offset).
  3. `channel-specific` - All posts for a selected channel (e.g., Telegram, LinkedIn).
  4. `channel-today` - Today's posts for a selected channel.
  5. `custom_range` - Posts between `startDate` and `endDate`.
  6. `selected_ids` - Specific posts explicitly selected via checkboxes in the Content Library.
* **Safety Mechanism:**
  * Two-phase interaction: Preview (`POST /content/bulk-delete/preview`) followed by execution with explicit confirmation (`POST /content/bulk-delete/execute` with `confirm: true`).
  * Live external social API deletion is performed first (`SocialPlatformDeleteService`).
  * **Strict safety rule:** If an external network API fails, the local database record is preserved and the failure is logged.
  * Successful deletions clean up `scheduled_posts`, `published_posts`, unreferenced parent `content`, and reset associated `document_visual_concepts` back to `PENDING`.

### 2.2 PDF Knowledge Automation & Visual Concepts Hub
* **Purpose:** Convert corporate PDFs (whitepapers, decks, strategy documents) into scheduled social campaigns.
* **Pipeline:**
  1. **Upload & Ingestion:** PDF uploaded to `documents` table and stored via `StorageProvider`.
  2. **Extraction & Chunking:** `pdf-parse` extracts raw text; `pdf-extractor.ts` extracts embedded images; `document-chunker.ts` splits content into semantic chunks.
  3. **Visual Concepts Extraction:** High-impact statements are identified and translated into visual concepts (`document_visual_concepts`) with tailored FLUX prompts.
  4. **Brand Identity:** Per-PDF logos, website domains, and brand colors are extracted or manually reviewed (`BrandIdentityModal.tsx`).
  5. **Visual Synthesis:** High-res images generated via FLUX.1.
  6. **Canvas Brand Compositing:** `@napi-rs/canvas` overlays logo and domain cleanly.
  7. **Platform Copy & Hashtags:** Unique captions built per platform (LinkedIn, Instagram, Facebook, Telegram, X).
  8. **Slot Dispatch:** Scheduled automatically into daily posting slots.

### 2.3 AI Visual Studio & Image Engines
* **Engines:**
  * **FLUX.1 Schnell:** Primary production engine. High detail, zero moderation false-positives, rapid response time.
  * **Pollinations FLUX:** SOTA open and authenticated endpoints.
  * **ClipDrop API:** Text-to-image API.
  * **OpenAI (DALL-E 3 / GPT-Image):** Supported when account credits are present.
* **Features:** Aspect ratio cropping (`1:1`, `16:9`, `9:16`, `4:5`), custom style presets (`3D Render`, `Cinematic`, `Minimal SaaS`, `Cyberpunk`, `Editorial`), media library registration.

### 2.4 Multi-Platform Composer & Publishing
* **Supported Channels:**
  * **LinkedIn:** UGC posts & text/image shares via LinkedIn REST API.
  * **Telegram:** Bot API messages, photo uploads, HTML/Markdown formatting.
  * **Facebook:** Page posts & image publishing via Meta Graph API v22.0.
  * **Instagram:** Single image & carousel publishing via Instagram Business Graph API.
  * **X (Twitter):** Tweet publishing via Twitter API v2.
  * **YouTube:** Video upload and scheduling via YouTube Data API v3.
* **Validation:** Dynamic character counters, platform-specific image dimension checks, video format inspection (`ffprobe`).

### 2.5 Calendar, Daily Slots & Indian Festival Automation
* **Daily Slots:** Configurable posting times per day (e.g. Morning 10:00 AM, Afternoon 2:00 PM, Evening 6:00 PM).
* **Auto-Scheduler:** Queued concepts automatically claim the next available unoccupied time slot.
* **Festival Automation:** Database of 45+ Indian national and cultural festivals with dynamic lunar and solar date calculators. Automatically schedules themed greeting posts ahead of time.

### 2.6 Social Accounts & Token Management
* **OAuth Flows:** Standard OAuth 2.0 authorization code grant with encrypted token storage (`social_account_tokens`).
* **Direct Credentials:** Telegram bot token configuration with chat ID resolution.
* **Account Backup & Migration:** Built-in export and restore endpoints (`/social/export-restore`) allowing seamless migration of connected channels across environments without re-authenticating.

### 2.7 Instagram AI Creative Studio (Phase 1)
* **Purpose:** End-to-end creative suite specifically tailored for Instagram, transforming business topics and PDF knowledge into high-converting branded single posts and multi-slide carousels.
* **Core Components:**
  1. **Smart Brand DNA:** Extracts and saves business identity (company name, industry, audience, tone, primary/secondary colors, logo, website domain, CTA, creative guidelines). Editable dashboard with `PENDING_REVIEW` to `APPROVED` activation workflow.
  2. **AI Creative Variation Lab:** Synthesizes 3 distinct Instagram concepts side-by-side:
     - 👑 **Premium / Luxury** (dark obsidian, metallic gold accents, executive narrative)
     - ⚡ **Modern / Minimal** (geometric glassmorphism, punchy high-readability copy)
     - 🔥 **Bold / High Engagement** (vibrant high contrast, curiosity-driven hook)
     - Independent single-variation regeneration, FLUX.1 4:5 image generation, Canvas Brand DNA overlay, and draft saving.
  3. **AI Carousel Builder:** Generates 5–10 structured slides in Instagram 4:5 portrait ratio (1080x1350):
     - Slide 1: High-curiosity Hook
     - Slides 2 to N-1: Educational content, storytelling, and actionable insights
     - Slide N: Strong CTA with logo and domain watermark
     - Drag/move slide reordering, inline slide text editing, 1080x1350 Canvas rendering, export, and draft saving.
  4. **Instagram-Only Scope:** Posts and drafts strictly target `platforms: ["instagram"]`, leaving LinkedIn, Telegram, Facebook, YouTube, and X completely unaffected.


