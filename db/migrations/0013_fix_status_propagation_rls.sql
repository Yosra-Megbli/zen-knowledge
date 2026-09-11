-- Phase 4 bug fix, found by tests/integration/ingestion/pipeline.test.ts
-- ("must become retrievable once published").
--
-- Root cause (confirmed empirically and against PostgreSQL's documented
-- RLS semantics): when a table has SEPARATE policies for SELECT and
-- UPDATE (as document_chunks does), PostgreSQL combines them with AND
-- for any UPDATE command — "the user must have both types of
-- permissions" (PostgreSQL docs, CREATE POLICY). Concretely, the
-- resulting NEW row of an UPDATE must satisfy document_chunks_select's
-- USING clause (company + document_status='published' +
-- version_status='published' + visibility) IN ADDITION TO
-- document_chunks_update's WITH CHECK (company_id only) — even though
-- document_chunks_update never mentions status at all.
--
-- This silently blocked every legitimate status transition performed
-- by the propagation triggers from 0008_triggers.sql: publishing
-- (draft/ready -> published) or archiving (published -> archived) a
-- document/version would update documents/document_versions correctly,
-- but the trigger's own UPDATE of document_chunks.document_status /
-- version_status would fail RLS whenever the transition moved a row
-- OUT of "published" (and, symmetrically, silently succeed with no
-- real bug only for transitions that stayed within "published") —
-- verified directly: "UPDATE document_chunks SET document_status =
-- 'draft' ..." fails with "new row violates row-level security
-- policy", while a same-value no-op update succeeds.
--
-- Fix: these two propagation functions exist ONLY to keep denormalized
-- bookkeeping columns in sync with documents/document_versions, whose
-- own RLS already gated the outer UPDATE the caller performed. Their
-- internal UPDATE of document_chunks is not new user-facing access —
-- making them SECURITY DEFINER (owned by migration_role, bypassing RLS
-- for this narrow, mechanical sync only) resolves the SELECT+UPDATE
-- policy combination trap, exactly like the existing
-- auth_find_user_by_email precedent in 0010_auth.sql. search_path is
-- pinned for the same reason as that function.
--
-- set_document_chunk_auth_columns (the BEFORE INSERT/UPDATE trigger
-- that derives a NEW chunk's columns from its parent) is deliberately
-- NOT changed here: it must stay SECURITY INVOKER so that a chunk can
-- only ever be attached under the caller's own RLS-visible company
-- context — that property was verified working correctly throughout
-- Phase 4 ingestion testing and is unrelated to this bug.

CREATE OR REPLACE FUNCTION propagate_document_auth_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE document_chunks
  SET document_status = NEW.status,
      visibility = NEW.visibility,
      department_id = NEW.department_id
  WHERE document_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION propagate_version_auth_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE document_chunks
  SET version_status = NEW.status
  WHERE document_version_id = NEW.id;
  RETURN NEW;
END;
$$;
