# ContentOS — Production Deployment Guide

## Domains & Paths

| What | Domain | cPanel Path |
|---|---|---|
| **Frontend** (React static build) | `hidustansocialnetwork.in` (main domain) | `/home/hindust1/public_html/` |
| **Backend** (Node.js API) | `api.hidustansocialnetwork.in` | `/home/hindust1/api.hidustansocialnetwork.in/` |
| **cPanel User** | — | `hindust1` |

---

## STEP 1 — Git Setup on Server (One-time)

1. cPanel → **Git Version Control** → **Create**
2. Fill in:
   - **Clone URL:** `https://github.com/YOUR_USERNAME/ContentOS-.git`
   - **Repository Path:** `/home/hindust1/api.hidustansocialnetwork.in`
   - **Repository Name:** `contentos-api`
3. Click **Create** — it will clone the repo

---

## STEP 2 — Setup Node.js App on Server (One-time)

1. cPanel → **Setup Node.js App** → **Create Application**
2. Fill in:
   - **Node.js version:** `22` (ya latest available)
   - **Application mode:** `Production`
   - **Application root:** `api.hidustansocialnetwork.in`
   - **Application URL:** `api.hidustansocialnetwork.in`
   - **Application startup file:** `app.mjs`
3. Click **Create**

---

## STEP 3 — Place .env on Server (One-time)

1. cPanel → **File Manager** → navigate to `/home/hindust1/api.hidustansocialnetwork.in/`
2. Click **+ File** → create `.env`
3. Copy content from `.env.production.example` (is repo mein hai)
4. Sabhi `YOUR_*` values apni real keys se fill karo
5. Save

> ⚠️ `.env` kabhi Git mein commit mat karo — `.gitignore` mein already add hai

---

## STEP 4 — Run Database Migrations (One-time)

cPanel → **Setup Node.js App** → **Run Script** ya Terminal use karo:

```bash
cd /home/hindust1/api.hidustansocialnetwork.in
source /home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate
node --env-file=.env dist-api/migrate.js
```

---

## STEP 5 — Deploy Backend (Every Code Update)

1. **Local machine pe** — apna code Git push karo:
   ```bash
   git add .
   git commit -m "your message"
   git push origin main
   ```

2. **cPanel pe** — Git Version Control → `contentos-api` → **Deploy HEAD Commit**

3. Deploy log mein check karo ki sab steps pass hua (`✓`)

4. cPanel → **Setup Node.js App** → **Restart** button dabao

---

## STEP 6 — Build & Deploy Frontend (Every UI Update)

**Apne local machine pe** (Windows):

```powershell
# Frontend build karo (API URL automatically api.hidustansocialnetwork.in pe set ho jaata hai)
npm run build:frontend
```

> Windows pe yeh command kaam kare iske liye `package.json` mein cross-env use karo ya manually:
> ```powershell
> $env:VITE_API_BASE="https://api.hidustansocialnetwork.in"; npx vite build
> ```

Build ke baad `dist/` folder banega. Isko upload karo:

**Option A — cPanel File Manager (Recommended):**
1. `dist/` folder ko ZIP karo locally
2. cPanel → File Manager → `/home/hindust1/public_html/`
3. Purana content select karo → Delete
4. Upload ZIP → Extract → Done

**Option B — FTP (FileZilla):**
- Host: `hidustansocialnetwork.in`
- Username: `hindust1`
- Password: cPanel password
- Remote path: `/home/hindust1/public_html/`
- `dist/` ke andar ka content upload karo (sirf files, folder nahi)

---

## STEP 7 — Setup Frontend `.htaccess` for React Router

`/home/hindust1/public_html/` mein yeh `.htaccess` file honi chahiye:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [QSA,L]
```

> Yeh file pehle se `.well-known`, `cgi-bin` ke saath dikh rahi thi — agar `.htaccess` already hai toh usmein yeh lines add karo

---

## STEP 8 — Worker Process Setup

Backend ke saath `worker.js` aur `mail-worker.js` bhi continuously chalte rehne chahiye. cPanel pe:

1. cPanel → **Cron Jobs** → Add:
   ```
   * * * * * /bin/bash -c 'pgrep -f "worker.js" || cd /home/hindust1/api.hidustansocialnetwork.in && node --env-file=.env dist-api/worker.js >> /home/hindust1/worker.log 2>&1 &'
   ```

2. Dusra cron for mail worker:
   ```
   * * * * * /bin/bash -c 'pgrep -f "mail-worker.js" || cd /home/hindust1/api.hidustansocialnetwork.in && node --env-file=.env dist-api/mail-worker.js >> /home/hindust1/mail-worker.log 2>&1 &'
   ```

---

## Daily Workflow Summary

```
Code change karo (local)
       ↓
git push origin main
       ↓
cPanel > Git > Deploy HEAD    ← Backend deploy
       ↓
Setup Node.js App > Restart   ← API restart
       ↓ (UI change bhi hai toh)
npm run build:frontend (local)
       ↓
dist/ upload karo FTP/File Manager  ← Frontend update
```

---

## File Structure on Server

```
/home/hindust1/
├── api.hidustansocialnetwork.in/    ← Git repo (backend)
│   ├── .env                          ← Manually place karo, NEVER commit
│   ├── app.mjs                       ← cPanel Node.js startup file
│   ├── dist-api/                     ← Compiled backend (tsc output)
│   ├── node_modules/
│   ├── server/                       ← TypeScript source
│   ├── uploads/                      ← User uploads (preserve always)
│   └── .cpanel.yml
│
└── public_html/                      ← Frontend static files (MAIN DOMAIN)
    ├── index.html                     ← React app entry
    ├── assets/                        ← JS/CSS bundles
    └── .htaccess                      ← React Router support
```
