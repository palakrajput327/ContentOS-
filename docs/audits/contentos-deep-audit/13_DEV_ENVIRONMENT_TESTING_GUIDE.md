# Audit Report 13: Local Development, Environment & System Verification Manual

**Target Repository:** ContentOS (`d:\smm-panel-5`)  
**Audit Date:** October 9, 2026  
**Auditor:** QA Automation Lead & DevSecOps Engineer  
**Status:** COMPLETE (Standardized execution procedures)

---

## 1. Executive Summary

This manual provides explicit instructions for initializing, starting, testing, and verifying the complete local development environment of ContentOS (`d:\smm-panel-5`), including frontend React Vite SPA, NestJS API server, BullMQ workers, PostgreSQL database, and Redis.

---

## 2. Environment Setup & Execution Commands

### Prerequisites
- Node.js `v20.x` or higher
- npm `v10.x` or higher
- Running PostgreSQL database (or Neon cloud instance configured in `.env`)
- Running Redis server (`redis://127.0.0.1:6379`)

### 1. Environment Configuration (`.env`)
Ensure `.env` exists in `d:\smm-panel-5` containing valid connection strings:
```env
APP_ENV=development
PORT=3001
DATABASE_URL=postgresql://neondb_owner:...@ep-odd-wind-b309rvnv.c-4.ap-southeast-1.aws.neon.tech/smm-panel?sslmode=require
REDIS_URL=redis://127.0.0.1:6379
ENCRYPTION_KEY=REPLACE_WITH_NEW_LOCAL_TEST_KEY
TOKEN_ENCRYPTION_KEY=REPLACE_WITH_SAME_LOCAL_TEST_KEY
```

### 2. Launching Services

| Service Component | Command Line | Host Endpoint |
| :--- | :--- | :--- |
| **Frontend UI (Vite)** | `npm run dev` | `http://localhost:5173` |
| **Backend API (NestJS)** | `npm run dev:server` | `http://localhost:3001/api/v1` |
| **Social & Outbox Worker** | `npx tsx server/worker.ts` | Background Service |
| **PDF Intelligence Worker** | `npx tsx server/pdf-worker.ts` | Background Service |
| **Email Dispatch Worker** | `npx tsx server/mail-worker.ts` | Background Service |

---

## 3. Verification & Diagnostic Commands

```bash
# 1. Verify TypeScript Static Compilation
npx tsc --noEmit

# 2. Verify Frontend Production Build
npm run build

# 3. Verify Health Diagnostic API
curl http://localhost:3001/api/v1/health

# 4. Verify System Readiness Diagnostic
curl http://localhost:3001/api/v1/health/ready
```
