#!/usr/bin/env bash
# Operator-invoked deployment only; never run by npm lifecycle hooks.
# Usage: bash deploy/cpanel-deploy.sh [--restart]
# Production .env, uploads and application data are preserved.
set -euo pipefail

APP_TARGET=/home/hindust1/api.hidustansocialnetwork.in
FRONTEND_TARGET=/home/hindust1/public_html
ACTIVATE=/home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate
RESTART=false
if [[ "${1:-}" == --restart && $# == 1 ]]; then
  RESTART=true
elif [[ $# != 0 ]]; then
  echo "Usage: bash deploy/cpanel-deploy.sh [--restart]" >&2
  exit 1
fi
error() { echo "[DEPLOY ERROR] $*" >&2; exit 1; }
[[ -d "$APP_TARGET" && -d "$FRONTEND_TARGET" ]] || error "Expected production application/frontend directories are missing."
[[ $(cd "$FRONTEND_TARGET" && pwd -P) == "$FRONTEND_TARGET" ]] || error "Frontend root must not redirect through a symlink."
cd "$APP_TARGET"
[[ "$(pwd -P)" == "$APP_TARGET" ]] || error "Application root must resolve to $APP_TARGET."
[[ -f package.json && -f app.mjs && -f .env ]] || error "Application files and existing .env are required."
[[ -f "$ACTIVATE" ]] || error "Create the CloudLinux Node.js 22 application first."
# CloudLinux activation may reference unset shell variables.
set +u
source "$ACTIVATE"
set -u
[[ $(node --version) == v22.* ]] || error "CloudLinux Node.js 22 is required."
[[ -L node_modules ]] || error "CloudLinux node_modules symlink is missing."
EXPECTED_MODULES="${ACTIVATE%/bin/activate}/lib/node_modules"
[[ $(readlink -f node_modules) == $(readlink -f "$EXPECTED_MODULES") ]] || error "Unexpected node_modules symlink target."

BACKUP_DIR=".deploy-backup-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP_DIR"
for directory in dist dist-api; do
  if [[ -d "$directory" ]]; then cp -a "$directory" "$BACKUP_DIR/$directory"; fi
 done
# Back up only frontend files this script intentionally replaces.
for file in index.html favicon.svg .htaccess; do
  if [[ -f "$FRONTEND_TARGET/$file" ]]; then cp -a "$FRONTEND_TARGET/$file" "$BACKUP_DIR/frontend-$file"; fi
 done

npm install --include=dev --ignore-scripts --no-audit --no-fund
[[ -L node_modules ]] || error "Install replaced CloudLinux's dependency symlink."
node scripts/build.mjs
[[ -f dist-api/phase-main.js && -f dist-api/cron-worker.js && -f dist/index.html ]] || error "Required build outputs are missing."
npm prune --omit=dev --ignore-scripts
[[ -L node_modules ]] || error "Prune replaced CloudLinux's dependency symlink."
npm rebuild ffmpeg-static --ignore-scripts=false
node scripts/verify-ffmpeg.mjs

# Copy only generated frontend outputs; never recursively copy all of dist.
# .env, uploads, database files and custom root content are not copy targets.
for file in index.html favicon.svg .htaccess; do
  if [[ -f "dist/$file" && ! -L "dist/$file" ]]; then
    [[ ! -L "$FRONTEND_TARGET/$file" ]] || error "Frontend output target is a symlink: $file"
    cp "dist/$file" "$FRONTEND_TARGET/$file"
  fi
 done
[[ ! -L "$FRONTEND_TARGET/assets" ]] || error "Frontend assets directory must not be a symlink."
mkdir -p "$FRONTEND_TARGET/assets"
if [[ -d dist/assets && ! -L dist/assets ]]; then
  for file in dist/assets/*; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    name=${file##*/}
    [[ "$name" =~ ^[A-Za-z0-9_-]+\.(js|css)$ ]] || continue
    [[ ! -L "$FRONTEND_TARGET/assets/$name" ]] || error "Frontend asset target is a symlink: $name"
    if [[ -f "$FRONTEND_TARGET/assets/$name" ]]; then
      cp -a "$FRONTEND_TARGET/assets/$name" "$BACKUP_DIR/frontend-$name"
    fi
    cp "$file" "$FRONTEND_TARGET/assets/$name"
  done
fi
# No migrations, reconciliation, QUEUE_BACKEND changes or worker/cron startup.
if $RESTART; then
  mkdir -p tmp
  touch tmp/restart.txt
fi
echo "[DEPLOY] Build/dependencies/static assets verified. Backup: $APP_TARGET/$BACKUP_DIR"
echo "[DEPLOY] .env, uploads and application data preserved. Queue cutover requires separate approval."
