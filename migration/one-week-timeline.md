# One-Week Migration Timeline — Firebase → Supabase

Generated: 2026-05-16
Owners: Migration Lead — Backend Engineer (Samantha); Data Migration — Data Engineer; Auth Migration — Security Lead; CI/CD — DevOps Engineer; QA — QA Engineer.

## Goals for week
- Produce working Supabase backend proof-of-concept (PoC) covering: one collection migrated, one storage bucket migrated, edge function replacement for one cloud function, and CI pipeline demo.
- Ensure no Firebase artifacts remain in backend repo at completion of migration steps (staged removal with backups).

---

### Day 0 (Kickoff, 0.5 day)
Owner: Migration Lead
Tasks:
- Kickoff meeting (30–60 min): assign owners, define maintenance window, set read-only flag for Firebase production during migration.
- Confirm access: obtain Supabase owner/service-role key or project invite.
Deliverables:
- Access confirmed, maintenance window scheduled, repo branch `migration/supabase` created.

### Day 1 (Provisioning & tooling, 1 day)
Owner: DevOps Engineer
Tasks:
- Create Supabase project(s): `staging` and `production` (if allowed).
- Provision DB, enable extensions: `pg_trgm`, `citext`, `uuid-ossp`, `pgcrypto` if needed.
- Create storage buckets matching Firebase storage layout (e.g., `teacher_uploads`, `avatars`) and set policies.
- Install `supabase` CLI in CI runner and add scripts for `supabase login`, `supabase projects create` (or manual).
Deliverables:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` stored in CI secrets.

### Day 2 (Schema design & DDL, 1 day)
Owner: Backend Engineer + Data Engineer
Tasks:
- Design normalized Postgres schema mapping Firestore collections to tables. Identify arrays → relational tables.
- Write `migrations/001_schema.sql` and RLS policy skeletons reflecting `firestore.rules` logic.
- Create sample DDL for `users`, `assignments`, `streaks`, `lessons`, `assessments`, `progress`, `reading_activities`, `children`, `teacher_uploads`.
Deliverables:
- `migrations/001_schema.sql` in repo, PR with schema and RLS policy templates.

### Day 3 (Export + transform scripts, 1 day)
Owner: Data Engineer
Tasks:
- Export Firestore collections to JSON/NDJSON using `gcloud` / `firebase` export (or `node` script). Create collection manifest with document counts.
- Create `scripts/transform_firestore_to_pg.py` (or Node) that converts JSON → CSV suitable for Postgres `COPY`, handling nested objects and arrays via mapping rules.
- Run transform on one small collection as PoC (e.g., `readingActivities`), produce CSV and verify row counts.
Deliverables:
- `scripts/export_firestore.sh` (instructions), `scripts/transform_firestore_to_pg.py`, PoC CSV and verification report.

### Day 4 (Storage & Auth migration PoC, 1 day)
Owner: Data Engineer + Security Lead
Tasks:
- Implement `scripts/migrate_storage.py` (Python/Node) to copy a small storage bucket (e.g., `teacher_uploads`) from Firebase Storage to Supabase Storage using service account credentials and Supabase Storage API. Preserve metadata (content-type, created/updated timestamps) in an accompanying CSV manifest.
- Evaluate Auth hash compatibility. If incompatible, implement user flagging and password-reset email flow. Send test reset emails for a small subset.
Deliverables:
- `scripts/migrate_storage.py` PoC, `auth_migration_plan.md` describing hash import or reset flow, sample reset email templates.

### Day 5 (Backend code replacement PoC, 1 day)
Owner: Backend Engineer
Tasks:
- Replace `backend/config/firebase.js` with `backend/config/supabase.js` that initializes Supabase admin client with service role key (local dev uses `.env` or CI secrets).
- Replace one backend route that used `firebase-admin` (e.g., speech route or a simple data read) to use Postgres via Supabase (or `pg` client) and Supabase Storage calls where needed.
- Create an Edge Function to replace a small Firebase Function and deploy to staging via `supabase` CLI.
Deliverables:
- `backend/config/supabase.js`, patched route(s), `supabase/functions/*` PoC deployed to staging.

### Day 6 (CI/CD, tests, security policies, 1 day)
Owner: DevOps + QA
Tasks:
- Update GitHub Actions (or CI) to run migrations (`supabase` CLI `db push` / `psql`), build and deploy Edge Functions, and run tests in staging.
- Implement Row Level Security policies and Storage policies in staging; test least-privilege service role usage.
- Update unit/integration tests to use Supabase mocks or a test Supabase instance.
Deliverables:
- `.github/workflows/ci.yml` updated, passing test run on staging, RLS and storage policies applied.

### Day 7 (Verification, performance checks, rollback readiness, 1 day)
Owner: QA + Migration Lead
Tasks:
- Run verification suite: auth flows, read/write, storage upload/download, realtime subscription smoke tests, Edge Function invocation.
- Compare row counts and checksums vs Firestore export for migrated collections.
- Run basic performance checks and capture latency baselines.
- Finalize rollback plan and perform a dry-run rollback test on staging (restore snapshot, switch sample client to Firebase read-only endpoint).
Deliverables:
- `migration_report.md` with checksums and counts, `rollback_plan.md` tested, sign-off checklist.

---

## Communication cadence
- Daily status update (end-of-day) in repository issue and Slack channel.
- Immediate alert if any critical failure during migration steps.

## Quick-owner contacts (suggested)
- Migration Lead / Backend Engineer: Samantha (repo owner)
- Data Engineer: (assign)
- Security Lead (Auth): (assign)
- DevOps / CI: (assign)
- QA: (assign)


End of timeline.
