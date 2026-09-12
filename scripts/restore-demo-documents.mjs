// scripts/restore-demo-documents.mjs
// Restauration idempotente des 2 documents de démo supprimés :
//   a) « Politique de retour et remboursement produit » (v1 archivée, v2 publiée)
//   b) « Guide d'utilisation de l'assistant ZEN Knowledge » (v1 publiée)
//
// Usage :
//   Dry-run (défaut) : node --env-file-if-exists=.env.local scripts/restore-demo-documents.mjs
//   Exécution réelle : node --env-file-if-exists=.env.local scripts/restore-demo-documents.mjs --apply
//
// Note : Si la connexion directe pg timeout depuis votre poste (blocage réseau/firewall),
// utilisez l'artefact primaire SQL : scripts/restore-demo-documents.sql dans le SQL Editor Supabase.

import { Client } from "pg";

const TARGET_COMPANY = "ZEN Retail Tunisia";
const DOC_TITLES = [
  "Politique de retour et remboursement produit",
  "Guide d'utilisation de l'assistant ZEN Knowledge",
];

async function main() {
  const connectionString = process.env.SUPABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERREUR : SUPABASE_DIRECT_URL ou DATABASE_URL non configuré dans .env.local");
    console.error("Veuillez utiliser scripts/restore-demo-documents.sql dans le SQL Editor Supabase.");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  console.log(`=== Restauration des documents de démo [${apply ? "MODE RÉEL --apply" : "MODE DRY-RUN"}] ===\n`);

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("Impossible d'établir une connexion directe PostgreSQL :", err.message);
    console.error("\n👉 RECOMMANDATION : Exécutez l'artefact primaire directement dans le SQL Editor Supabase :");
    console.error("   scripts/restore-demo-documents.sql\n");
    process.exit(1);
  }

  try {
    // 1. Contrôle préalable
    console.log("1. État actuel des documents cibles :");
    const beforeRes = await client.query(`
      SELECT 
        d.id, d.title, d.status, d.deleted_at,
        v.version_number, v.status as version_status,
        COUNT(c.id) as chunk_count
      FROM documents d
      JOIN companies comp ON comp.id = d.company_id
      LEFT JOIN document_versions v ON v.document_id = d.id
      LEFT JOIN document_chunks c ON c.document_version_id = v.id
      WHERE comp.name = $1 AND d.title = ANY($2::text[])
      GROUP BY d.id, d.title, d.status, d.deleted_at, v.version_number, v.status
      ORDER BY d.title, v.version_number
    `, [TARGET_COMPANY, DOC_TITLES]);

    if (beforeRes.rows.length === 0) {
      console.log("   Aucun document trouvé avec ces titres pour la compagnie", TARGET_COMPANY);
    } else {
      for (const row of beforeRes.rows) {
        console.log(`   - [${row.status}] "${row.title}" (v${row.version_number}: ${row.version_status}, chunks: ${row.chunk_count})`);
      }
    }

    if (!apply) {
      console.log("\n[DRY-RUN] Aucune modification effectuée en base.");
      console.log("Pour appliquer ces modifications en direct :");
      console.log("  node --env-file-if-exists=.env.local scripts/restore-demo-documents.mjs --apply");
      console.log("Ou collez scripts/restore-demo-documents.sql dans le SQL Editor Supabase.");
      return;
    }

    // 2. Application si --apply
    console.log("\n2. Application des restaurations...");
    await client.query("BEGIN");

    // a) Restauration de Politique de retour
    const resA = await client.query(`
      UPDATE documents
      SET status = 'published', deleted_at = NULL, updated_at = now()
      WHERE title = 'Politique de retour et remboursement produit'
        AND status = 'deleted'
        AND company_id = (SELECT id FROM companies WHERE name = $1 LIMIT 1)
      RETURNING id, title
    `, [TARGET_COMPANY]);

    if (resA.rowCount > 0) {
      console.log(`   ✓ Document restauré : "${resA.rows[0].title}"`);
      // Sécurisation versions
      await client.query(`
        UPDATE document_versions SET status = 'archived'
        WHERE document_id = $1 AND version_number = 1 AND status != 'archived'
      `, [resA.rows[0].id]);
      await client.query(`
        UPDATE document_versions SET status = 'published'
        WHERE document_id = $1 AND version_number = 2 AND status != 'published'
      `, [resA.rows[0].id]);
      console.log(`   ✓ Versions sécurisées : v1 = archived, v2 = published`);
    } else {
      console.log(`   - "Politique de retour et remboursement produit" déjà publiée ou non supprimée.`);
    }

    // b) Restauration de Guide d'utilisation
    const resB = await client.query(`
      UPDATE documents
      SET status = 'published', deleted_at = NULL, updated_at = now()
      WHERE title = 'Guide d''utilisation de l''assistant ZEN Knowledge'
        AND status = 'deleted'
        AND company_id = (SELECT id FROM companies WHERE name = $1 LIMIT 1)
      RETURNING id, title
    `, [TARGET_COMPANY]);

    if (resB.rowCount > 0) {
      console.log(`   ✓ Document restauré : "${resB.rows[0].title}"`);
      await client.query(`
        UPDATE document_versions SET status = 'published'
        WHERE document_id = $1 AND version_number = 1 AND status != 'published'
      `, [resB.rows[0].id]);
      console.log(`   ✓ Version sécurisée : v1 = published`);
    } else {
      console.log(`   - "Guide d'utilisation de l'assistant ZEN Knowledge" déjà publié ou non supprimé.`);
    }

    await client.query("COMMIT");
    console.log("\n3. Restauration terminée avec succès !");

  } finally {
    await client.end();
  }
}

main().catch(console.error);
