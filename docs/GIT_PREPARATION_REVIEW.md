# Local Git preparation review

Reviewed on 2026-10-14. No remote Git, GitHub or production hosting access was used.

The previously tested runtime and PostgreSQL queue implementation is already in local commit `25fd0737644e699ba653b284a667ef60a32a3e0b` (48 files). This follow-up commit preserves that complete implementation and its migration, reconciliation tools, tests and documentation.

## Sensitive material

- The current tracked-file scan found matching local credentials in `.env.example`, a hardcoded bot token in an operational helper, and a tracked Redis dump.
- The example now contains blank secret values and a clearly labelled local database placeholder. The developer guide's copied encryption-key values were replaced with placeholders.
- The Redis dump, token-update helper and scratch logs were removed from Git tracking and added to ignore rules. Their physical local files were preserved. Live `.env` and `env-cpanel-production.env` remain ignored and were not edited.
- A redacted scan of the remaining 296 tracked files found no matches to known local secret values or provider/private-key token signatures. The staged follow-up files were also reviewed. Placeholder environment examples and synthetic test credentials are intentional; no live configuration is committed.
- Older Git commits still contain the previously exposed values and dump. This commit does not rewrite history. Before any push, separately review credential rotation and history cleanup; neither was performed or authorized here.

## Deployment safeguards

- `.cpanel.yml` delegates to one Bash deployment process at `/home/hindust1/api.hidustansocialnetwork.in/deploy/cpanel-deploy.sh` so environment activation persists across all steps.
- The script targets only `/home/hindust1/api.hidustansocialnetwork.in` and generated frontend outputs under `/home/hindust1/public_html`; old `contentos` target references were removed.
- It activates `/home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate`, checks Node 22 and the managed dependency symlink, installs with scripts disabled, builds explicitly, prunes with scripts disabled, and selectively installs/verifies FFmpeg.
- Deployment backups are preserved and ignored by Git. Only generated HTML/routing/icon/JS/CSS outputs are copied; `.env`, uploads, dumps and arbitrary root files are not copy targets. A restart marker is created only with `--restart` (the operator-invoked cPanel deployment uses this flag).
- No package lifecycle hook or deployment step applies migrations, imports reconciliation data, selects QUEUE_BACKEND, launches queue workers or installs cron jobs. BullMQ remains the default. Cron/cutover approval remains separate.
- Shell files are committed with LF line endings.

## Verification

`node scripts/test-cpanel-deploy.mjs` passed: Bash syntax, mock CloudLinux Node 22 activation, dependency/build command sequence, selective FFmpeg setup, restart marker and unchanged API/frontend .env/uploads were verified using temporary local directories. The test deliberately placed unsafe `.env` and upload files in the generated dist fixture and confirmed they were not copied. No real npm installation or production path was used in this simulation.

The earlier Node 22.23.3 production build and all 55 automated queue/runtime/publishing/LLM tests passed; application code was not changed in this Git-preparation review. Linux FFmpeg execution and actual shared-host permissions/resources still require approved server verification.

No push, production deployment, migration, database mutation, backend switch or cron activation was performed.
