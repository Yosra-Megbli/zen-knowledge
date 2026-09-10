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
