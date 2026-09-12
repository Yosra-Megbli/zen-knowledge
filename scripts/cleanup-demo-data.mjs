// One-off: apply the LOT 1 fixes directly to the PRODUCTION database,
// without re-running the full seed (which refuses to run twice — see
// seed-production-dataset.mjs). Scoped strictly to the exact rows
// below by id; touches nothing else.
//
// 1. Deletes the "y" document — a leftover test artifact from an
//    earlier debugging session, never part of the real demo dataset.
// 2. Rewrites 6 document descriptions that leaked developer/meta
//    commentary ("volontairement", "pour tester W3", "test
//    d'injection de prompt") into user-facing text — the underlying
//    test scenarios (contradiction, obsolescence, injection, deleted
//    doc) stay exactly as-is in the actual file content; only the
//    description field changes to what a real company would write.
//
// Requires SUPABASE_DIRECT_URL in .env.local.
// Run with: node --env-file-if-exists=.env.local scripts/cleanup-demo-data.mjs
import { Client } from "pg";

const POLLUTION_DOC_ID = "f37791c2-2967-4e78-a7ef-72730a60ec3f"; // title "y"

const DESCRIPTION_FIXES = [
  {
    id: "7bf5110c-c2a0-4f28-af18-ce4d2d073908", // A6 — sécurité incendie
    description: "Consignes de sécurité incendie applicables à l'entrepôt central.",
  },
  {
    id: "69486f8b-7c44-40ac-8a3a-263d84a133da", // A7 — guide assistant
    description: "Guide pratique pour utiliser l'assistant documentaire interne.",
  },
  {
    id: "7a5f2f23-9615-4e85-99c9-af894edfe713", // B4 — politique livraison
    description: "Politique officielle du service Logistique concernant les délais de livraison.",
  },
  {
    id: "bbb133df-4b88-456e-93bb-22ff0090f90c", // B5 — FAQ livraison
    description: "Questions fréquentes du service client au sujet des livraisons.",
  },
  {
    id: "f07d19e6-b9a1-4938-b06d-4b4bf7c2b9b0", // B6 — brouillon
    description: "Version de travail en cours de relecture, non finalisée.",
  },
  {
    id: "f241be68-9b55-4bbb-8120-d2ebe3777165", // B7 — règlement intérieur (deleted)
    description: "Ancien règlement intérieur, remplacé par la version en vigueur.",
  },
];

async function run() {
  if (!process.env.SUPABASE_DIRECT_URL) {
    console.error("SUPABASE_DIRECT_URL is not set — required. Check .env.local.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.SUPABASE_DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`Deleting pollution document ${POLLUTION_DOC_ID} ("y")...`);
    await client.query(
      `DELETE FROM document_chunks WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(
      `DELETE FROM ingestion_jobs WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(
      `DELETE FROM citations WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(`UPDATE documents SET current_version_id = NULL WHERE id = $1`, [POLLUTION_DOC_ID]);
    await client.query(`DELETE FROM document_versions WHERE document_id = $1`, [POLLUTION_DOC_ID]);
    const del = await client.query(`DELETE FROM documents WHERE id = $1`, [POLLUTION_DOC_ID]);
    console.log(`  ✓ deleted (${del.rowCount} document row)`);

    console.log("\nRewriting meta descriptions to in-world text...");
    for (const fix of DESCRIPTION_FIXES) {
      const res = await client.query(
        `UPDATE documents SET description = $1 WHERE id = $2 RETURNING title`,
        [fix.description, fix.id]
      );
      if (res.rowCount === 0) {
        console.warn(`  ! no document found for id ${fix.id} — skipped`);
      } else {
        console.log(`  ✓ ${res.rows[0].title}`);
      }
    }

    console.log("\nDone.");
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
