#!/usr/bin/env bash
# =============================================================================
# ContentOS — cPanel Manual Deployment Script
# Run this in cPanel Terminal AFTER cloning the repo and setting up .env
#
# Usage:
#   bash deploy/cpanel-deploy.sh
#
# Prerequisites:
#   - Repo cloned at: /home/hindust1/contentos/
#   - .env placed at: /home/hindust1/contentos/.env
#   - Node.js 22 activated in cPanel Setup Node.js App
#   - Run this script from the repo root: /home/hindust1/contentos/
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Guard: must be run from repo root ─────────────────────────────────────────
[[ -f "package.json" && -f "app.mjs" ]] || error "Run this script from the repo root (e.g. /home/hindust1/contentos/)"

# ── Activate Node.js 22 (cPanel path) ────────────────────────────────────────
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
NODE_VER=$(node --version 2>/dev/null || echo "missing")
info "Node.js: $NODE_VER"
[[ "$NODE_VER" == v22* ]] || error "Node.js 22 required. Got: $NODE_VER. Activate it in cPanel Setup Node.js App first."

# ── Guard: .env must exist (never auto-create it) ────────────────────────────
[[ -f ".env" ]] || error ".env not found. Copy deploy/.env.production.example to .env and fill in all values."

# ── Backup existing build outputs (safe rollback) ────────────────────────────
BACKUP_DIR=".deploy-backup-$(date +%Y%m%d-%H%M%S)"
info "Creating backup at $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR"
[[ -d "dist" ]]     && cp -r dist     "$BACKUP_DIR/dist"
[[ -d "dist-api" ]] && cp -r dist-api "$BACKUP_DIR/dist-api"
info "Backup complete: $BACKUP_DIR"

# ── Install dependencies (devDeps included for build) ────────────────────────
info "Installing dependencies (including devDependencies for build) ..."
npm ci --include=dev --ignore-scripts

# ── Build ─────────────────────────────────────────────────────────────────────
info "Building backend (tsc) and frontend (vite) ..."
node scripts/build.mjs

# ── Validate build outputs ────────────────────────────────────────────────────
info "Validating build outputs ..."
[[ -f "dist-api/phase-main.js" ]] || error "Build failed: dist-api/phase-main.js not found. Rolling back would restore $BACKUP_DIR."
[[ -f "dist/index.html" ]]        || error "Build failed: dist/index.html not found. Rolling back would restore $BACKUP_DIR."
info "✓ dist-api/phase-main.js exists"
info "✓ dist/index.html exists"

# ── Prune devDependencies ─────────────────────────────────────────────────────
info "Pruning devDependencies from node_modules ..."
npm prune --omit=dev

# ── Ensure uploads/ directory exists (never delete it) ───────────────────────
mkdir -p uploads
info "✓ uploads/ directory preserved"

# ── Final instructions ────────────────────────────────────────────────────────
echo ""
info "============================================================"
info " DEPLOY COMPLETE"
info "============================================================"
info " Next steps:"
info "   1. Go to cPanel > Setup Node.js App"
info "   2. Confirm: Application root = contentos/"
info "   3. Confirm: Application startup file = app.mjs"
info "   4. Confirm: Application URL = api.hidustansocialnetwork.in"
info "   5. Click 'Restart' in Setup Node.js App"
info ""
warn " If something is wrong, restore the backup with:"
warn "   rm -rf dist dist-api && cp -r $BACKUP_DIR/dist . && cp -r $BACKUP_DIR/dist-api ."
info "============================================================"

# ── Cleanup old backups (keep last 3) ────────────────────────────────────────
BACKUP_COUNT=$(ls -d .deploy-backup-* 2>/dev/null | wc -l)
if [[ "$BACKUP_COUNT" -gt 3 ]]; then
  warn "More than 3 deploy backups found. Clean old ones with: ls -d .deploy-backup-*"
fi
