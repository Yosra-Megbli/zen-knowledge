-- Phase 4: the ingestion_jobs.status CHECK constraint defined back in
-- 0006_operational_tables.sql (pending/extracting/cleaning/chunking/
-- embedding/indexing/review/published/failed) was a Phase 2 placeholder
-- for a table nothing wrote to yet — db/seed.mjs never inserted an
-- ingestion_jobs row, and no application code existed to use it until
-- this phase. Phase 4 explicitly specifies a simpler, clearly-scoped
-- lifecycle instead: pending / processing / completed / failed. Since
-- there are zero existing rows, this is a pure constraint replacement
-- with no data to migrate or lose.
ALTER TABLE ingestion_jobs DROP CONSTRAINT ingestion_jobs_status_check;
ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed'));
