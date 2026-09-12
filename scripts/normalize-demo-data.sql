-- scripts/normalize-demo-data.sql
-- Normalisation idempotente du document de test « yosra » vers « Gestion des incidents clients »
--
-- Exécutable directement dans le SQL Editor Supabase.

-- ============================================================================
-- 1. CONTRÔLE AVANT MODIFICATION
-- ============================================================================
SELECT 
  d.id,
  d.title,
  d.description,
  d.status,
  d.review_date,
  comp.name AS company_name
FROM documents d
JOIN companies comp ON comp.id = d.company_id
WHERE d.title = 'yosra';

-- ============================================================================
-- 2. NORMALISATION IDEMPOTENTE
-- ============================================================================
BEGIN;

UPDATE documents
SET 
  title = 'Gestion des incidents clients',
  description = 'Procédure de traitement et de suivi des incidents clients.',
  status = 'published',
  deleted_at = NULL,
  -- Option par défaut : date saine future (2027-09-04).
  -- Si vous souhaitez le conserver comme document en retard d'obsolescence pour W3,
  -- commentez la ligne ci-dessous ou laissez '2026-09-04'.
  review_date = '2027-09-04',
  updated_at = now()
WHERE title = 'yosra';

COMMIT;

-- ============================================================================
-- 3. VÉRIFICATION APRÈS MODIFICATION
-- ============================================================================
-- Attendu :
-- - 0 ligne avec title='yosra'
-- - 1 ligne avec title='Gestion des incidents clients', status='published', review_date='2027-09-04'
SELECT 
  d.id,
  d.title,
  d.description,
  d.status,
  d.review_date,
  comp.name AS company_name
FROM documents d
JOIN companies comp ON comp.id = d.company_id
WHERE d.title IN ('yosra', 'Gestion des incidents clients');
