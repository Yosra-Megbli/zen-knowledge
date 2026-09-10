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
