-- Phase 4: ingestion_jobs needs a machine-readable error code
-- (distinct from the free-text error_message) and a chunk count, so a
-- later observability phase can query/aggregate without parsing
-- strings. Purely additive — existing rows get NULL, no data loss, no
-- change to RLS (already enabled on ingestion_jobs since
-- 0009_rls_and_grants.sql; adding a column does not affect it).
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS chunk_count int;
