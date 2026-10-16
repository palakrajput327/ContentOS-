# Repository bootstrap deployment and rollback

The Git checkout is `/home/hindust1/repositories/ContentOS-`. The production application is `/home/hindust1/api.hidustansocialnetwork.in`. These are different directories.

`.cpanel.yml` now runs the script from the checkout:

```bash
/bin/bash /home/hindust1/repositories/ContentOS-/deploy/cpanel-deploy.sh
```

It does not execute the stale script already installed in the application directory. Runtime source must be committed; the script rejects modified tracked runtime files and archives the checkout's exact HEAD. Untracked files are not deployed. The printed source commit identifies what was prepared.

## Preparation workflow

1. Validate the repository, application/frontend roots and CloudLinux Node.js 22 activation path. Reject redirected roots, unsafe managed paths and unexpected dependency links. An atomic deployment lock prevents concurrent promotion/rollback.
2. Archive only committed runtime source into a new `.deploy-stage-*` directory. Production `.env`, uploads, `.git`, dumps and existing data are not archived or modified.
3. In staging, verify the exact commit-bound prebuilt artifact and its LF lockfile, production authentication metadata and file checksums. Use `npm ci --omit=dev --ignore-scripts`, selectively rebuild `ffmpeg-static`, run `npm ls --omit=dev --depth=0` and execute the FFmpeg verifier. The committed `.npmrc` defaults to scripts disabled; only the FFmpeg rebuild explicitly enables its installer. TypeScript/Vite never run on cPanel. A failure here leaves the running application files and dependency directory unchanged.
4. Back up each managed file that will be replaced, including frontend assets, package.json and .npmrc. Record newly introduced file paths so rollback can remove those exact paths without deleting unrelated data.
5. Prepare a separate production-only dependency directory, move the previous environment dependency directory into the backup and promote the new directory. The application's `node_modules` symlink is never removed or replaced. Shared-store indirection is rejected rather than modified unsafely; this workflow expects the regular `nodevenv/.../22/lib/node_modules` directory shown in the existing setup.
6. Copy only source/build files listed in the manifest and selected generated static files into the application and public_html. Unmanaged/stale files are retained, not mirrored or deleted. Update the application's generated dist files too, because its startup serves that frontend.
7. Recheck the production dependency tree and FFmpeg from the application root. An ordinary promotion failure attempts automatic file/dependency rollback. There is no API restart marker, migration, reconciliation import, backend selection or cron change.

The script preserves `.env` and uploads. It replaces managed code, generated assets and dependencies intentionally. It retains staging and backup directories for operator inspection. Ensure adequate disk space for the staged build, prepared production dependencies and previous dependency snapshot. Dependency moves require the application backup and environment directory to share a filesystem.

## Exact cPanel steps — only after approval

These are future operator actions; none were executed during local preparation.

1. Review and commit these local changes. Push only after separate approval, including the previously identified credential/history exposure review. The production checkout cannot receive an unpushed local change.
2. In **cPanel → Git Version Control → Manage** for `/home/hindust1/repositories/ContentOS-`, choose **Update from Remote**. Confirm the desired branch and HEAD contain the corrected `.cpanel.yml` and deploy script.
3. Review the maintenance window, available disk space, CloudLinux activation path and write permissions. If approved, manually stop the API before promotion: in-place code/dependency replacement should not race live requests or dynamically imported modules. This script never stops or restarts it for you.
4. Choose **Deploy HEAD Commit** for that repository. Its deployment task invokes the latest repository script using the exact command above. Equivalent manually authorized terminal command:

```bash
/bin/bash /home/hindust1/repositories/ContentOS-/deploy/cpanel-deploy.sh
```

5. Capture the printed source commit, backup path and completion output. Successful completion means files/dependencies were prepared; it does not mean the API was restarted or that PostgreSQL mode was enabled.
6. Do not run migrations/imports or change QUEUE_BACKEND/Cron Jobs as part of this workflow. A manual API restart and health check require the operator's separate approval. Existing backend selection is preserved unchanged.

## Rollback

Use the backup path printed by the deployment, with the script from the checkout:

```bash
/bin/bash /home/hindust1/repositories/ContentOS-/deploy/cpanel-deploy.sh --rollback /home/hindust1/api.hidustansocialnetwork.in/.deploy-backup-EXACT_ID_FROM_OUTPUT
```

Replace the final path with the exact actual snapshot; do not guess an ID. Rollback restores prior managed source/build/frontend files and dependencies, removes only newly introduced managed files, preserves failed/new dependencies for diagnosis, and leaves `.env`, uploads and existing data alone. It does not restart the API or change database state. A snapshot already restored cannot be reused to roll back a different release.

If promotion fails normally, the script attempts this rollback automatically. Review output before any manual restart. SIGKILL, host termination or disk failures can prevent automatic recovery: use the recorded snapshot after confirming no deployment process remains active. An abandoned `.deploy-lock` requires manual operator inspection/removal; the script does not assume an old lock is safe to steal. Do not delete staging/backups until the intended release or rollback has been verified.

## Local verification

`node scripts/test-cpanel-deploy.mjs` tests the workflow in a temporary local Git repository using mock npm/Node commands. It verifies:

- Latest committed checkout source is used while the production script is deliberately outdated.
- Failed staged builds leave production code/dependencies unchanged.
- Source and both frontends update, preserving the CloudLinux-style symlink.
- Production/frontend `.env`, uploads and a data-file sentinel remain unchanged.
- Manual rollback restores original code, frontend and dependencies.
- Failed post-promotion verification automatically restores the snapshot.
- No restart, migration/import, worker or cron command runs.

Bash syntax and manifest checks are included. This is an orchestration/data-preservation test, not a live cPanel/Linux dependency install. The application code is unchanged from its previously passing Node 22 build and 55-test run; actual host download/executable/resource permissions remain an approved deployment prerequisite.

Changed files for this bootstrap fix: `.cpanel.yml`, `.gitignore`, `deploy/cpanel-deploy.sh`, `scripts/test-cpanel-deploy.mjs`, and this document. No local commit, push, deployment or production access was performed for this task.
