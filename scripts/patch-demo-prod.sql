-- ============================================================================
-- SCRIPT CHIRURGICAL ET IDEMPOTENT — PRODUCTION SUPABASE
-- Base de données : ZEN Knowledge (Supabase Production)
-- Société : ZEN Retail Tunisia
-- ============================================================================

-- 1. "Gestion des incidents clients — Service Client" → department_id = Service Client
UPDATE documents
SET department_id = (
  SELECT d.id 
  FROM departments d 
  JOIN companies c ON c.id = d.company_id 
  WHERE c.name = 'ZEN Retail Tunisia' AND d.name = 'Service Client'
  LIMIT 1
),
updated_at = NOW()
WHERE title = 'Gestion des incidents clients — Service Client'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

-- PREUVE SQL 1 :
SELECT 
  d.id, 
  d.title, 
  c.name AS company, 
  dep.name AS department_name, 
  d.status, 
  d.review_date
FROM documents d
JOIN companies c ON c.id = d.company_id
LEFT JOIN departments dep ON dep.id = d.department_id
WHERE d.title = 'Gestion des incidents clients — Service Client';


-- 2. Document publié avec review_date = CURRENT_DATE + 15 jours
-- Titre : "Procédure de traitement des réclamations VIP — Service Client"
-- Vérification / mise à jour review_date = CURRENT_DATE + 15 jours
UPDATE documents
SET review_date = (CURRENT_DATE + INTERVAL '15 days')::date,
    status = 'published',
    updated_at = NOW()
WHERE title = 'Procédure de traitement des réclamations VIP — Service Client'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

-- PREUVE SQL 2 :
SELECT 
  d.id,
  d.title,
  d.status AS doc_status,
  v.status AS version_status,
  d.review_date,
  (d.review_date - CURRENT_DATE)::int AS days_until_review,
  dep.name AS department,
  COUNT(ch.id) AS chunk_count
FROM documents d
JOIN document_versions v ON v.id = d.current_version_id
LEFT JOIN departments dep ON dep.id = d.department_id
LEFT JOIN document_chunks ch ON ch.document_version_id = v.id
WHERE d.title = 'Procédure de traitement des réclamations VIP — Service Client'
GROUP BY d.id, d.title, d.status, v.status, d.review_date, dep.name;


-- 3. Document en échec d'ingestion ("Note de frais scannée — Comptabilité")
-- PREUVE SQL 3 :
SELECT 
  d.id AS document_id,
  d.title,
  d.status AS doc_status,
  v.id AS version_id,
  v.status AS version_status,
  j.status AS job_status,
  j.error_message,
  dep.name AS department
FROM documents d
JOIN document_versions v ON v.id = d.current_version_id
LEFT JOIN ingestion_jobs j ON j.document_version_id = v.id
LEFT JOIN departments dep ON dep.id = d.department_id
WHERE d.title = 'Note de frais scannée — Comptabilité';


-- 4. Compléter 2-3 dates de révision manquantes (2026-2027)
UPDATE documents
SET review_date = '2027-03-15', updated_at = NOW()
WHERE title = 'Politique de retour et remboursement produit'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

UPDATE documents
SET review_date = '2027-01-20', updated_at = NOW()
WHERE title = 'Procédure d''intégration des nouveaux employés'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

UPDATE documents
SET review_date = '2027-04-15', updated_at = NOW()
WHERE title = 'Procédure de gestion des stocks entrepôt'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

UPDATE documents
SET review_date = '2027-06-30', updated_at = NOW()
WHERE title = 'Guide d''utilisation de l''assistant ZEN Knowledge'
  AND company_id = (SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1);

-- PREUVE SQL 4 :
SELECT 
  d.title,
  dep.name AS department,
  d.status,
  d.review_date
FROM documents d
JOIN companies c ON c.id = d.company_id
LEFT JOIN departments dep ON dep.id = d.department_id
WHERE c.name = 'ZEN Retail Tunisia'
  AND d.status != 'deleted'
ORDER BY d.title ASC;
