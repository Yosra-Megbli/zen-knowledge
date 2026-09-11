-- W3: cross-company review scan function.
-- Same pattern as auth_find_user_by_email (0010_auth.sql):
-- SECURITY DEFINER so app_role can scan published documents across all
-- companies for the administrative cron workflow, without needing a
-- company context (which RLS would otherwise require).
--
-- Scope is deliberately narrow:
--   - Only published documents with a review_date set
--   - Only identity/metadata columns (no document content, no chunks)
--   - EXECUTE revoked from PUBLIC, granted only to app_role
--   - search_path pinned to prevent hijack
--
-- This does NOT weaken RLS for normal user-facing queries: it is only
-- callable by app_role (the n8n webhook route), and only returns the
-- columns needed for the W3 workflow decision logic.

CREATE OR REPLACE FUNCTION w3_get_review_due_documents(
  p_warning_days int DEFAULT 7
)
RETURNS TABLE (
  document_id uuid,
  company_id uuid,
  title text,
  review_date date,
  days_past_due int,
  owner_id uuid,
  owner_email text,
  task_id uuid,
  task_status text,
  task_notified_at timestamptz,
  task_reminded_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.company_id,
    d.title,
    d.review_date,
    (CURRENT_DATE - d.review_date)::int,
    u.id,
    u.email,
    rt.id,
    rt.status,
    rt.notified_at,
    rt.reminded_at
  FROM documents d
  JOIN users u ON u.id = d.owner_id
  LEFT JOIN review_tasks rt
    ON rt.document_id = d.id
    AND rt.status IN ('warning', 'overdue')
  WHERE d.status = 'published'
    AND d.review_date IS NOT NULL
    AND d.review_date <= CURRENT_DATE + p_warning_days
  ORDER BY d.review_date ASC;
$$;

REVOKE ALL ON FUNCTION w3_get_review_due_documents(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION w3_get_review_due_documents(int) TO app_role;
