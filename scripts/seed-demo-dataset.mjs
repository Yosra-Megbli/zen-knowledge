// Demo dataset for grading/evaluation — 14 realistic French documents
// across two fictional companies, uploaded and published through the
// REAL ingestion pipeline (ingestDocument()/publishVersion()), exactly
// as app/api/documents/upload/route.ts and .../publish/route.ts would.
// Unlike db/seed.mjs (hand-inserted chunks, used by the RLS/RAG test
// suites), this script exercises extraction → cleaning → chunking →
// local embedding → publish end-to-end, so it's the right fixture for
// a live demo and for manually verifying the pipeline against
// realistic content.
//
// Companies/users created here are entirely separate from the
// "Acme Corp" / "Nova Bank" test fixtures (tests/integration/rls/helpers.mjs)
// — running this script never touches or duplicates those.
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMigrationClient } from "../db/db.mjs";
import { ingestDocument } from "../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../lib/ingestion/pipeline/publishVersion.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = path.join(__dirname, "..", "dataset");

const DEMO_PASSWORD = "ZenDemo2026!";

const COMPANIES = {
  "ZEN Retail Tunisia": {
    slug: "zen-retail-tunisia",
    domain: "zenretail.example",
    departments: ["RH", "Logistique"],
    users: [
      { role: "admin", department: "RH" },
      { role: "contributor", department: "RH" },
      { role: "employee", department: "Logistique" },
    ],
  },
  "ZEN Home & Lifestyle": {
    slug: "zen-home-lifestyle",
    domain: "zenhomelifestyle.example",
    departments: ["RH", "Design"],
    users: [
      { role: "admin", department: "Design" },
      { role: "contributor", department: "Design" },
      { role: "employee", department: "RH" },
    ],
  },
};

function readDataset(company, fileName) {
  return readFileSync(path.join(DATASET_DIR, company, fileName));
}

async function run() {
  const client = await getMigrationClient();
  try {
    const existing = await client.query(
      `SELECT slug FROM companies WHERE slug = ANY($1)`,
      [Object.values(COMPANIES).map((c) => c.slug)]
    );
    if (existing.rowCount > 0) {
      console.error(
        `Demo dataset companies already exist (${existing.rows.map((r) => r.slug).join(", ")}). ` +
          `Refusing to run twice. Remove them manually first if you want to reseed ` +
          `(DELETE FROM companies WHERE slug IN (...) CASCADE is NOT safe here — ` +
          `documents/document_versions/document_chunks/ingestion_jobs reference company_id ` +
          `without ON DELETE CASCADE by design; delete child rows explicitly).`
      );
      process.exit(1);
    }

    console.log("Creating companies, departments and users...");
    const companies = {};
    const departments = {};
    const users = {};
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    for (const [name, cfg] of Object.entries(COMPANIES)) {
      const { rows } = await client.query(
        `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
        [name, cfg.slug]
      );
      companies[name] = rows[0].id;

      for (const deptName of cfg.departments) {
        const dRes = await client.query(
          `INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING id`,
          [companies[name], deptName]
        );
        departments[`${name}:${deptName}`] = dRes.rows[0].id;
      }

      for (const { role, department } of cfg.users) {
        const uRes = await client.query(
          `INSERT INTO users (company_id, department_id, email, name, role, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, department_id`,
          [
            companies[name],
            departments[`${name}:${department}`],
            `${role}@${cfg.domain}`,
            `${role[0].toUpperCase()}${role.slice(1)} (${name})`,
            role,
            passwordHash,
          ]
        );
        users[`${name}:${role}`] = uRes.rows[0];
      }
    }

    function ctxFor(company, role) {
      const u = users[`${company}:${role}`];
      return { userId: u.id, companyId: companies[company], role, departmentId: u.department_id };
    }

    async function ingestAndPublish({ company, role, fileName, title, description, department, visibility, reviewDate }) {
      const ctx = ctxFor(company, role);
      const result = await ingestDocument({
        ctx,
        fileName,
        data: readDataset(company === "ZEN Retail Tunisia" ? "company-a" : "company-b", fileName),
        target: {
          kind: "new",
          title,
          description: description ?? null,
          departmentId: department ? departments[`${company}:${department}`] : null,
          visibility,
          reviewDate: reviewDate ?? null,
        },
        triggeredBy: "seed-demo-dataset",
      });
      if (result.status !== "completed") {
        throw new Error(`Ingestion failed for "${title}": ${result.errorCode} — ${result.errorMessage}`);
      }
      await publishVersion(ctx, result.documentVersionId);
      console.log(`  ✓ published: ${title}`);
      return result;
    }

    async function ingestNewVersion({ company, role, documentId, fileName }) {
      const ctx = ctxFor(company, role);
      const result = await ingestDocument({
        ctx,
        fileName,
        data: readDataset(company === "ZEN Retail Tunisia" ? "company-a" : "company-b", fileName),
        target: { kind: "version", documentId },
        triggeredBy: "seed-demo-dataset",
      });
      if (result.status !== "completed") {
        throw new Error(`Ingestion of new version failed: ${result.errorCode} — ${result.errorMessage}`);
      }
      await publishVersion(ctx, result.documentVersionId);
      return result;
    }

    console.log("\nIngesting Company A — ZEN Retail Tunisia (7 documents)...");

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A1-code-de-conduite.txt",
      title: "Code de conduite — ZEN Retail Tunisia",
      description: "Principes de conduite professionnelle, valable pour toute l'entreprise.",
      visibility: "company",
    });

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "contributor",
      fileName: "A2-integration-nouveaux-employes.txt",
      title: "Procédure d'intégration des nouveaux employés",
      description: "Onboarding — réservé au département RH.",
      department: "RH",
      visibility: "department",
    });

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A3-gestion-stocks-entrepot.txt",
      title: "Procédure de gestion des stocks entrepôt",
      description: "Réservé au département Logistique.",
      department: "Logistique",
      visibility: "department",
    });

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A4-grille-salariale-2026.txt",
      title: "Grille salariale et primes 2026",
      description: "CONFIDENTIEL — visibilité restreinte aux administrateurs.",
      visibility: "restricted",
    });

    // Versioned document: v1 (2024) published then superseded, v2 (2026)
    // published — publishVersion() on v2 auto-archives v1 (see
    // publishVersion.ts). The two files describe the SAME policy at two
    // points in time, with different numbers (15 -> 30 day return window).
    const a5v1 = await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A5-v1-politique-retour-2024.txt",
      title: "Politique de retour et remboursement produit",
      description: "Version 2024 — sera remplacée par la version 2026.",
      visibility: "company",
    });
    await ingestNewVersion({
      company: "ZEN Retail Tunisia",
      role: "admin",
      documentId: a5v1.documentId,
      fileName: "A5-v2-politique-retour-2026.txt",
    });
    console.log("  ✓ published: Politique de retour et remboursement produit (v2, v1 archived)");

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A6-securite-incendie-entrepot.txt",
      title: "Procédure de sécurité incendie — Entrepôt central",
      description: "Consignes de sécurité incendie applicables à l'entrepôt central.",
      visibility: "company",
      reviewDate: "2024-01-01",
    });

    await ingestAndPublish({
      company: "ZEN Retail Tunisia",
      role: "admin",
      fileName: "A7-guide-assistant-zen-knowledge.txt",
      title: "Guide d'utilisation de l'assistant ZEN Knowledge",
      description: "Guide pratique pour utiliser l'assistant documentaire interne.",
      visibility: "company",
    });

    console.log("\nIngesting Company B — ZEN Home & Lifestyle (7 documents)...");

    await ingestAndPublish({
      company: "ZEN Home & Lifestyle",
      role: "admin",
      fileName: "B1-charte-valeurs.txt",
      title: "Charte des valeurs — ZEN Home & Lifestyle",
      visibility: "company",
    });

    await ingestAndPublish({
      company: "ZEN Home & Lifestyle",
      role: "contributor",
      fileName: "B2-guide-conception-produit-printemps.txt",
      title: "Guide de conception produit — Collection Printemps",
      description: "Réservé au département Design.",
      department: "Design",
      visibility: "department",
    });

    await ingestAndPublish({
      company: "ZEN Home & Lifestyle",
      role: "admin",
      fileName: "B3-rapport-financier-t4-2025.txt",
      title: "Rapport financier confidentiel — T4 2025",
      description: "CONFIDENTIEL — visibilité restreinte aux administrateurs.",
      visibility: "restricted",
    });

    // Deliberate contradiction: B4 and B5 both describe the "standard"
    // delivery time but with different numbers (3-5 vs 7-10 business
    // days) — useful to observe how the RAG layer cites conflicting
    // sources rather than silently picking one.
    await ingestAndPublish({
      company: "ZEN Home & Lifestyle",
      role: "admin",
      fileName: "B4-politique-livraison-standard.txt",
      title: "Politique de livraison — délai standard",
      description: "Politique officielle du service Logistique concernant les délais de livraison.",
      visibility: "company",
    });

    await ingestAndPublish({
      company: "ZEN Home & Lifestyle",
      role: "admin",
      fileName: "B5-faq-livraison.txt",
      title: "FAQ Livraison — Service Client",
      description: "Questions fréquentes du service client au sujet des livraisons.",
      visibility: "company",
    });

    // Ingested but deliberately NEVER published — must stay invisible to
    // retrieval ("Upload != Published").
    {
      const ctx = ctxFor("ZEN Home & Lifestyle", "admin");
      const result = await ingestDocument({
        ctx,
        fileName: "B6-brouillon-nouvelle-politique-retour.txt",
        data: readDataset("company-b", "B6-brouillon-nouvelle-politique-retour.txt"),
        target: {
          kind: "new",
          title: "Brouillon — nouvelle politique de retour",
          description: "Version de travail en cours de relecture, non finalisée.",
          visibility: "company",
        },
        triggeredBy: "seed-demo-dataset",
      });
      if (result.status !== "completed") {
        throw new Error(`Ingestion failed for B6: ${result.errorCode} — ${result.errorMessage}`);
      }
      console.log("  ✓ ingested (deliberately NOT published): Brouillon — nouvelle politique de retour");
    }

    // Published, then soft-deleted — must stay invisible to retrieval.
    {
      const result = await ingestAndPublish({
        company: "ZEN Home & Lifestyle",
        role: "admin",
        fileName: "B7-ancien-reglement-interieur-2022.txt",
        title: "Règlement intérieur — Version 2022 (retiré)",
        description: "Ancien règlement intérieur, remplacé par la version en vigueur.",
        visibility: "company",
      });
      await client.query(`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`, [result.documentId]);
      console.log("  ✓ deleted (soft-delete) after publish: Règlement intérieur — Version 2022 (retiré)");
    }

    console.log("\nDemo dataset seeded: 2 companies, 6 users, 14 source documents.");
    console.log(`Demo login: <role>@<company-domain> / ${DEMO_PASSWORD}`);
    for (const [name, cfg] of Object.entries(COMPANIES)) {
      console.log(`  ${name}: admin@${cfg.domain}, contributor@${cfg.domain}, employee@${cfg.domain}`);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
