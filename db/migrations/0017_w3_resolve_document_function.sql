-- W3: narrow SECURITY DEFINER lookup used by the write-side n8n routes
-- (POST /api/n8n/review-due/notify, POST /api/n8n/unpublish) to resolve
-- a document's real company_id/owner_id/status server-side, so those
-- routes never have to trust a company_id supplied in the n8n request
-- body — same "never trust client input for authorization" principle
-- as auth_find_user_by_email (0010) and w3_get_review_due_documents
-- (0016). Returns only the three columns needed to build an
-- AuthContext; no document content.

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
