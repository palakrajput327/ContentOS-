# Current cPanel deployment workflow

Use [deploy/PREBUILT.md](deploy/PREBUILT.md) for the current deployment procedure.
The cPanel script now requires commit-matched prebuilt artifacts and installs only
production dependencies. Older instructions below describing server builds are
historical and must not be used for this deployment path.

# Hindustan Social Network — cPanel Deployment Guide

## Overview

| Item | Value |
|---|---|
| **Hosting** | cPanel shared hosting |
| **cPanel user** | `hindust1` |
| **Frontend URL** | `https://hidustansocialnetwork.in` |
| **API URL** | `https://api.hidustansocialnetwork.in` |
| **Node.js** | `v22.23.3` (cPanel alt-nodejs22) |
| **npm** | `10.9.9` |
| **Database** | Neon PostgreSQL (retain existing) |
| **App root on server** | `/home/hindust1/contentos/` |
| **cPanel startup file** | `app.mjs` |
| **cPanel startup command** | `node app.mjs` *(or use `npm start`)* |

---

## How the App Works in Production

The backend (`dist-api/phase-main.js`) **statically serves the built Vite frontend** from `dist/`. A **single Node.js process** handles both the API and the SPA. No separate static hosting is needed.

```
Browser  →  https://api.hidustansocialnetwork.in
                  ↓
          Node.js (app.mjs)
                  ↓
        ┌─────────────────────┐
        │ NestJS API  /api/v1 │
        │ Vite SPA    /*      │
        └─────────────────────┘
```

---

## First-Time Setup on cPanel

### Step 1 — Clone the Repository

In **cPanel > Git Version Control**, click **Create**:
- **Clone URL**: your GitHub repo URL
- **Repository Path**: `/home/hindust1/contentos`
- Click **Create**

### Step 2 — Create `.env`

In **cPanel > Terminal**:
```bash
cd /home/hindust1/contentos
cp deploy/.env.production.example .env
nano .env      # Fill in all REPLACE_WITH_* values
```

Key values to fill in:
- `APP_URL=https://hidustansocialnetwork.in`
- `DATABASE_URL` — your Neon connection string
- `REDIS_URL` — see Redis section below
- `ENCRYPTION_KEY` — 64 hex chars (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `MAIL_*` — Gmail SMTP / app password
- All social OAuth keys

### Step 3 — Configure Node.js App in cPanel

Go to **cPanel > Setup Node.js App** → **Create Application**:

| Setting | Value |
|---|---|
| Node.js version | `22` |
| Application mode | `Production` |
| Application root | `contentos` |
| Application URL | `api.hidustansocialnetwork.in` |
| Application startup file | `app.mjs` |

Click **Create**.

### Step 4 — Deploy the Application

In **cPanel > Terminal**:
```bash
cd /home/hindust1/contentos
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
bash deploy/cpanel-deploy.sh
```

The script will:
1. ✅ Check Node.js 22 is active
2. ✅ Verify `.env` exists
3. ✅ Back up existing `dist/` and `dist-api/`
4. ✅ Install all dependencies (including devDeps for build)
5. ✅ Run `node scripts/build.mjs` (tsc + vite)
6. ✅ Validate build outputs exist
7. ✅ Prune devDependencies
8. ✅ Ensure `uploads/` directory exists

### Step 5 — Restart the Application

In **cPanel > Setup Node.js App**, click **Restart** next to your app.

---

## Subsequent Deploys

```bash
# Pull latest changes
cd /home/hindust1/contentos
git pull origin main

# Redeploy
bash deploy/cpanel-deploy.sh
```

Then click **Restart** in cPanel > Setup Node.js App.

> **Note**: cPanel Git Version Control's **"Deploy"** button runs `.cpanel.yml` automatically. Both approaches (manual script OR .cpanel.yml Deploy button) work.

---

## `.cpanel.yml` — Automated Git Deployment

`.cpanel.yml` in the repo root is read by cPanel's Git Version Control when you click **Deploy** on the repository page. It is **NOT triggered automatically on git push** — you must click the Deploy button manually.

The file:
1. Activates Node.js 22
2. Runs `npm ci --include=dev --ignore-scripts`
3. Runs `node scripts/build.mjs`
4. Prunes devDependencies
5. Validates critical output files exist

---

## Redis Requirement

> ⚠️ **Redis is required.** It is used for:
> - BullMQ job queues (social publishing, PDF processing, AI jobs)
> - Auth rate-limiting middleware
>
> cPanel shared hosting does **not** include Redis. Options:
> 1. **Redis Cloud** free tier (https://redis.io/try-free/) — 30 MB free
> 2. **Upstash** (https://upstash.com/) — serverless Redis, pay-per-request
> 3. Ask host if Redis is available via WHM/CloudLinux

Set `REDIS_URL` in `.env` to your managed Redis connection string.

---

## BullMQ Workers — Shared Hosting Limitation

> ⚠️ **Publishing workers cannot run persistently on shared cPanel hosting.**
>
> The following workers require long-lived Node.js processes:
> - `dist-api/worker.js` — social publishing, PDF, AI, festival scheduling
> - `dist-api/mail-worker.js` — email dispatch

**What this means:**
- Content scheduling and automatic publishing will **not work** until workers are running
- Manual content operations (create, edit, view) will work normally without workers
- Email verification OTPs require `mail-worker.js` to be running

**Options to enable workers:**
1. **Verify with host** if background processes via `nohup` are allowed in Terminal
2. **Use a VPS** (DigitalOcean, Hetzner) alongside cPanel for workers only
3. **Use cPanel Cron**: Run a sweep script every minute (limited, no persistent connections)

**If host allows `nohup`:**
```bash
# Start social/pdf/ai worker
nohup node --env-file=.env dist-api/worker.js > logs/worker.log 2>&1 &
echo $! > pids/worker.pid

# Start mail worker
nohup node --env-file=.env dist-api/mail-worker.js > logs/mail-worker.log 2>&1 &
echo $! > pids/mail-worker.pid
```

---

## Rollback Procedure

If a deploy causes issues, restore the backup created by `cpanel-deploy.sh`:

```bash
cd /home/hindust1/contentos

# List available backups
ls -d .deploy-backup-*

# Restore (replace TIMESTAMP with actual backup name)
rm -rf dist dist-api
cp -r .deploy-backup-TIMESTAMP/dist .
cp -r .deploy-backup-TIMESTAMP/dist-api .
```

Then click **Restart** in cPanel > Setup Node.js App.

---

## File Safety Guarantees

| File/Directory | Protected? | How |
|---|---|---|
| `.env` | ✅ Yes | Not in Git (.gitignore), never touched by scripts |
| `uploads/` | ✅ Yes | `mkdir -p` only, never deleted |
| `dist/` | ⚠️ Replaced after backup | Full backup taken before each deploy |
| `dist-api/` | ⚠️ Replaced after backup | Full backup taken before each deploy |
| Database | ✅ Yes | Neon is external; no schema changes without explicit `npm run migrate` |

---

## Key Files Reference

| File | Purpose |
|---|---|
| `app.mjs` | cPanel startup file — DNS fallback + env load + calls backend bootstrap |
| `.cpanel.yml` | cPanel Git Deploy button automation |
| `deploy/cpanel-deploy.sh` | Manual Terminal deploy script |
| `deploy/.env.production.example` | Production `.env` template for `hidustansocialnetwork.in` |
| `scripts/build.mjs` | Full build (tsc + vite) — must be run with devDeps installed |
| `dist/` | Built Vite frontend (served statically by NestJS) |
| `dist-api/` | Compiled NestJS backend |
| `server/config.ts` | All env var definitions (Zod schema — reference for required vars) |

---

## DNS Configuration Required

Set these DNS records at your domain registrar:

| Type | Name | Value |
|---|---|---|
| `A` or `CNAME` | `@` / `hidustansocialnetwork.in` | cPanel server IP |
| `A` or `CNAME` | `api` | cPanel server IP |

The `api.hidustansocialnetwork.in` subdomain must be added as an **Addon Domain** or **Subdomain** in cPanel pointing to the Node.js app.

---

## Unresolved Deployment Blockers

> Before going live, verify these with your cPanel host:

1. **Redis availability** — Is managed Redis available, or must you use an external service?
2. **Background processes** — Does the host allow `nohup` / long-running processes from Terminal?
3. **`@napi-rs/canvas`** — This native Node.js addon requires compilation. Confirm Linux shared hosting has `gcc`/`make` available, else this `npm ci` step may fail.
4. **`tesseract.js`** — Downloads OCR training data at runtime; requires outbound network access from workers.
5. **Subdomain + Node.js App** — A subdomain (`api.`) with a separate cPanel Node.js App entry must be confirmed as supported by the host plan.
