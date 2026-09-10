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
