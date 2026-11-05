# ContentOS System Architecture (ARCHITECTURE.md)

This document provides a comprehensive blueprint of ContentOS, detailing its infrastructure, runtime layers, database topology, security design, and external integrations.

---

## 1. High-Level System Overview

```mermaid
flowchart TD
    Client["User Browser (React 19 SPA @ localhost:5173 / Production CDN)"]
    AppMjs["Node.js Supervisor (app.mjs @ port 3001)"]
    NestBackend["NestJS Core API Monolith (dist-api/phase-main.js)"]
    PostgresDB[("PostgreSQL Database (Neon Cloud / Local cPanel)")]
    MediaStorage["Storage Provider (Local /uploads or AWS S3)"]
    AIProviders["AI Providers (FLUX.1, Gemini, Groq, OpenRouter, ClipDrop, OpenAI)"]
    SocialAPIs["Social Platforms (LinkedIn, Telegram, Facebook, Instagram, X, YouTube)"]

    Client -->|HTTPS + Cookies (contentos_session) + X-Workspace-Id| AppMjs
    AppMjs --> NestBackend
    NestBackend -->|Connection Pool (ssl: auto)| PostgresDB
    NestBackend -->|Presigned URLs & Asset Streaming| MediaStorage
    NestBackend -->|Text / Image Synthesis| AIProviders
    NestBackend -->|Publish & Delete APIs| SocialAPIs
```

---

## 2. Infrastructure & Runtime Topology

### 2.1 Backend Monolith (`app.mjs` & `server/`)
* **Process Supervisor (`app.mjs`):**
  * Loads environment variables safely via `safeLoadEnv()`.
  * Patches DNS resolver with Google DNS (`8.8.8.8`) and Cloudflare DNS (`1.1.1.1`) to ensure zero `ENOTFOUND` lookups against remote cloud databases like Neon.
  * Boots the compiled NestJS application (`dist-api/phase-main.js` or `dist-api/main.js`) on port 3001.
  * In production, serves static frontend files from `dist/` with SPA history fallback.
* **NestJS Modular Architecture:**
  * Controllers map HTTP routes under the global prefix `/api/v1`.
  * Middleware and Guards (`AuthGuard`, `WorkspaceRequired`) inspect cookies and headers.
  * `TransformInterceptor` standardizes every success response into `{ data: T, requestId: uuid }`.
  * Global exception filter standardizes error responses into `{ error: { code, message }, message, requestId }`.

### 2.2 Database Layer (`server/db.ts`)
* **Driver:** `pg` (node-postgres) with connection pooling (`pool.query`).
* **Connection Routing:**
  * Automatically substitutes Neon connection strings with pooling hostnames (`-pooler.neon.tech`).
  * Dynamically detects whether the target host is local or cloud:
    * `localhost`, `127.0.0.1`: SSL is disabled (`ssl: false`) for local PostgreSQL/cPanel compatibility.
    * Remote hosts (e.g., Neon): SSL is enforced (`ssl: { rejectUnauthorized: false }`).
* **Migrations (`server/migrations/`):**
  * Sequential migrations (`001_auth.sql` through `028_visual_concept_captions.sql`).
  * Executed via `node dist-api/migrate.js`.
  * Canonical baseline snapshot maintained in `database_full_setup.sql`.

### 2.3 Storage Layer (`server/storage/`)
* **Abstraction:** `StorageProvider` interface (`getUploadUrl`, `getSignedDownloadUrl`, `deleteObject`, `putObject`).
* **Providers:**
  * `LocalStorageProvider`: Stores files on local disk under `process.env.STORAGE_LOCAL_DIR || "uploads"`. Serves media via `/api/v1/storage/file/...`.
  * `S3StorageProvider`: Streams assets to AWS S3 / Cloudflare R2 / MinIO with secure presigned upload and download URLs.

---

## 3. Security, Authentication & Multi-Tenancy

### 3.1 Authentication Pipeline
1. **Credentials & Passwords:** Passwords are encrypted using `scrypt` with cryptographic salts: `scrypt:<salt>:<hex_key>`.
2. **Session Persistence:**
   * User logs in (`POST /api/v1/auth/login`) or verifies OTP code (`POST /api/v1/auth/verify-code`).
   * An opaque cryptographically random session token is issued as an HTTP-only secure cookie `contentos_session`.
   * The backend hashes this token using SHA-256 (`access_hash`) and validates against `auth_sessions`.
   * Unauthenticated requests are rejected with `401 Unauthorized`.

### 3.2 Workspace Scoping & Permissions
* **Multi-Tenancy:** Users belong to one or more workspaces (`workspace_members`).
* **Header Requirement:** All workspace-scoped routes require the client to supply `X-Workspace-Id: <uuid>`.
* **RBAC Roles:** `Owner`, `Admin`, `Content Manager`, `Editor`, `Approver`, `Viewer`.
* **Permission Enforcement:** Enforced in controllers via `assertPermission(role, "manage" | "edit" | "schedule" | "approve")`.

### 3.3 Token Encryption
* Third-party social OAuth tokens (LinkedIn, Meta, YouTube, X, Telegram bot tokens) are stored in `social_account_tokens`.
* Tokens are encrypted at rest using **AES-256-GCM** with Additional Authenticated Data (AAD):
  * `encryptToken(plaintext, aad)` generates `iv.tag.ciphertext`.
  * `decryptToken(ciphertext, aad)` validates the authentication tag before returning the decrypted secret.

---

## 4. Background Workers & Queue Architecture

ContentOS features a durable dual-mode queue design:
1. **PostgreSQL Queue (`server/postgres-queue.ts`):** Default zero-dependency queue storing jobs directly in the PostgreSQL database with transactional locking (`SELECT FOR UPDATE SKIP LOCKED`).
2. **BullMQ / Redis (`server/queues.ts`):** Activated when `REDIS_URL` is configured, powering high-throughput asynchronous workers.
3. **Cron Runners (`server/cron-tasks.ts`):**
   * **Slot Posting Daemon:** Reconciles scheduled posts, checks publication windows, and triggers platform publishers.
   * **Festival Scheduler:** Automatically checks the comprehensive calendar of 45+ Indian festivals and pre-schedules customized greetings.
   * **Auto-Pilot Pipeline:** Periodically generates and dispatches queued visual concepts from uploaded documents.

---

## 5. AI Synthesis & Social Publishing Pipelines

### 5.1 AI Multi-Tier Engines
* **LLM Engine (`server/ai/llm.service.ts`):** Cascading provider priority: Gemini -> Groq -> OpenRouter -> OpenAI. Used for document chunk summarization, entity extraction, and caption writing.
* **Image Synthesis (`server/clipdrop/clipdrop.service.ts`):**
  * Primary: **FLUX.1 Schnell** (via Pollinations authenticated/open endpoints or HuggingFace inference router).
  * Fallbacks: HuggingFace, ClipDrop text-to-image, and OpenAI (if credits available).
* **Brand Overlay Engine (`server/documents/brand-identity.service.ts`):**
  * Built on `@napi-rs/canvas`.
  * Applies approved PDF logos, website URLs, and brand color borders onto generated artwork without requiring external graphics software.

### 5.2 Social Publishing & Deletion Layer
* Supported Networks: LinkedIn, Telegram, Facebook, Instagram, Twitter/X, YouTube.
* Publishing: Formats media, text, captions, and tags per platform specs (`server/publishing.ts`).
* Deletion (`server/posts/social-platform-delete.service.ts`): Invokes live network APIs to delete posts from user feeds and groups before cleaning up local database references.

---

## 6. Frontend Architecture (`src/`)

* **Routing (`src/App.tsx`):**
  * `/app/overview` - Analytics and performance.
  * `/app/composer` - Multi-channel content creation.
  * `/app/calendar` - Drag-and-drop posting calendar with festival badges.
  * `/app/studio` - AI Visual Studio and PDF document processing hub (`tab=pdf`).
  * `/app/library` - Post repository with multi-selection and Bulk Deletion modal.
  * `/app/channels` - Connected social channels management.
  * `/app/festivals` - Indian festival automation controls.
* **Client API Gateway (`src/lib/api.ts`):**
  * Uses browser `fetch()` with credentials (`include`).
  * Attaches `X-Workspace-Id` from local state.
  * Unwraps `{ data: T }` responses and toasts API error messages via Sonner.

