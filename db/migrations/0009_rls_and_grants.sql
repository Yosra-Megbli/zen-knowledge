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
