-- ============================================================================
-- SETUP REVIEW_TASKS & NOTIFICATIONS (MIGRATIONS 0015 -> 0019)
-- À exécuter dans le Supabase SQL Editor de production :
-- https://supabase.com/dashboard/project/vlinguhfnnitcxumdpxm/sql/new
-- ============================================================================

-- 1. Table review_tasks
CREATE TABLE IF NOT EXISTS review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'warning'
    CHECK (status IN ('warning', 'overdue', 'resolved', 'unpublished')),
  due_date date NOT NULL,
  notified_at timestamptz,
  reminded_at timestamptz,
  resolved_at timestamptz,
  reminder_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Index unique pour éviter les doublons de tâches ouvertes
CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_one_open_per_document
  ON review_tasks (document_id)
  WHERE status IN ('warning', 'overdue');

-- 3. Sécurité RLS (Row Level Security) par entreprise
ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_tasks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_tasks_isolation ON review_tasks;
CREATE POLICY review_tasks_isolation ON review_tasks
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

-- 4. Permissions d'accès pour app_role
GRANT SELECT, INSERT, UPDATE ON review_tasks TO app_role;

-- 5. Fonctions utilitaires sécurisées pour les scans et résolutions (n8n & cron)
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

CREATE OR REPLACE FUNCTION w3_resolve_document_for_task(p_document_id uuid)
RETURNS TABLE (
  company_id uuid,
  owner_id uuid,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.company_id, d.owner_id, d.status
  FROM documents d
  WHERE d.id = p_document_id;
$$;

REVOKE ALL ON FUNCTION w3_resolve_document_for_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION w3_resolve_document_for_task(uuid) TO app_role;
