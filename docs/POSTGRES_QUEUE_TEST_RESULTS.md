# Local validation results

Date: 2026-10-14. Node.js: 22.23.3. Isolated PostgreSQL: 17.10 (embedded runtime). Production PostgreSQL 18.6 was not contacted.

| Check | Result |
| --- | --- |
| PostgreSQL queue integration tests | 21 passed |
| Legacy queue/email/PDF runtime tests | 9 passed |
| YouTube publishing and LLM fallback tests | 25 passed |
| Total automated node:test cases | 55 passed; 0 failed |
| LinkedIn/Telegram publishing regression | Passed; mocked providers |
| PDF core extraction/chunking | Passed |
| Backend TypeScript and frontend production build | Passed |
| Local FFmpeg executable verification | Passed; Windows FFmpeg 6.1.1 |

The frontend build retains its large-chunk warning. Experimental Node module-mocking warnings are expected in tests. OTP pickup was tested using a message aged 59 seconds; observed pickup was approximately 59 seconds, below the 65-second fixture tolerance. SMTP was mocked; this is not a production email SLA.

Database tests provisioned new loopback-only databases and never loaded production .env. All fixtures, subprocesses and the temporary PostgreSQL cluster were shut down and cleaned up. No real posts/emails were sent. Schema 023 was applied only in the temporary test database and remains unapplied in production.

No commit, push, deployment, production restart, migration, import or cron activation was performed.
