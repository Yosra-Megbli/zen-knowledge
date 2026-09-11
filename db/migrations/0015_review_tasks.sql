-- W3: tracks review/obsolescence tasks per published document.
-- One open task per document at a time (UNIQUE on document_id WHERE
-- status IN ('warning','overdue') prevents duplicate notifications).
-- company_id is denormalized for RLS consistency with all other tables.

CREATE TABLE review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'warning'
    CHECK (status IN ('warning', 'overdue', 'resolved', 'unpublished')),
  due_date date NOT NULL,
  notified_at timestamptz,
  reminded_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate open tasks for the same document.
CREATE UNIQUE INDEX review_tasks_one_open_per_document
  ON review_tasks (document_id)
  WHERE status IN ('warning', 'overdue');

-- RLS — same pattern as all other tables.
ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY review_tasks_isolation ON review_tasks
  FOR ALL
  USING (company_id = app_current_company_id())
  WITH CHECK (company_id = app_current_company_id());

GRANT SELECT, INSERT, UPDATE ON review_tasks TO app_role;
