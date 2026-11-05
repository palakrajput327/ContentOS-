# ContentOS API Contracts (API_CONTRACTS.md)

This document specifies the HTTP endpoints, payload formats, authentication headers, and response envelopes for the ContentOS API.

---

## 1. Global Conventions

### 1.1 Base URL & Prefix
* All API endpoints are prefixed with `/api/v1`.
* Local backend runs at: `http://localhost:3001/api/v1`

### 1.2 Headers & Cookies
* **Authentication:** Sent as an HTTP-only cookie named `contentos_session`.
* **Workspace Scoping:** All workspace endpoints require the header `X-Workspace-Id: <uuid>`.
* **Content Type:** `Content-Type: application/json` (except multipart file uploads).

### 1.3 Response Envelopes

#### Success Envelope (`HTTP 200 / 201`)
```json
{
  "data": { ... },
  "requestId": "4d574fa2-af90-45e3-a292-fa5091aa0b6e"
}
```

#### Error Envelope (`HTTP 400 / 401 / 403 / 404 / 500`)
```json
{
  "error": {
    "code": "HTTP_400",
    "message": "Specific error description"
  },
  "message": "Specific error description",
  "requestId": "4d574fa2-af90-45e3-a292-fa5091aa0b6e"
}
```

---

## 2. Authentication & Session Endpoints

### `POST /api/v1/auth/register`
* **Access:** Public
* **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "StrongPassword123!",
    "name": "Jane Doe"
  }
  ```
* **Response:** `{ user: { id, name, email }, sessionToken }`

### `POST /api/v1/auth/login`
* **Access:** Public
* **Request Body:**
  ```json
  {
    "email": "user@example.com",
    "password": "StrongPassword123!"
  }
  ```
* **Response:** `{ user: { id, name, email }, activeWorkspaceId }` Sets cookie `contentos_session`.

### `GET /api/v1/auth/session`
* **Access:** Authenticated
* **Response:**
  ```json
  {
    "user": { "id": "uuid", "name": "Jane Doe", "email": "user@example.com" },
    "workspaces": [
      { "id": "uuid", "name": "Jane's Workspace", "role": "Owner" }
    ],
    "activeWorkspace": { "id": "uuid", "name": "Jane's Workspace", "role": "Owner" }
  }
  ```

---

## 3. Bulk Post Deletion Endpoints

### `POST /api/v1/content/bulk-delete/preview`
* **Access:** Workspace Required (`schedule` permission)
* **Headers:** `X-Workspace-Id: <uuid>`
* **Request Body:**
  ```json
  {
    "scope": "all | today | custom_range | selected_ids",
    "channel": "all | linkedin | telegram | facebook | instagram | twitter | youtube",
    "status": "all | published | scheduled | failed",
    "startDate": "2026-11-01T00:00:00.000Z",
    "endDate": "2026-11-04T23:59:59.999Z",
    "postIds": ["uuid-1", "uuid-2"],
    "timezoneOffsetMinutes": -330
  }
  ```
* **Response (`HTTP 201`):**
  ```json
  {
    "totalMatching": 12,
    "platformDeletableCount": 8,
    "channelsSummary": {
      "telegram": 4,
      "linkedin": 4,
      "facebook": 4
    },
    "items": [
      {
        "id": "uuid-1",
        "title": "Fintech Platform Architecture",
        "channel": "telegram",
        "status": "PUBLISHED",
        "scheduledAt": "2026-11-03T10:00:00.000Z",
        "publishedAt": "2026-11-03T10:00:15.000Z",
        "providerPostId": "142981",
        "canDeleteFromPlatform": true
      }
    ]
  }
  ```

### `POST /api/v1/content/bulk-delete/execute`
* **Access:** Workspace Required (`schedule` permission)
* **Headers:** `X-Workspace-Id: <uuid>`
* **Request Body:**
  ```json
  {
    "confirm": true,
    "scope": "all | today | custom_range | selected_ids",
    "channel": "all | linkedin | telegram | facebook | instagram | twitter | youtube",
    "status": "all | published | scheduled | failed",
    "startDate": "2026-11-01T00:00:00.000Z",
    "endDate": "2026-11-04T23:59:59.999Z",
    "postIds": ["uuid-1", "uuid-2"],
    "deleteFromPlatform": true,
    "timezoneOffsetMinutes": -330
  }
  ```
* **Response (`HTTP 201`):**
  ```json
  {
    "summary": {
      "requested": 12,
      "totalDeleted": 12,
      "databaseDeleted": 12,
      "platformDeleted": 8,
      "platformFailed": 0,
      "skipped": 0
    },
    "items": [
      {
        "postId": "uuid-1",
        "channel": "telegram",
        "title": "Fintech Platform Architecture",
        "status": "DELETED",
        "platformDeleted": true
      }
    ]
  }
  ```

---

## 4. Document Knowledge & Visual Concepts Endpoints

### `POST /api/v1/documents/upload`
* **Access:** Workspace Required (`edit` permission)
* **Content-Type:** `multipart/form-data`
* **Fields:** `file` (PDF binary)
* **Response:** `{ id: "uuid", filename: "deck.pdf", status: "PROCESSING" }`

### `GET /api/v1/documents/:documentId/visual-concepts`
* **Access:** Workspace Required
* **Response:**
  ```json
  [
    {
      "id": "uuid",
      "documentId": "doc-uuid",
      "conceptTitle": "Booster Income Accelerator Tiers",
      "sourcePage": 5,
      "sourceExcerpt": "Accelerators provide multi-tiered liquidity...",
      "prompt": "Advanced financial performance dashboard displaying tiered accelerator metrics...",
      "caption": "Official Insight Briefing: Multi-tiered liquidity frameworks...",
      "status": "QUEUED | DISPATCHED | GENERATED",
      "imageUrl": "https://.../signed-image.png",
      "assetId": "asset-uuid"
    }
  ]
  ```

### `POST /api/v1/documents/:documentId/visual-concepts/:conceptId/generate-image`
* **Access:** Workspace Required (`edit` permission)
* **Request Body:**
  ```json
  {
    "prompt": "Optional modified prompt string",
    "force": true
  }
  ```
* **Response:**
  ```json
  {
    "conceptId": "concept-uuid",
    "assetId": "asset-uuid",
    "imageUrl": "https://.../signed-url.jpg"
  }
  ```

### `POST /api/v1/documents/:documentId/visual-concepts/:conceptId/dispatch`
* **Access:** Workspace Required (`schedule` permission)
* **Request Body:**
  ```json
  {
    "channels": ["linkedin", "telegram"],
    "caption": "Custom edited caption"
  }
  ```
* **Response:**
  ```json
  {
    "success": true,
    "conceptId": "concept-uuid",
    "dispatchedAt": "2026-11-04T12:00:00.000Z",
    "publishedCount": 2
  }
  ```

### `PATCH /api/v1/documents/:documentId/visual-concepts/:conceptId/caption`
* **Access:** Workspace Required (`edit` permission)
* **Request Body:** `{ "caption": "Updated text caption..." }`
* **Response:** `{ "success": true, "conceptId": "concept-uuid" }`

### `GET /api/v1/documents/:documentId/brand-identity`
* **Access:** Workspace Required
* **Response:**
  ```json
  {
    "documentId": "doc-uuid",
    "companyName": "TradeOrbit",
    "websiteDomain": "www.tradeorbit.com",
    "logoUrl": "https://.../logo.png",
    "brandColors": ["#3b82f6", "#10b981"],
    "logoPosition": "top-right",
    "domainPosition": "bottom-center",
    "status": "CONFIRMED | DETECTED | PENDING_REVIEW"
  }
  ```

---

## 5. AI Studio Image Synthesis Endpoints

### `POST /api/v1/clipdrop/generate-image`
* **Access:** Workspace Required (`edit` permission)
* **Request Body:**
  ```json
  {
    "prompt": "Photorealistic modern tech workspace with volumetric lighting",
    "aspectRatio": "1:1 | 16:9 | 9:16 | 4:5",
    "stylePreset": "none | 3d-render | cinematic | minimal-saas | cyberpunk | editorial",
    "enableOverlay": false,
    "engine": "flux | clipdrop | openai"
  }
  ```
* **Response:**
  ```json
  {
    "assetId": "asset-uuid",
    "url": "https://.../download-url.jpg",
    "engine": "flux",
    "cached": false
  }
  ```

---

## 6. Calendar & Festival Endpoints

### `GET /api/v1/calendar/events`
* **Access:** Workspace Required
* **Query Params:** `start=2026-11-01&end=2026-11-30`
* **Response:** Array of scheduled post events with channel, time, and status.

### `GET /api/v1/calendar/slots`
* **Access:** Workspace Required
* **Response:** Array of posting slots: `[{ "id": "uuid", "time": "10:00", "label": "Morning Slot" }]`

### `POST /api/v1/calendar/festivals/schedule`
* **Access:** Workspace Required (`schedule` permission)
* **Request Body:** `{ "festivalId": "diwali-2026", "channels": ["linkedin", "telegram"] }`
* **Response:** Scheduled greeting post item.

---

## 7. Social Accounts Endpoints

### `GET /api/v1/social/accounts`
* **Access:** Workspace Required
* **Response:** Array of connected accounts with provider name, profile display name, and status.

### `POST /api/v1/social/export-restore`
* **Access:** Workspace Required (`manage` permission)
* **Request Body (Restore mode):** Array of account records with encrypted credentials.
* **Response:** `{ "restoredCount": 5 }`

---

## 8. Instagram AI Creative Studio Endpoints

### Brand DNA
* `GET /api/v1/instagram-studio/brand-dna` - Fetches workspace Brand DNA profile (`BrandDnaProfile`).
* `POST /api/v1/instagram-studio/brand-dna/extract` - Extracts brand intelligence from PDF or website (`{ documentId?: string, rawText?: string, url?: string }`).
* `PUT /api/v1/instagram-studio/brand-dna` - Updates brand identity fields (`Partial<BrandDnaProfile>`) and approves (`status: "APPROVED"`).
* `POST /api/v1/instagram-studio/brand-dna/upload-logo` - Uploads logo dataUrl and extracts dominant brand colors (`{ dataUrl: string, filename?: string }`).

### Creative Variation Lab
* `POST /api/v1/instagram-studio/variations/generate` - Synthesizes 3 distinct concepts (`PREMIUM_LUXURY`, `MODERN_MINIMAL`, `BOLD_ENGAGEMENT`) with 4:5 visual prompts, headlines, captions, and CTAs (`{ topic: string, documentId?: string }`).
* `GET /api/v1/instagram-studio/variations/batch/:batchId` - Returns all 3 variations in a batch.
* `POST /api/v1/instagram-studio/variations/:id/generate-image` - Synthesizes 4:5 image via FLUX.1 + Canvas Brand DNA compositing (`{ prompt?: string }`).
* `POST /api/v1/instagram-studio/variations/:id/regenerate` - Regenerates one variation independently (`{ prompt?: string }`).
* `POST /api/v1/instagram-studio/variations/:id/save-draft` - Saves variation into ContentOS with `platforms: ["instagram"]` and `status: "DRAFT"`.

### AI Carousel Builder
* `POST /api/v1/instagram-studio/carousels/generate` - Synthesizes 5–10 structured slides (Hook, Content, CTA) in 4:5 ratio (`{ topic: string, slideCount?: number, themeStyle?: string, documentId?: string }`).
* `GET /api/v1/instagram-studio/carousels` - Lists all workspace carousels.
* `GET /api/v1/instagram-studio/carousels/:id` - Retrieves carousel with its ordered slides.
* `PUT /api/v1/instagram-studio/carousels/:id/reorder` - Reorders slides safely with two-phase indexing (`{ orderedSlideIds: string[] }`).
* `PUT /api/v1/instagram-studio/carousels/:id/slides/:slideId` - Edits slide headline, body text, or badge (`{ headline?: string, bodyText?: string, badgeText?: string }`).
* `POST /api/v1/instagram-studio/carousels/:id/render-all` - Renders all slides on 1080x1350 Canvas with safe margins, typography, and brand watermark.
* `POST /api/v1/instagram-studio/carousels/:id/save-draft` - Saves carousel into ContentOS with `platforms: ["instagram"]`.
* `POST /api/v1/instagram-studio/carousels/:id/publish` - Publishes carousel to Instagram Business API via container publish.




## Workflow integrity additions (4 November 2026)

- Public GET /auth/google/status reports configuration availability; POST /auth/google/start requires termsAccepted:true and returns a Google authorization URL. GET /auth/google/callback consumes browser-bound PKCE/nonce state and issues the existing phase session before redirecting to the app.
- Workspace POST /ai/image-captions accepts an owned completed assetId, platform and optional prompt; returns three editable caption/hashtag options. Existing AI provider and entitlement rules apply.
- New billing purchase requests are simulated: PENDING → APPROVED or REJECTED, admin only. Legacy nonsimulated requests can become VERIFIED. Simulated approvals are excluded from financial revenue.
- Quota usage exposes postsUsedToday (successful platform publications), postsReservedToday and postsRemainingToday in the workspace timezone. Each account publication consumes one unit; retries retain identity and failed/cancelled attempts release capacity.
- Every batch mutation/retry request requires confirm:true. Existing workspace roles are rechecked.
- Admin subscription PATCH supports cancelAtPeriodEnd, expiry and custom limit edits with audit records. Subscription list includes effective status, remaining days, quota usage and publishing diagnostics.
