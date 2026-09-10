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
