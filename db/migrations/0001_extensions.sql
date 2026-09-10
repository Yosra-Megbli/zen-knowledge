-- Extensions required by the schema.
-- vector: pgvector, used by document_chunks.embedding (Phase 3+ will populate it).
-- pgcrypto: gen_random_uuid() used as the default for every primary key.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
