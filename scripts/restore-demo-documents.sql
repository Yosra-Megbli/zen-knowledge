-- scripts/restore-demo-documents.sql
-- Restauration idempotente des 2 documents clés de démo pour ZEN Retail Tunisia :
--   1) « Politique de retour et remboursement produit » (v2 publiée, v1 archivée)
--   2) « Guide d'utilisation de l'assistant ZEN Knowledge » (v1 publiée)
--
-- Exécutable directement dans le SQL Editor Supabase.

-- ============================================================================
-- 1. CONTRÔLE AVANT MODIFICATION (État actuel)
-- ============================================================================
SELECT 
  d.id AS doc_id,
  d.title,
  d.status AS doc_status,
  d.deleted_at,
  v.version_number,
  v.status AS version_status,
  COUNT(c.id) AS chunk_count,
  COUNT(c.id) FILTER (WHERE c.document_status = 'published' AND c.version_status = 'published') AS active_chunks
FROM documents d
JOIN companies comp ON comp.id = d.company_id
LEFT JOIN document_versions v ON v.document_id = d.id
LEFT JOIN document_chunks c ON c.document_version_id = v.id
WHERE comp.name = 'ZEN Retail Tunisia'
  AND d.title IN (
    'Politique de retour et remboursement produit',
    'Guide d''utilisation de l''assistant ZEN Knowledge'
  )
GROUP BY d.id, d.title, d.status, d.deleted_at, v.version_number, v.status
ORDER BY d.title, v.version_number;

-- ============================================================================
-- 2. RESTAURATION IDEMPOTENTE
-- ============================================================================
BEGIN;

-- a) Restauration de « Politique de retour et remboursement produit »
UPDATE documents
SET 
  status = 'published',
  deleted_at = NULL,
  updated_at = now()
WHERE title = 'Politique de retour et remboursement produit'
  AND status = 'deleted'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

-- Sécurisation des statuts de versions pour « Politique de retour » :
-- Version 1 DOIT être archivée, Version 2 DOIT être publiée
UPDATE document_versions
SET status = 'archived'
WHERE document_id = (
  SELECT id FROM documents 
  WHERE title = 'Politique de retour et remboursement produit' 
    AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1)
) AND version_number = 1 AND status != 'archived';

UPDATE document_versions
SET status = 'published'
WHERE document_id = (
  SELECT id FROM documents 
  WHERE title = 'Politique de retour et remboursement produit' 
    AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1)
) AND version_number = 2 AND status != 'published';

-- b) Restauration de « Guide d'utilisation de l'assistant ZEN Knowledge »
UPDATE documents
SET 
  status = 'published',
  deleted_at = NULL,
  updated_at = now()
WHERE title = 'Guide d''utilisation de l''assistant ZEN Knowledge'
  AND status = 'deleted'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

-- Sécurisation de la version 1 pour « Guide d'utilisation »
UPDATE document_versions
SET status = 'published'
WHERE document_id = (
  SELECT id FROM documents 
  WHERE title = 'Guide d''utilisation de l''assistant ZEN Knowledge' 
    AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1)
) AND version_number = 1 AND status != 'published';

COMMIT;

-- ============================================================================
-- 3. VÉRIFICATION APRÈS MODIFICATION (État attendu)
-- ============================================================================
-- Attendu :
-- - Politique de retour : doc_status='published', v1='archived' (0 active chunks), v2='published' (>0 active chunks)
-- - Guide d'utilisation : doc_status='published', v1='published' (>0 active chunks)
SELECT 
  d.id AS doc_id,
  d.title,
  d.status AS doc_status,
  d.deleted_at,
  v.version_number,
  v.status AS version_status,
  COUNT(c.id) AS total_chunks,
  COUNT(c.id) FILTER (WHERE c.document_status = 'published' AND c.version_status = 'published') AS active_chunks
FROM documents d
JOIN companies comp ON comp.id = d.company_id
LEFT JOIN document_versions v ON v.document_id = d.id
LEFT JOIN document_chunks c ON c.document_version_id = v.id
WHERE comp.name = 'ZEN Retail Tunisia'
  AND d.title IN (
    'Politique de retour et remboursement produit',
    'Guide d''utilisation de l''assistant ZEN Knowledge'
  )
GROUP BY d.id, d.title, d.status, d.deleted_at, v.version_number, v.status
ORDER BY d.title, v.version_number;
