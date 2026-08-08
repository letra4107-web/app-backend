# Deployment Checklist

## Backend (Railway)

Railway auto-deploys the `backend/` directory from `railway.json` on every push
to `master` (`NIXPACKS` build, `cd backend && npm ci`, then `npm start`). Code
changes need nothing beyond `git push`.

**Database migrations are not part of that pipeline and are never applied
automatically.** Files under `migration/migrations/*.sql` are documentation of
intended schema changes, not an executed migration history — nothing runs
them against the live Supabase database except a human, manually, in the SQL
editor. Skipping this step does not error at push time or at deploy time; it
fails silently until a specific feature that depends on the missing column,
table, or function is exercised in production (see the 2026-08-08 audit
below for a concrete example: `022_word_of_day_server_streak.sql` sat
unapplied for an unknown period before breaking Word of the Day attempt
saving).

### Every time you push a new file to `migration/migrations/`

1. Open the Supabase SQL editor for this project.
2. Open the new migration file(s) in the repo and run their contents,
   top to bottom, in filename order (`022`, `023`, `024`, ...).
3. Confirm no errors. Most statements here use `IF NOT EXISTS` /
   `CREATE OR REPLACE` / `ON CONFLICT`, so re-running an already-applied
   migration is safe — when in doubt, run it again rather than guessing.
4. Restart the Railway backend (or wait for the next deploy) so
   `backend/services/schemaHealthCheck.js` re-probes the schema on boot and
   confirms nothing is still missing — check the Railway deploy logs for its
   output.
5. If the health check logs any `MISSING` entries, stop and reconcile before
   telling anyone the deploy is done — those are exactly the columns/tables/
   functions a real feature will hit next.

### Why this can't just be automated away here

Applying schema migrations from application code requires either a direct
Postgres connection (a `DATABASE_URL` + a client like `pg`) or a Supabase
Management API token — neither is present in this project's backend
environment (it only holds `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
which talk to PostgREST, not the database directly). Until one of those is
added deliberately, migrations stay a manual step.

## 2026-08-08 migration audit

A full audit compared every file in `migration/migrations/` against the live
schema and found several were never applied (queries silently degraded or, in
one case, hard-failed). The catch-up SQL is
`migration/migrations/033_sync_missed_migrations_022_through_021_015_009.sql`.
