// One-off spot-check of the demo dataset through the real retrieval
// layer (not raw SQL) — confirms the specific documents/users created
// by seed-demo-dataset.mjs behave as intended before handing the
// dataset off for the functional test campaign.
import { getMigrationClient } from "../db/db.mjs";
import { retrieveAuthorizedChunks } from "../lib/rag/retrieveAuthorizedChunks.ts";

async function ctxFor(client, email) {
  const { rows } = await client.query(
    `SELECT id, company_id, role, department_id FROM users WHERE email = $1`,
    [email]
  );
  const u = rows[0];
  return { userId: u.id, companyId: u.company_id, role: u.role, departmentId: u.department_id };
}

async function run() {
  const client = await getMigrationClient();
  try {
    const aAdmin = await ctxFor(client, "admin@zenretail.example");
    const aContributor = await ctxFor(client, "contributor@zenretail.example");
    const bAdmin = await ctxFor(client, "admin@zenhomelifestyle.example");
    const bContributor = await ctxFor(client, "contributor@zenhomelifestyle.example");
    const bEmployee = await ctxFor(client, "employee@zenhomelifestyle.example");

    async function docIdsFor(ctx, query) {
      const { chunks } = await retrieveAuthorizedChunks(ctx, query, { minSimilarity: -1, k: 1000 });
      return new Set(chunks.map((c) => c.documentId));
    }

    async function docId(title) {
      const { rows } = await client.query(`SELECT id FROM documents WHERE title = $1`, [title]);
      return rows[0]?.id ?? null;
    }

    const checks = [];

    // 1. Deleted doc (B7) never retrievable, even by admin.
    const b7Id = await docId("Règlement intérieur — Version 2022 (retiré)");
    const bAdminDocs = await docIdsFor(bAdmin, "règlement intérieur horaires télétravail sanctions");
    checks.push(["B7 (deleted) invisible to B-admin", !bAdminDocs.has(b7Id)]);

    // 2. Draft/unpublished doc (B6) never retrievable, even by admin.
    const b6Id = await docId("Brouillon — nouvelle politique de retour");
    const bAdminDocs2 = await docIdsFor(bAdmin, "brouillon retour 21 jours collecte domicile gratuite");
    checks.push(["B6 (draft, never published) invisible to B-admin", !bAdminDocs2.has(b6Id)]);

    // 3. Department visibility: B2 (Design) visible to Design contributor, not to RH employee.
    const b2Id = await docId("Guide de conception produit — Collection Printemps");
    const bContribDocs = await docIdsFor(bContributor, "collection printemps rotin lin bois chêne matériaux");
    const bEmpDocs = await docIdsFor(bEmployee, "collection printemps rotin lin bois chêne matériaux");
    checks.push(["B2 (Design dept) visible to B-contributor (Design)", bContribDocs.has(b2Id)]);
    checks.push(["B2 (Design dept) NOT visible to B-employee (RH)", !bEmpDocs.has(b2Id)]);

    // 4. Restricted visibility: A4 visible to A-admin, not to A-contributor.
    const a4Id = await docId("Grille salariale et primes 2026");
    const aAdminDocs = await docIdsFor(aAdmin, "grille salariale primes augmentation 2026 dinars");
    const aContribDocs = await docIdsFor(aContributor, "grille salariale primes augmentation 2026 dinars");
    checks.push(["A4 (restricted) visible to A-admin", aAdminDocs.has(a4Id)]);
    checks.push(["A4 (restricted) NOT visible to A-contributor", !aContribDocs.has(a4Id)]);

    // 5. Cross-company isolation: A-admin never sees B's documents.
    const b3Id = await docId("Rapport financier confidentiel — T4 2025");
    const aAdminSearchB = await docIdsFor(aAdmin, "chiffre affaires marge résultat net trésorerie");
    checks.push(["B3 (Company B restricted) NOT visible to A-admin (cross-company)", !aAdminSearchB.has(b3Id)]);

    // 6. Versioned doc: current published version (v2, 30 jours) retrievable;
    // its content differs from the archived v1 (15 jours) — check the
    // retrieved chunk content mentions 30, not 15, as the current figure.
    const versionedChunks = await retrieveAuthorizedChunks(aAdmin, "délai de retour produit jours calendaires", {
      minSimilarity: -1,
      k: 5,
    });
    const mentionsCurrentFigure = versionedChunks.chunks.some((c) => c.content.includes("30 jours"));
    checks.push(["Versioned doc: retrieval surfaces the CURRENT (v2, 30 jours) figure", mentionsCurrentFigure]);

    let allPass = true;
    for (const [label, ok] of checks) {
      console.log(`${ok ? "✓" : "✗"} ${label}`);
      if (!ok) allPass = false;
    }
    process.exit(allPass ? 0 : 1);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
