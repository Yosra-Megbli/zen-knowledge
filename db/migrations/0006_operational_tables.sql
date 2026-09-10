-- company_id is denormalized onto every one of these tables (rather than
-- reached through a JOIN) so that every RLS policy in 0009 can stay a
-- flat, cheap column comparison — consistent with the approach used on
-- document_chunks.

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'extracting', 'cleaning', 'chunking', 'embedding', 'indexing', 'review', 'published', 'failed')),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  triggered_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  model_used text,
  tokens_input int,
  tokens_output int,
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES conversation_messages(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  document_version_id uuid NOT NULL REFERENCES document_versions(id),
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL,
  page_number int,
  char_start int,
  char_end int,
  snippet_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES conversation_messages(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  rating text NOT NULL CHECK (rating IN ('useful', 'not_useful')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
