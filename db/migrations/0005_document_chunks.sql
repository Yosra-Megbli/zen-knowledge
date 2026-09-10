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
