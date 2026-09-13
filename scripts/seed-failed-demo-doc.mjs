// Seed / update demo documents for Étape 1 & Étape 3:
// 1) Failed scanned document with error "Document scanné vide — aucun texte extractible"
// 2) Normalisation of "Gestion des incidents clients"
// 3) Review dates variety (overdue, approaching, future)
import { getMigrationClient } from "../db/db.mjs";

async function main() {
  const client = await getMigrationClient();
  try {
    console.log("Connecting to database...");

    // Find ZEN Retail Tunisia
    const compRes = await client.query(`SELECT id FROM companies WHERE name = 'ZEN Retail Tunisia' LIMIT 1`);
    if (compRes.rowCount === 0) {
      console.log("Company 'ZEN Retail Tunisia' not found, skipping.");
      return;
    }
    const companyId = compRes.rows[0].id;

    // Find admin user for owner
    const userRes = await client.query(
      `SELECT id FROM users WHERE company_id = $1 AND role = 'admin' LIMIT 1`,
      [companyId]
    );
    const ownerId = userRes.rows[0]?.id;

    // Find Logistique department
    const deptRes = await client.query(
      `SELECT id FROM departments WHERE company_id = $1 AND name = 'Logistique' LIMIT 1`,
      [companyId]
    );
    const logistiqueDeptId = deptRes.rows[0]?.id ?? null;

    // 1. Check or insert failed scanned document
    const failedDocTitle = "Document scanné vide — Bordereau entrepôt";
    const existingFailed = await client.query(
      `SELECT id FROM documents WHERE company_id = $1 AND title = $2`,
      [companyId, failedDocTitle]
    );

    if (existingFailed.rowCount === 0 && ownerId) {
      console.log(`Creating failed demo document: "${failedDocTitle}"...`);
      const docRes = await client.query(`
        INSERT INTO documents (company_id, department_id, owner_id, title, description, visibility, status)
        VALUES ($1, $2, $3, $4, $5, 'department', 'draft')
        RETURNING id
      `, [
        companyId,
        logistiqueDeptId,
        ownerId,
        failedDocTitle,
        "Exemple de document numérisé/scanné sans couche texte exploitable (échec d'ingestion).",
      ]);
      const docId = docRes.rows[0].id;

      const verRes = await client.query(`
        INSERT INTO document_versions (document_id, company_id, version_number, status, file_key, file_type, uploaded_by)
        VALUES ($1, $2, 1, 'failed', 'pending', 'application/pdf', $3)
        RETURNING id
      `, [docId, companyId, ownerId]);
      const versionId = verRes.rows[0].id;

      await client.query(`
        UPDATE documents SET current_version_id = $1 WHERE id = $2
      `, [versionId, docId]);

      await client.query(`
        INSERT INTO ingestion_jobs (document_version_id, company_id, status, error_code, error_message, triggered_by, started_at, finished_at)
        VALUES ($1, $2, 'failed', 'NO_EXTRACTABLE_TEXT', 'Document scanné vide — aucun texte extractible', 'demo-fixture', now(), now())
      `, [versionId, companyId]);

      console.log(`✓ Created failed document (id: ${docId}, version: ${versionId})`);
    } else {
      console.log(`Failed document "${failedDocTitle}" already exists or updated.`);
    }

    // 2. Normalize "Gestion des incidents clients" if duplicates exist
    const incidentDocs = await client.query(`
      SELECT id, title, visibility, department_id FROM documents
      WHERE title ILIKE '%incident%' AND company_id = $1
      ORDER BY created_at ASC
    `, [companyId]);

    if (incidentDocs.rows.length >= 2) {
      console.log("Renaming duplicate incident documents to distinct realistic titles...");
      for (const d of incidentDocs.rows) {
        if (d.visibility === "department") {
          await client.query(
            `UPDATE documents SET title = 'Gestion des incidents clients — Service Client' WHERE id = $1`,
            [d.id]
          );
        } else {
          await client.query(
            `UPDATE documents SET title = 'Gestion des incidents clients — Groupe (politique générale)' WHERE id = $1`,
            [d.id]
          );
        }
      }
    }

    // 3. Ensure realistic review dates for demo
    // a) 1 overdue document (< CURRENT_DATE): "Procédure de sécurité incendie — Entrepôt central"
    await client.query(`
      UPDATE documents
      SET review_date = '2024-06-15'
      WHERE company_id = $1 AND title ILIKE '%sécurité incendie%'
    `, [companyId]);

    // b) 1 approaching document (~15 days in future: CURRENT_DATE + 15 days):
    await client.query(`
      UPDATE documents
      SET review_date = (CURRENT_DATE + INTERVAL '15 days')::date
      WHERE company_id = $1 AND title ILIKE '%Code de conduite%'
    `, [companyId]);

    // c) Other documents set to 2027 so they don't produce false positives in /admin/obsolete:
    await client.query(`
      UPDATE documents
      SET review_date = '2027-06-30'
      WHERE company_id = $1
        AND title NOT ILIKE '%sécurité incendie%'
        AND title NOT ILIKE '%Code de conduite%'
        AND review_date IS NULL
    `, [companyId]);

    console.log("✓ Demo dataset metadata and review dates successfully configured.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Error updating demo metadata:", err);
  process.exit(1);
});
