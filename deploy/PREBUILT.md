# cPanel prebuilt deployment

cPanel no longer runs TypeScript or Vite. It requires `.deploy-artifact/` in
`/home/hindust1/repositories/ContentOS-` and rejects missing or mismatched releases.
Artifacts contain only build outputs and a checksum manifest, never dependencies or secrets.
Checksums detect corruption; upload artifacts only from a trusted build machine.

## cPanel Run NPM Install: confirmed stale manifest

The inspected production app-folder scripts still contained
`"postinstall": "npm run build:api"`. That hook makes the npm install button run
`tsc`, which is deliberately unavailable in a production-only dependency install.
The repository already removed this hook in commit `25fd073`; updating the Git
checkout does not update `/home/hindust1/api.hidustansocialnetwork.in/package.json`.
This is a stale deployed manifest, not a requirement to install TypeScript.

The project `.npmrc` now defaults to `ignore-scripts=true`. Deployment stages this
committed file and includes it in managed-file snapshots and rollback. Install
hooks are prohibited by a regression test. Explicit CI build commands still run;
`npm rebuild ffmpeg-static --ignore-scripts=false` remains the selective installer
exception, followed by dependency-tree and executable validation. GitHub Actions
uses the same existing build/authentication/integrity/rollback checks plus this
new offline npm-policy regression. Never enable all install scripts as a workaround.

Exact operator steps, **only after separate publication/deployment approval**:

1. Stop retrying **Run NPM Install** against the stale app folder. Do not select
   `build`, `build:api`, `build:backend`, `build:frontend` or build-containing test
   scripts under **Run JS Script**. That button explicitly executes a script and
   is not blocked by npm's `ignore-scripts` policy.
2. Verify Setup Node.js App targets `api.hidustansocialnetwork.in` under this
   account, uses Node.js 22 / Production mode, and startup file `app.mjs`. Do not
   change/save/restart these settings as part of this local fix. A different root
   requires investigation before proceeding. Do not change environment/database
   settings or queue configuration.
3. After an approved commit/push, download its successful Actions artifact. In
   Git Version Control choose the configured ContentOS- repo -> **Update from
   Remote**; confirm the exact artifact SHA. The application root is separate.
4. After hosting-write approval, deliver and verify the matching archive as below.
   Review any existing application `.npmrc` before adopting the managed policy
   so registry/authentication settings are not accidentally discarded. Its prior
   contents are backed up by deployment and restored by rollback.
5. After deployment approval, use **Deploy HEAD Commit** once. The existing script
   installs production dependencies in staging with scripts disabled, selectively
   installs FFmpeg, verifies dependencies/binaries and promotes with rollback.
   Do not perform a second UI npm installation: it bypasses deployment snapshots
   and may mutate the active managed dependencies directly.
6. Before any separately approved restart, verify read-only from cPanel Terminal:

   ```bash
   cd /home/hindust1/api.hidustansocialnetwork.in
   # Activate the exact Node.js 22 environment shown by cPanel first.
   node --version
   node -e 'const p=require("./package.json"); for(const k of ["preinstall","install","postinstall","prepublish","preprepare","prepare","postprepare"]) if(p.scripts?.[k]) throw Error("Unexpected install hook: "+k); console.log("No application install-time hooks");'
   npm config get ignore-scripts
   npm ls --omit=dev --depth=0
   node scripts/verify-ffmpeg.mjs
   ```

   Expected: Node 22, no application install hooks, `true`, valid production
   dependencies and a successful FFmpeg version check. If results differ, stop;
   do not add build tools, run migrations or restart. Nothing here activates queues.

The local patch does not remove the existing production postinstall until an
approved release replaces that deployed package.json. The live error is not
resolved merely by changing this Git checkout or rerunning the install button.

## GitHub Actions builds (preferred)

`.github/workflows/release-artifact.yml` builds automatically on pushes to `main`
and supports manual **Actions -> ContentOS release artifact -> Run workflow**.
It uses an Ubuntu 24.04 runner, a clean LF checkout of the exact event SHA and
Node.js 22.23.3, matching the locally tested runtime. Official actions are pinned
to commit SHAs. The workflow has read-only repository permissions, persists no
checkout credentials and requires no cPanel credentials or production secrets.

Each run installs locked build dependencies without lifecycle scripts, runs
`npm run test:deploy` (including authentication and rollback tests), runs the
existing strict `build:deploy`, and verifies the resulting manifest, exact SHA,
committed LF lockfile and all file checksums. It creates a tar archive, checks its
SHA-256, extracts it into a separate temporary directory and verifies it again.
Only a successful run publishes a downloadable Actions artifact, retained for
30 days (subject to repository policy). No upload-to-hosting, deployment,
service restart, migration, queue cutover or cron activation occurs.

After an approved push, open a successful run and download
`contentos-<FULL_SHA>-<RUN_ID>-<ATTEMPT>` from **Artifacts** or the run summary link.
Private repository downloads require an authorized signed-in GitHub account.
The downloaded ZIP contains:

- `contentos-<FULL_SHA>.tar.gz` — the complete `.deploy-artifact` directory,
  including hidden files such as `dist/.htaccess`;
- `SHA256SUMS` — checksum of the inner tar archive;
- `manifest.json` — a review copy of the manifest also inside the archive.

Unzip the GitHub download locally; verify the **inner tar archive**, then extract
to a new directory and verify against the matching source checkout:

```bash
# Run in the unzipped download directory.
RELEASE_SHA='<FULL_SHA>'
sha256sum -c SHA256SUMS
mkdir extracted
tar -xzf "contentos-$RELEASE_SHA.tar.gz" -C extracted
# Run with the exact SHA's clean LF source checkout and Node.js 22.
node /absolute/path/to/checkout/scripts/deployment-artifact.mjs verify \
  "$PWD/extracted/.deploy-artifact" "$RELEASE_SHA"
```

Compare the full SHA and archive checksum with the successful run summary.
The GitHub artifact digest describes the outer download; it is different from
the tar checksum in SHA256SUMS. Never substitute a newer cPanel HEAD for the
artifact's exact SHA. Deliver the inner tar archive to cPanel only after approval
and continue with steps 3–5 below. Git pull alone does not fetch this artifact.

The first hosted run remains pending until these workflow changes are approved,
committed and pushed, and Actions are enabled for the private repository. Account
Actions quotas, retention limits and allowed-action policies still apply.

## Local release builds and manual deployment

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
