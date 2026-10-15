#!/usr/bin/env bash
# Runs from the Git checkout, never from an old production copy.
# No restart, migrations, queue cutover or cron activation.
set -euo pipefail
REPO_TARGET=/home/hindust1/repositories/ContentOS-
APP_TARGET=/home/hindust1/api.hidustansocialnetwork.in
FRONTEND_TARGET=/home/hindust1/public_html
ACTIVATE=/home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate
error() { echo "[DEPLOY ERROR] $*" >&2; exit 1; }
[[ -d "$APP_TARGET" && -d "$FRONTEND_TARGET" ]] || error "Application/frontend roots are missing."
[[ $(cd "$APP_TARGET" && pwd -P) == "$APP_TARGET" ]] || error "Application root is redirected."
[[ $(cd "$FRONTEND_TARGET" && pwd -P) == "$FRONTEND_TARGET" ]] || error "Frontend root is redirected."
[[ -f "$APP_TARGET/.env" ]] || error "Existing production .env is required and will be preserved."
[[ -f "$ACTIVATE" ]] || error "CloudLinux Node 22 environment is missing."
set +u
source "$ACTIVATE"
set -u
[[ $(node --version) == v22.* ]] || error "CloudLinux Node.js 22 is required."
MODULE_TARGET="${ACTIVATE%/bin/activate}/lib/node_modules"
[[ -L "$APP_TARGET/node_modules" && -d "$MODULE_TARGET" && ! -L "$MODULE_TARGET" ]] || error "Expected managed dependency directory/symlink is missing or uses an unsupported shared store."
[[ $(readlink -f "$APP_TARGET/node_modules") == $(readlink -f "$MODULE_TARGET") ]] || error "Unexpected dependency symlink target."
LOCK_DIR="$APP_TARGET/.deploy-lock"
mkdir "$LOCK_DIR" 2>/dev/null || error "Another deployment/rollback is active, or a stale deployment lock needs operator review."
printf '%s\n' "$$" > "$LOCK_DIR/owner-pid"
trap 'rm -f "$LOCK_DIR/owner-pid"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Reject traversal and symlinked managed destinations before touching them.
check_path() {
  local root=$1 relative=$2 current=$1 component
  [[ "$relative" != /* && "$relative" != *..* && "$relative" != *$'\n'* ]] || error "Unsafe managed path."
  case "$relative" in .env*|*/.env*|uploads|uploads/*|*/uploads/*|node_modules*|*/node_modules/*|.git|.git/*|.runtime/*|*.rdb|*.dump|*.sqlite*) error "Protected destination is not deployable.";; esac
  IFS=/ read -r -a parts <<< "$relative"
  for component in "${parts[@]}"; do
    current="$current/$component"
    [[ ! -L "$current" ]] || error "Managed destination is a symlink: $relative"
  done
  [[ ! -d "$root/$relative" ]] || error "Managed file destination is a directory: $relative"
}
rollback() {
  local backup=$1 relative
  [[ $(dirname "$backup") == "$APP_TARGET" && $(basename "$backup") == .deploy-backup-* && ! -L "$backup" ]] || error "Invalid rollback directory."
  [[ -f "$backup/snapshot-ready" ]] || error "Rollback snapshot is incomplete."
  [[ ! -f "$backup/rollback-complete" ]] || error "This snapshot was already restored; use the backup for the current release."
  while IFS= read -r relative; do
    check_path "$APP_TARGET" "$relative"
    mkdir -p "$(dirname "$APP_TARGET/$relative")"
    if [[ -f "$backup/backend/$relative" ]]; then
      cp -p "$backup/backend/$relative" "$APP_TARGET/$relative" || return 1
    else
      rm -f -- "$APP_TARGET/$relative" || return 1
    fi
  done < "$backup/backend-files"
  while IFS= read -r relative; do
    check_path "$FRONTEND_TARGET" "$relative"
    if [[ -f "$backup/frontend/$relative" ]]; then
      cp -p "$backup/frontend/$relative" "$FRONTEND_TARGET/$relative" || return 1
    else
      rm -f -- "$FRONTEND_TARGET/$relative" || return 1
    fi
  done < "$backup/frontend-files"
  if [[ -d "$backup/node_modules" ]]; then
    # Retain failed/new dependencies too; do not recursively delete them.
    if [[ -d "$MODULE_TARGET" ]]; then mv "$MODULE_TARGET" "$backup/failed-node_modules-$(date +%s)-$$" || return 1; fi
    mv "$backup/node_modules" "$MODULE_TARGET" || return 1
  fi
  touch "$backup/rollback-complete"
  echo "[DEPLOY] Snapshot restored. No restart or database change performed."
}
if [[ $# == 2 && "$1" == --rollback ]]; then
  rollback "$2"
  exit 0
elif [[ $# != 0 ]]; then
  error "Usage: bash deploy/cpanel-deploy.sh [--rollback /absolute/backup/path]"
fi

SOURCE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ "$SOURCE_ROOT" == "$REPO_TARGET" && "$SOURCE_ROOT" != "$APP_TARGET" ]] || error "Invoke the latest script in the configured Git checkout."
git -C "$SOURCE_ROOT" rev-parse --is-inside-work-tree >/dev/null
CODE_PATHS=(app.mjs package.json package-lock.json tsconfig.json vite.config.ts index.html server src public scripts deploy)
git -C "$SOURCE_ROOT" diff --quiet HEAD -- "${CODE_PATHS[@]}" || error "Commit runtime changes before deploying."
REVISION=$(git -C "$SOURCE_ROOT" rev-parse HEAD)
ID="$(date +%Y%m%d-%H%M%S)-$$"
STAGE="$APP_TARGET/.deploy-stage-$ID"
BACKUP="$APP_TARGET/.deploy-backup-$ID"
mkdir -p "$STAGE" "$BACKUP"
printf '%s\n' "$REVISION" > "$BACKUP/source-commit"
# Snapshot only committed runtime source, never .env, uploads, .git or data files.
git -C "$SOURCE_ROOT" archive "$REVISION" -- "${CODE_PATHS[@]}" | tar -x -C "$STAGE"
cd "$STAGE"
cp -a "$SOURCE_ROOT/.deploy-artifact" "$STAGE/.deploy-artifact"
node scripts/deployment-artifact.mjs verify "$STAGE/.deploy-artifact" "$REVISION"
mv "$STAGE/.deploy-artifact/dist" "$STAGE/.deploy-artifact/dist-api" "$STAGE/"
[[ -f dist-api/phase-main.js && -f dist-api/cron-worker.js && -f dist/index.html ]] || error "Required build outputs are missing."
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --maxsockets=2
npm rebuild ffmpeg-static --ignore-scripts=false
npm ls --omit=dev --depth=0
node scripts/verify-ffmpeg.mjs

# Build a precise replacement manifest; do not mirror/delete whole directories.
: > "$BACKUP/backend-files"
for file in app.mjs package.json package-lock.json tsconfig.json vite.config.ts index.html; do
  printf '%s\n' "$file" >> "$BACKUP/backend-files"
done
for directory in server src public scripts deploy dist-api; do
  find "$directory" -type f ! -name '.env*' | LC_ALL=C sort >> "$BACKUP/backend-files"
done
: > "$BACKUP/frontend-files"
for file in index.html favicon.svg .htaccess; do
  if [[ -f "dist/$file" ]]; then printf '%s\n' "$file" >> "$BACKUP/frontend-files"; fi
done
if [[ -d dist/assets ]]; then
  for file in dist/assets/*; do
    [[ -f "$file" && ! -L "$file" ]] || continue
    name=${file##*/}
    [[ "$name" =~ ^[A-Za-z0-9_-]+\.(js|css)$ ]] || continue
    printf 'assets/%s\n' "$name" >> "$BACKUP/frontend-files"
  done
fi
while IFS= read -r file; do printf 'dist/%s\n' "$file" >> "$BACKUP/backend-files"; done < "$BACKUP/frontend-files"
while IFS= read -r file; do
  case "$file" in */.env*|*.rdb|*.dump|*.sqlite*|*/uploads/*|*/node_modules/*) error "Protected file appeared in source manifest.";; esac
  check_path "$APP_TARGET" "$file"
  if [[ -f "$APP_TARGET/$file" ]]; then mkdir -p "$(dirname "$BACKUP/backend/$file")"; cp -p "$APP_TARGET/$file" "$BACKUP/backend/$file"; fi
done < "$BACKUP/backend-files"
while IFS= read -r file; do
  check_path "$FRONTEND_TARGET" "$file"
  if [[ -f "$FRONTEND_TARGET/$file" ]]; then mkdir -p "$(dirname "$BACKUP/frontend/$file")"; cp -p "$FRONTEND_TARGET/$file" "$BACKUP/frontend/$file"; fi
done < "$BACKUP/frontend-files"
# Prepare new dependencies separately; preserve the selector-owned app symlink.
NEXT_MODULES="${MODULE_TARGET%/*}/node_modules.deploy-$ID"
cp -a node_modules "$NEXT_MODULES"
[[ $(stat -c %d "$MODULE_TARGET") == $(stat -c %d "$BACKUP") ]] || error "Dependency backup requires the same filesystem."
touch "$BACKUP/snapshot-ready"
PROMOTING=false
on_failure() {
  local status=$?
  trap - ERR INT TERM
  if $PROMOTING; then
    echo "[DEPLOY] Promotion failed; restoring the file snapshot." >&2
    rollback "$BACKUP" || echo "[DEPLOY ERROR] Manual rollback required: $BACKUP" >&2
  fi
  exit "$status"
}
trap on_failure ERR
trap 'false' INT TERM
PROMOTING=true
mv "$MODULE_TARGET" "$BACKUP/node_modules"
mv "$NEXT_MODULES" "$MODULE_TARGET"
while IFS= read -r file; do
  mkdir -p "$(dirname "$APP_TARGET/$file")"
  cp -p "$STAGE/$file" "$APP_TARGET/$file"
done < "$BACKUP/backend-files"
while IFS= read -r file; do
  mkdir -p "$(dirname "$FRONTEND_TARGET/$file")"
  cp -p "$STAGE/dist/$file" "$FRONTEND_TARGET/$file"
done < "$BACKUP/frontend-files"
cd "$APP_TARGET"
[[ -L node_modules && $(readlink -f node_modules) == $(readlink -f "$MODULE_TARGET") ]]
npm ls --omit=dev --depth=0
node scripts/verify-ffmpeg.mjs
PROMOTING=false
trap - ERR INT TERM
touch "$BACKUP/deployment-complete"
echo "[DEPLOY] Prepared source commit: $REVISION"
echo "[DEPLOY] Backup: $BACKUP"
echo "[DEPLOY] Rollback: /bin/bash $REPO_TARGET/deploy/cpanel-deploy.sh --rollback $BACKUP"
echo "[DEPLOY] API NOT restarted. .env, uploads and existing data preserved. No queue cutover or cron changes."
