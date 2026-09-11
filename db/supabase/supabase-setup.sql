-- ============================================================
-- ZEN Knowledge — Supabase setup (generated, do not edit)
-- Generated: 2026-09-11T10:00:25.720Z
-- Paste this entire file into Supabase SQL Editor and run.
-- ============================================================

-- ---- 0001_extensions.sql ----
-- Extensions required by the schema.
-- vector: pgvector, used by document_chunks.embedding (Phase 3+ will populate it).
-- pgcrypto: gen_random_uuid() used as the default for every primary key.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ---- 0002_roles.sql ----
-- app_role: the ONLY role used at runtime by the application (reads and
-- writes, once Auth.js/ingestion/RAG exist in later phases).
--
-- NOBYPASSRLS is the critical property here: this role can never bypass
-- Row Level Security. The role that runs these migrations (the Postgres
-- superuser provided by POSTGRES_USER in docker-compose, or the Supabase
-- "postgres" role in production) is NOT used at runtime — it is reserved
-- for migrations, policy creation and controlled maintenance, and it
-- DOES bypass RLS because it is a superuser. This file creates the
-- restricted role explicitly so the distinction is never accidental.
--
-- 0364856fb7b4416996ce8e4f1ff15096b7bc9e1d is substituted by db/migrate.mjs from the
-- APP_ROLE_PASSWORD environment variable at migration time. It is never
-- hardcoded in this file and never committed anywhere else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD '0364856fb7b4416996ce8e4f1ff15096b7bc9e1d'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  ELSE
    ALTER ROLE app_role WITH PASSWORD '0364856fb7b4416996ce8e4f1ff15096b7bc9e1d';
  END IF;
END
$$;


-- ---- 0003_companies_departments_users.sql ----
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  department_id uuid REFERENCES departments(id),
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'contributor', 'employee')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);


-- ---- 0004_documents.sql ----
-- documents.current_version_id and document_versions reference each other
-- (a document points at its current published version; a version points
-- back at its document). The circular reference is resolved by creating
-- documents first without the FK, then adding it once document_versions
-- exists, in this same migration.

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  department_id uuid REFERENCES departments(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  visibility text NOT NULL CHECK (visibility IN ('company', 'department', 'restricted')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'unpublished', 'archived', 'deleted')),
  current_version_id uuid,
  review_date date,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  version_number int NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'failed', 'published', 'archived')),
  file_key text NOT NULL,
  file_type text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

-- Only one version per document can be the active/current one.
CREATE UNIQUE INDEX one_published_version_per_document
  ON document_versions (document_id)
  WHERE status = 'published';

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);


-- ---- 0005_document_chunks.sql ----
-- document_chunks is the enforcement point for the future RAG retrieval
-- (Phase 3+). It carries DENORMALIZED authorization columns (company_id,
-- department_id, visibility, document_status, version_status) copied
-- from documents/document_versions, so that a single SELECT with an
-- ORDER BY on embedding can apply the full authorization filter without
-- any JOIN — see db/migrations/0008_triggers.sql for how these columns
-- are kept in sync, and 0009_rls_and_grants.sql for the policy that
-- reads them.
--
-- embedding is nullable in this phase: Phase 2 does not generate real
-- embeddings (see project instructions). Rows can exist with
-- embedding = NULL; pgvector's HNSW index simply does not index NULL
-- vectors, which is harmless until Phase 3 populates them.
--
-- Distance choice: multilingual-e5-small (Phase 3) produces L2-normalized
-- embeddings meant for cosine similarity, so retrieval will use the
-- pgvector cosine operator <=> together with a vector_cosine_ops index
-- (HNSW) — never <-> (L2) or <#> (inner product) for this model.
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  department_id uuid REFERENCES departments(id),
  visibility text NOT NULL,
  document_status text NOT NULL,
  version_status text NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  page_number int,
  char_start int,
  char_end int,
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ---- 0006_operational_tables.sql ----
-- company_id is denormalized onto every one of these tables (rather than
-- reached through a JOIN) so that every RLS policy in 0009 can stay a
-- flat, cheap column comparison — consistent with the approach used on
-- document_chunks.

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'extracting', 'cleaning', 'chunking', 'embedding', 'indexing', 'review', 'published', 'failed')),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  triggered_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  model_used text,
  tokens_input int,
  tokens_output int,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES conversation_messages(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL,
  page_number int,
  char_start int,
  char_end int,
  snippet_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES conversation_messages(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  rating text NOT NULL CHECK (rating IN ('useful', 'not_useful')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ---- 0007_indexes.sql ----
-- Only the indexes actually needed for authorization filtering,
-- foreign-key lookups, and the future vector search.

CREATE INDEX idx_departments_company ON departments (company_id);

CREATE INDEX idx_users_company ON users (company_id);

CREATE INDEX idx_documents_company_status ON documents (company_id, status);
CREATE INDEX idx_documents_department ON documents (department_id);
CREATE INDEX idx_documents_review_date ON documents (review_date);
CREATE INDEX idx_documents_deleted_at ON documents (deleted_at);

CREATE INDEX idx_document_versions_document ON document_versions (document_id);
CREATE INDEX idx_document_versions_company ON document_versions (company_id);

-- The authorization filter applied by document_chunks_select (0009):
-- company_id + document_status + version_status, evaluated on every
-- retrieval query before the vector ORDER BY.
CREATE INDEX idx_document_chunks_auth_filter
  ON document_chunks (company_id, document_status, version_status);
CREATE INDEX idx_document_chunks_version ON document_chunks (document_version_id);
CREATE INDEX idx_document_chunks_document ON document_chunks (document_id);

-- Vector search index. HNSW + vector_cosine_ops matches the cosine
-- distance operator (<=>) that multilingual-e5-small's normalized
-- embeddings require (see 0005_document_chunks.sql).
CREATE INDEX idx_document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_ingestion_jobs_version ON ingestion_jobs (document_version_id);
CREATE INDEX idx_ingestion_jobs_company_status ON ingestion_jobs (company_id, status);

CREATE INDEX idx_conversations_company ON conversations (company_id);
CREATE INDEX idx_conversations_user ON conversations (user_id);

CREATE INDEX idx_conversation_messages_conversation ON conversation_messages (conversation_id);
CREATE INDEX idx_conversation_messages_company ON conversation_messages (company_id);

CREATE INDEX idx_citations_message ON citations (message_id);
CREATE INDEX idx_citations_company ON citations (company_id);

CREATE INDEX idx_feedback_message ON feedback (message_id);
CREATE INDEX idx_feedback_company ON feedback (company_id);

CREATE INDEX idx_audit_logs_company_created ON audit_logs (company_id, created_at);


-- ---- 0008_triggers.sql ----
-- Keeps the denormalized authorization columns on document_chunks
-- (company_id, department_id, visibility, document_status,
-- version_status) in sync with their source of truth (documents,
-- document_versions), so RLS on document_chunks can never go stale.
--
-- These functions run as SECURITY INVOKER (the default — no keyword
-- needed): they execute with the privileges of whichever role performs
-- the INSERT/UPDATE, and are therefore themselves subject to RLS on
-- documents/document_versions. In practice this means app_role can only
-- attach chunks to a document that is visible under its OWN current
-- SET LOCAL app.company_id context — a deliberate property, not an
-- oversight (see README "Authorization context").

CREATE OR REPLACE FUNCTION set_document_chunk_auth_columns()
RETURNS trigger AS $$
DECLARE
  ver_status text;
  doc RECORD;
BEGIN
  SELECT status INTO ver_status
    FROM document_versions WHERE id = NEW.document_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_version % not found or not visible in current context', NEW.document_version_id;
  END IF;

  SELECT d.id, d.company_id, d.department_id, d.visibility, d.status
    INTO doc
    FROM document_versions v
    JOIN documents d ON d.id = v.document_id
    WHERE v.id = NEW.document_version_id;

  NEW.document_id := doc.id;
  NEW.company_id := doc.company_id;
  NEW.department_id := doc.department_id;
  NEW.visibility := doc.visibility;
  NEW.document_status := doc.status;
  NEW.version_status := ver_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_chunks_set_auth_columns
  BEFORE INSERT OR UPDATE OF document_version_id ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION set_document_chunk_auth_columns();

-- Propagate a change on the document itself (status, visibility,
-- department) to every chunk of every version of that document.
CREATE OR REPLACE FUNCTION propagate_document_auth_change()
RETURNS trigger AS $$
BEGIN
  UPDATE document_chunks
  SET document_status = NEW.status,
      visibility = NEW.visibility,
      department_id = NEW.department_id
  WHERE document_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_propagate_auth_change
  AFTER UPDATE OF status, visibility, department_id ON documents
  FOR EACH ROW EXECUTE FUNCTION propagate_document_auth_change();

-- Propagate a change on a version's status (publish / archive / ...)
-- to the chunks of that specific version only.
CREATE OR REPLACE FUNCTION propagate_version_auth_change()
RETURNS trigger AS $$
BEGIN
  UPDATE document_chunks
  SET version_status = NEW.status
  WHERE document_version_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_propagate_auth_change
  AFTER UPDATE OF status ON document_versions
  FOR EACH ROW EXECUTE FUNCTION propagate_version_auth_change();


-- ---- 0009_rls_and_grants.sql ----
-- ==========================================================
-- GRANTS
-- app_role gets only SELECT/INSERT/UPDATE, on exactly the tables it
-- needs. No DELETE is granted anywhere: this project uses soft delete
-- (documents.status = 'deleted' + deleted_at) so deleted content stays
-- auditable but is never retrievable — see document_chunks_select below.
-- ==========================================================
GRANT USAGE ON SCHEMA public TO app_role;

GRANT SELECT, INSERT, UPDATE ON companies TO app_role;
GRANT SELECT, INSERT, UPDATE ON departments TO app_role;
GRANT SELECT, INSERT, UPDATE ON users TO app_role;
GRANT SELECT, INSERT, UPDATE ON documents TO app_role;
GRANT SELECT, INSERT, UPDATE ON document_versions TO app_role;
GRANT SELECT, INSERT, UPDATE ON document_chunks TO app_role;
GRANT SELECT, INSERT, UPDATE ON ingestion_jobs TO app_role;
GRANT SELECT, INSERT, UPDATE ON conversations TO app_role;
GRANT SELECT, INSERT, UPDATE ON conversation_messages TO app_role;
GRANT SELECT, INSERT, UPDATE ON citations TO app_role;
GRANT SELECT, INSERT, UPDATE ON feedback TO app_role;
GRANT SELECT, INSERT, UPDATE ON audit_logs TO app_role;

-- ==========================================================
-- AUTHORIZATION CONTEXT — helper functions
--
-- These are the "fonctions SQL nécessaires pour company_id / role /
-- department_id" the authorization context is built on. They all wrap
-- current_setting('app.xxx', true) — the `true` (missing_ok) means
-- "return NULL instead of raising an error when unset" — but add one
-- more step: NULLIF(..., '').
--
-- Why NULLIF is required (found by TEST 10, not assumed upfront):
-- a custom GUC like "app.company_id" only exists in Postgres once a
-- session has referenced it via SET/SET LOCAL at least once. After
-- that point, once the transaction that SET it ends, the setting does
-- NOT go back to "truly unset" (NULL) — it resets to an EMPTY STRING
-- for the remainder of that session/connection. On a plain
-- current_setting(...)::uuid cast, an empty string does not cast
-- cleanly to NULL — it raises "invalid input syntax for type uuid".
-- Since connections are reused across requests/transactions in any
-- pooled setup (Node's pg Pool, PgBouncer, Supavisor), a request that
-- legitimately forgets to set the context on a connection previously
-- used by another request would hit a hard error instead of the
-- intended "zero rows, fail-closed" behavior. NULLIF(x, '') collapses
-- both "never set" and "reset after a previous transaction" to the
-- same NULL, so every policy below behaves identically — and
-- fail-closed — in both cases.
-- ==========================================================

CREATE OR REPLACE FUNCTION app_current_company_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '');
$$;

CREATE OR REPLACE FUNCTION app_current_department_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.department_id', true), '')::uuid;
$$;

-- ==========================================================
-- ROW LEVEL SECURITY
--
-- Every policy calls the functions above to read the transaction-local
-- authorization context that the application sets via
-- `SELECT set_config('app.xxx', $1, true)` inside each transaction
-- (see db/db.mjs withAuthContext, and README "Authorization context").
-- The third argument to set_config (true) makes the value
-- transaction-scoped: it is erased automatically at COMMIT/ROLLBACK.
--
-- A missing/forgotten context evaluates to NULL (see functions above),
-- and NULL compared to anything (NULL = x) is NULL, which a USING
-- clause treats as FALSE. Every policy below is fail-closed by
-- construction, not by convention.
--
-- FORCE ROW LEVEL SECURITY is added for every table even though
-- app_role does not own any of them (they are owned by the migration
-- role) — RLS already applies to any non-owner, non-superuser role by
-- default. FORCE is kept as explicit, self-documenting intent.
--
-- IMPORTANT — what RLS does NOT protect against: the role that runs
-- these migrations (POSTGRES_USER locally, e.g. "zen_dev"; the
-- "postgres" role on Supabase) is a SUPERUSER, and superusers ALWAYS
-- bypass Row Level Security, FORCE or not. This is PostgreSQL's design,
-- not a gap in this schema. It is exactly why every RLS test in
-- tests/integration/rls/ connects as app_role — never as the migration
-- role — and why the app's runtime code (Phase 3+) must never use the
-- migration connection to serve a request.
-- ==========================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_isolation ON companies
  FOR ALL
  USING (id = app_current_company_id())
  WITH CHECK (id = app_current_company_id());

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
CREATE POLICY departments_isolation ON departments
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON documents
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY document_versions_isolation ON document_versions
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

-- document_chunks: THE enforcement point for RAG retrieval.
-- The SELECT policy applies the full authorization chain — company,
-- publication status of both the document AND its version, and
-- visibility (company-wide / department-scoped / restricted-to-admin)
-- — directly on this table. The future vector search
-- (ORDER BY embedding <=> query LIMIT k, Phase 3+) executes against
-- rows already filtered by this policy: authorization happens before
-- and as part of retrieval, never as a post-filter.
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

CREATE POLICY document_chunks_select ON document_chunks
  FOR SELECT
  USING (
    company_id = app_current_company_id()
    AND document_status = 'published'
    AND version_status = 'published'
    AND (
      visibility = 'company'
      OR (visibility = 'department' AND department_id = app_current_department_id())
      OR (visibility = 'restricted' AND app_current_role() = 'admin')
    )
  );

CREATE POLICY document_chunks_insert ON document_chunks
  FOR INSERT
  WITH CHECK (company_id = app_current_company_id());

CREATE POLICY document_chunks_update ON document_chunks
  FOR UPDATE
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY ingestion_jobs_isolation ON ingestion_jobs
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_isolation ON conversations
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_messages_isolation ON conversation_messages
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations FORCE ROW LEVEL SECURITY;
CREATE POLICY citations_isolation ON citations
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY feedback_isolation ON feedback
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_isolation ON audit_logs
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());


-- ---- 0010_auth.sql ----
-- Phase 3: adds password storage for the demo Credentials login, and a
-- single narrowly-scoped lookup path that lets the application find a
-- user BY EMAIL before any company/role/department context exists yet
-- (login is "who are you", which necessarily happens before RLS's
-- "what can you see" can apply).
--
-- users.password_hash is nullable: not every future user needs a
-- local password (SSO could be added later without a migration).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

-- SECURITY DEFINER is PostgreSQL's standard, narrowly-scoped mechanism
-- for exactly this situation: this function runs with the privileges
-- of its OWNER (migration_role, a superuser) rather than the caller
-- (app_role), so it can look up a user by email even though app_role's
-- own SELECT on `users` is RLS-restricted to a company_id it doesn't
-- know yet.
--
-- This is NOT a second authorization system and does NOT weaken RLS:
--   - It returns only the columns needed to authenticate/build a
--     session (identity + role/company/department + password hash for
--     verification) — never document content, never other users' data
--     beyond this lookup, never an arbitrary query.
--   - EXECUTE is revoked from PUBLIC and granted only to app_role.
--   - SET search_path = public pins the search path to prevent a
--     classic SECURITY DEFINER search_path hijack.
--   - Every table this function's caller subsequently touches (via
--     lib/db/withAuthContext.ts, once the session establishes a real
--     company_id/role/department_id) goes back through normal RLS —
--     this function's privilege escalation is confined to itself.
CREATE OR REPLACE FUNCTION auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  department_id uuid,
  role text,
  name text,
  status text,
  password_hash text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, company_id, department_id, role, name, status, password_hash
  FROM users
  WHERE email = p_email;
$$;

REVOKE ALL ON FUNCTION auth_find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO app_role;


-- ---- 0011_ingestion_job_details.sql ----
-- Phase 4: ingestion_jobs needs a machine-readable error code
-- (distinct from the free-text error_message) and a chunk count, so a
-- later observability phase can query/aggregate without parsing
-- strings. Purely additive — existing rows get NULL, no data loss, no
-- change to RLS (already enabled on ingestion_jobs since
-- 0009_rls_and_grants.sql; adding a column does not affect it).
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS chunk_count int;


-- ---- 0012_ingestion_job_status_model.sql ----
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


-- ---- 0013_fix_status_propagation_rls.sql ----
-- Phase 4 bug fix, found by tests/integration/ingestion/pipeline.test.ts
-- ("must become retrievable once published").
--
-- Root cause (confirmed empirically and against PostgreSQL's documented
-- RLS semantics): when a table has SEPARATE policies for SELECT and
-- UPDATE (as document_chunks does), PostgreSQL combines them with AND
-- for any UPDATE command — "the user must have both types of
-- permissions" (PostgreSQL docs, CREATE POLICY). Concretely, the
-- resulting NEW row of an UPDATE must satisfy document_chunks_select's
-- USING clause (company + document_status='published' +
-- version_status='published' + visibility) IN ADDITION TO
-- document_chunks_update's WITH CHECK (company_id only) — even though
-- document_chunks_update never mentions status at all.
--
-- This silently blocked every legitimate status transition performed
-- by the propagation triggers from 0008_triggers.sql: publishing
-- (draft/ready -> published) or archiving (published -> archived) a
-- document/version would update documents/document_versions correctly,
-- but the trigger's own UPDATE of document_chunks.document_status /
-- version_status would fail RLS whenever the transition moved a row
-- OUT of "published" (and, symmetrically, silently succeed with no
-- real bug only for transitions that stayed within "published") —
-- verified directly: "UPDATE document_chunks SET document_status =
-- 'draft' ..." fails with "new row violates row-level security
-- policy", while a same-value no-op update succeeds.
--
-- Fix: these two propagation functions exist ONLY to keep denormalized
-- bookkeeping columns in sync with documents/document_versions, whose
-- own RLS already gated the outer UPDATE the caller performed. Their
-- internal UPDATE of document_chunks is not new user-facing access —
-- making them SECURITY DEFINER (owned by migration_role, bypassing RLS
-- for this narrow, mechanical sync only) resolves the SELECT+UPDATE
-- policy combination trap, exactly like the existing
-- auth_find_user_by_email precedent in 0010_auth.sql. search_path is
-- pinned for the same reason as that function.
--
-- set_document_chunk_auth_columns (the BEFORE INSERT/UPDATE trigger
-- that derives a NEW chunk's columns from its parent) is deliberately
-- NOT changed here: it must stay SECURITY INVOKER so that a chunk can
-- only ever be attached under the caller's own RLS-visible company
-- context — that property was verified working correctly throughout
-- Phase 4 ingestion testing and is unrelated to this bug.

CREATE OR REPLACE FUNCTION propagate_document_auth_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE document_chunks
  SET document_status = NEW.status,
      visibility = NEW.visibility,
      department_id = NEW.department_id
  WHERE document_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION propagate_version_auth_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE document_chunks
  SET version_status = NEW.status
  WHERE document_version_id = NEW.id;
  RETURN NEW;
END;
$$;

