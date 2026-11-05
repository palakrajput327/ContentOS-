# ContentOS Agent Guidelines (AGENTS.md)

Welcome to **ContentOS**. This file defines mandatory engineering and coding rules for all AI agents and developers working on this repository.

> **Crucial Rule:** Always inspect actual codebase implementation before modifying or assuming behavior. Do not rely on unverified assumptions.

---

## 1. Core Architecture & Stack
* **Runtime:** Node.js (v20+ / v22+) with native ES Modules (`"type": "module"`).
* **Backend:** Express + NestJS Core (`@nestjs/core`, `@nestjs/platform-express`) modular TypeScript monolith compiled to `dist-api/` via `npm run build:api`.
* **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query v5, React Router v7, Radix UI Dialog primitives.
* **Database:** PostgreSQL (Cloud Neon with connection pooling or local cPanel PostgreSQL).
* **Queue:** Dual-engine architecture: PostgreSQL durable queue (`server/postgres-queue.ts`) with optional Redis/BullMQ.

For complete architectural details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 2. Mandatory Coding & Engineering Rules

### 2.1 Database & Migrations
1. **Never alter existing applied migrations.** Always add a new numbered migration file in `server/migrations/` (e.g., `029_your_migration.sql`).
2. **Keep Unified Schema Updated:** When adding a migration, also update `database_full_setup.sql`.
3. **Database SSL Rules (`server/db.ts`):**
   * Cloud databases (`*.neon.tech`) use connection pooler (`-pooler`) and require SSL (`ssl: { rejectUnauthorized: false }`).
   * Local databases (`localhost`, `127.0.0.1`, cPanel) **do not support SSL**. Never force SSL when connecting to localhost.
4. **Session Queries:** In `phase-main.ts`, active sessions reside in `auth_sessions` using `access_hash = hash(req.cookies.contentos_session)`. In `security.ts`, basic sessions use `sessions`. Always check which auth phase is running.

### 2.2 API Response Envelope & Error Handling
1. **Response Envelope:** The NestJS `TransformInterceptor` wraps controller returns in `{ data: <result>, requestId: <uuid> }`.
2. **Frontend Requests:** The frontend client (`src/lib/api.ts` `request()`) automatically unwraps `response.data`. Controllers must return the payload directly, not pre-wrapped in `{ data: ... }`.
3. **Error Handling:** Throw standard NestJS exceptions (`BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`).

### 2.3 Authentication & Authorization
1. **Session Cookie:** Authenticated requests pass cookie `contentos_session`.
2. **Workspace Scoping:** All workspace-scoped routes must use `@WorkspaceRequired()` decorator. Frontend sends header `X-Workspace-Id: <uuid>`.
3. **Role-Based Access Control:** Protect mutating endpoints using `assertPermission(r.workspace.role, "edit" | "schedule" | "manage" | "approve")`.

### 2.4 Social Platform Integrity & Bulk Actions
1. **External Platform Deletions:** When deleting published posts, call live external APIs (`SocialPlatformDeleteService`) where supported (Telegram, LinkedIn, Facebook, Instagram, Twitter/X, YouTube).
2. **Safety Rule:** If platform deletion fails or returns an API error, **never delete the local database record**. Record the failure log, preserve local records, and report the error.
3. **Confirmation Requirement:** Bulk operations must require explicit confirmation (`confirm: true`).

### 2.5 AI & Image Generation Engines
1. **Image Provider:** Primary image synthesis uses **FLUX.1** (fast SOTA diffusion via Pollinations / HuggingFace). Secondary fallbacks: HuggingFace, ClipDrop, and OpenAI (if quota available).
2. **Brand Overlay:** Programmatic brand compositing (logo, domain watermark, brand colors) is executed through `BrandIdentityService` (`@napi-rs/canvas`). Never draw hardcoded URLs inside raw AI diffusion prompts.

---

## 3. Essential Commands & Verification

| Action | Command |
|---|---|
| Compile Backend | `npm run build:api` (or `tsc -p server/tsconfig.json`) |
| Build Entire App | `npm run build` (compiles backend + Vite production bundle) |
| Typecheck Frontend | `npx tsc --noEmit` |
| Start Local Backend API | `node app.mjs` (runs on `http://localhost:3001`) |
| Start Local Frontend Dev | `npm run dev` (runs on `http://localhost:5173`) |
| Run Test Suite | `node --test tests/auth.test.ts tests/subscription.test.ts tests/bulk-deletion.test.ts` |
| Repack cPanel Packages | `node scripts/repack_ssl.mjs; node scripts/repack_frontend.mjs` |

---

## 4. Documentation Index
* **System Architecture & Data Flows:** [ARCHITECTURE.md](./ARCHITECTURE.md)
* **Feature Registry & Connections:** [FEATURE_REGISTRY.md](./FEATURE_REGISTRY.md)
* **API Endpoints & Contracts:** [API_CONTRACTS.md](./API_CONTRACTS.md)
* **End-to-End User Journeys:** [docs/workflows/](./docs/workflows/)
  * [PDF to Social Pipeline](./docs/workflows/pdf-to-social-pipeline.md)
  * [Bulk Post Deletion](./docs/workflows/bulk-post-deletion.md)
  * [Multi-Platform Publishing](./docs/workflows/multi-platform-publishing.md)
  * [Festival Automation](./docs/workflows/festival-automation.md)
* **Integration Tests:** [tests/](./tests/)

