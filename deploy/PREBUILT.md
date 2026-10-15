# cPanel prebuilt deployment

cPanel no longer runs TypeScript or Vite. It requires `.deploy-artifact/` in
`/home/hindust1/repositories/ContentOS-` and rejects missing or mismatched releases.
Artifacts contain only build outputs and a checksum manifest, never dependencies or secrets.
Checksums detect corruption; upload artifacts only from a trusted build machine.

1. Use Node.js 22. Only after explicit commit approval, commit the reviewed
   deployment changes. Never include unrelated staged scratch files.
2. Create the official release in a **fresh LF checkout** of that exact commit.
   The committed `.gitattributes` forces `package-lock.json` to LF. Also disable
   automatic CRLF checkout conversion for the release clone. Do not copy local
   `.env`, `node_modules` or old outputs into the clone.

   Future PowerShell commands (after commit approval; run from the source repo):

   ```powershell
   $sourceRepo = (Get-Location).Path
   $releaseSha = (git rev-parse HEAD).Trim()
   $releaseDir = Join-Path $sourceRepo "tmp/release-$releaseSha"
   if (Test-Path $releaseDir) { throw 'Use a fresh release directory' }
   git -c core.autocrlf=false clone --no-local --no-hardlinks . $releaseDir
   if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
   git -C $releaseDir config core.autocrlf false
   git -C $releaseDir checkout --detach $releaseSha
   if ($LASTEXITCODE -ne 0) { throw 'Wrong release revision' }
   Set-Location $releaseDir
   if ((node --version) -notmatch '^v22\.') { throw 'Node.js 22 required' }
   npm ci --include=dev --ignore-scripts --no-audit --no-fund
   if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
   npm run test:deploy
   if ($LASTEXITCODE -ne 0) { throw 'Release regression tests failed' }
   npm run build:deploy
   if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
   node scripts/deployment-artifact.mjs verify .deploy-artifact $releaseSha
   if ($LASTEXITCODE -ne 0) { throw 'Artifact verification failed' }
   ```

   `build:deploy` requires clean committed source, compares the working lockfile
   byte-for-byte with `git show <SHA>:package-lock.json` before and after the build,
   and refuses CRLF or altered lockfiles. No checksum normalization is performed.
   The exact committed LF bytes are hashed with SHA-256. cPanel verifies the same
   bytes from its pinned `git archive`; it never uses an alternate/fallback hash.

   The build forces `VITE_API_ENABLED=true` and
   `VITE_API_BASE=https://api.hidustansocialnetwork.in`, overriding caller values.
   A Vite release guard verifies resolved settings and the actual transformed
   authentication flag, and fails if authentication is disabled or unverified.
   Manifest version 2 records `apiEnabled: true`; older/mismatched manifests fail.
   `npm run test:deploy` includes actual frontend-generation regression checks,
   lockfile/SHA/checksum validation and deployment/rollback fixtures.
3. After approval to publish, push that exact commit and update the cPanel checkout.
   Deliver `.deploy-artifact` as a binary tar archive over authenticated SFTP/SCP
   or File Manager; retain and verify the archive SHA-256 before extraction.
   This is separate from GitHub: cPanel's Git pull does not fetch ignored artifacts.
   Extract into a new incoming directory, verify with the repository's helper and
   exact HEAD SHA, then replace the old artifact directory completely; do not merge
   releases. Avoid parallel uploads, checkout updates or deployments.
4. Invoke cPanel Git deployment manually. The script verifies commit, lockfile,
   inventory and hashes before installing production dependencies. It still checks
   the managed dependency symlink, FFmpeg and dependency tree, snapshots managed
   files/dependencies, and automatically rolls back promotion failures.
5. Review the printed backup path. Restart the Node application separately only
   when ready, then check API health and frontend loading. No restart, migration,
   queue cutover or cron activation happens in this script.

Manual rollback: use the exact command printed by deployment. Keep the backup
until the application has been verified. Production dependency installation and
FFmpeg download still need hosting resources/network access; build offloading
does not eliminate those requirements.

Do not use older documentation that instructs you to compile on cPanel for this
deployment path. Never upload local `node_modules` from Windows to Linux.
