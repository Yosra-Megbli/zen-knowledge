// One-off / re-runnable: seed the SAME demo dataset as
// scripts/seed-demo-dataset.mjs (dataset/company-a, dataset/company-b)
// into the PRODUCTION Supabase database, through the real
// ingestDocument()/publishVersion() pipeline. Adapted only in how it
// connects — the document list and ingestion logic are identical to
// seed-demo-dataset.mjs, kept in sync manually since there are only 14
// documents.
//
// Connection strategy:
// - Company/department/user creation and the final soft-delete UPDATE
//   use a direct pg.Client against SUPABASE_DIRECT_URL (the Supabase
//   'postgres' superuser) — same administrative-seeding justification
//   already established for db/seed.mjs ("runs as migration_role:
//   seeding is administrative maintenance, not a runtime user
//   action").
// - ingestDocument()/publishVersion() internally call getAppPool(),
//   which honors DATABASE_URL when set. Pointing DATABASE_URL at the
//   same Supabase superuser connection for this process only (never
//   written to .env.local or Vercel's own env vars, which keep using
//   app_role for real runtime traffic) means those calls also run as
//   postgres for this one script; postgres bypasses RLS by nature
//   (superuser property), so the SET LOCAL app.* context calls become
//   harmless no-ops and every INSERT still succeeds correctly.
//
// Requires SUPABASE_DIRECT_URL in .env.local (Settings → Database →
// Connection string → URI, Session mode, port 5432 — NOT the pooler).
// Run with: node --env-file-if-exists=.env.local scripts/seed-production-dataset.mjs
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { ingestDocument } from "../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../lib/ingestion/pipeline/publishVersion.ts";

process.env.NODE_ENV = "production"; // lib/db/appPool.ts enables ssl for the DATABASE_URL branch only in production
if (!process.env.SUPABASE_DIRECT_URL) {
  console.error("SUPABASE_DIRECT_URL is not set — required to seed production. Check .env.local.");
  process.exit(1);
}
process.env.DATABASE_URL = process.env.SUPABASE_DIRECT_URL;

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
  const client = new Client({ connectionString: process.env.SUPABASE_DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const existing = await client.query(
      `SELECT slug FROM companies WHERE slug = ANY($1)`,
      [Object.values(COMPANIES).map((c) => c.slug)]
    );
    if (existing.rowCount > 0) {
      console.error(
        `Demo dataset companies already exist in production (${existing.rows.map((r) => r.slug).join(", ")}). ` +
          `Refusing to run twice.`
      );
      process.exit(1);
    }

    console.log("Creating companies, departments and users in PRODUCTION Supabase...");
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
        triggeredBy: "seed-production-dataset",
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
        triggeredBy: "seed-production-dataset",
      });
      if (result.status !== "completed") {
        throw new Error(`Ingestion of new version failed: ${result.errorCode} — ${result.errorMessage}`);
      }
      await publishVersion(ctx, result.documentVersionId);
      return result;
    }

    console.log("\nIngesting Company A — ZEN Retail Tunisia (7 documents)...");

    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A1-code-de-conduite.txt",
      title: "Code de conduite — ZEN Retail Tunisia",
      description: "Principes de conduite professionnelle, valable pour toute l'entreprise.",
      visibility: "company",
    });
    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "contributor", fileName: "A2-integration-nouveaux-employes.txt",
      title: "Procédure d'intégration des nouveaux employés",
      description: "Onboarding — réservé au département RH.", department: "RH", visibility: "department",
    });
    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A3-gestion-stocks-entrepot.txt",
      title: "Procédure de gestion des stocks entrepôt",
      description: "Réservé au département Logistique.", department: "Logistique", visibility: "department",
    });
    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A4-grille-salariale-2026.txt",
      title: "Grille salariale et primes 2026",
      description: "CONFIDENTIEL — visibilité restreinte aux administrateurs.", visibility: "restricted",
    });
    const a5v1 = await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A5-v1-politique-retour-2024.txt",
      title: "Politique de retour et remboursement produit",
      description: "Version 2024 — sera remplacée par la version 2026.", visibility: "company",
    });
    await ingestNewVersion({
      company: "ZEN Retail Tunisia", role: "admin", documentId: a5v1.documentId,
      fileName: "A5-v2-politique-retour-2026.txt",
    });
    console.log("  ✓ published: Politique de retour et remboursement produit (v2, v1 archived)");
    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A6-securite-incendie-entrepot.txt",
      title: "Procédure de sécurité incendie — Entrepôt central",
      description: "review_date volontairement ancienne pour tester W3 (obsolescence).",
      visibility: "company", reviewDate: "2024-01-01",
    });
    await ingestAndPublish({
      company: "ZEN Retail Tunisia", role: "admin", fileName: "A7-guide-assistant-zen-knowledge.txt",
      title: "Guide d'utilisation de l'assistant ZEN Knowledge",
      description: "Contient un test d'injection de prompt intégré au texte source.", visibility: "company",
    });

    console.log("\nIngesting Company B — ZEN Home & Lifestyle (7 documents)...");

    await ingestAndPublish({
      company: "ZEN Home & Lifestyle", role: "admin", fileName: "B1-charte-valeurs.txt",
      title: "Charte des valeurs — ZEN Home & Lifestyle", visibility: "company",
    });
    await ingestAndPublish({
      company: "ZEN Home & Lifestyle", role: "contributor", fileName: "B2-guide-conception-produit-printemps.txt",
      title: "Guide de conception produit — Collection Printemps",
      description: "Réservé au département Design.", department: "Design", visibility: "department",
    });
    await ingestAndPublish({
      company: "ZEN Home & Lifestyle", role: "admin", fileName: "B3-rapport-financier-t4-2025.txt",
      title: "Rapport financier confidentiel — T4 2025",
      description: "CONFIDENTIEL — visibilité restreinte aux administrateurs.", visibility: "restricted",
    });
    await ingestAndPublish({
      company: "ZEN Home & Lifestyle", role: "admin", fileName: "B4-politique-livraison-standard.txt",
      title: "Politique de livraison — délai standard",
      description: "Document officiel Logistique. Volontairement en contradiction avec la FAQ Service Client (B5).",
      visibility: "company",
    });
    await ingestAndPublish({
      company: "ZEN Home & Lifestyle", role: "admin", fileName: "B5-faq-livraison.txt",
      title: "FAQ Livraison — Service Client",
      description: "Document Service Client. Volontairement en contradiction avec la politique officielle (B4).",
      visibility: "company",
    });

    {
      const ctx = ctxFor("ZEN Home & Lifestyle", "admin");
      const result = await ingestDocument({
        ctx, fileName: "B6-brouillon-nouvelle-politique-retour.txt",
        data: readDataset("company-b", "B6-brouillon-nouvelle-politique-retour.txt"),
        target: {
          kind: "new", title: "Brouillon — nouvelle politique de retour",
          description: "Volontairement laissé non publié pour vérifier 'Upload != Published'.",
          visibility: "company",
        },
        triggeredBy: "seed-production-dataset",
      });
      if (result.status !== "completed") throw new Error(`Ingestion failed for B6: ${result.errorCode} — ${result.errorMessage}`);
      console.log("  ✓ ingested (deliberately NOT published): Brouillon — nouvelle politique de retour");
    }

    {
      const result = await ingestAndPublish({
        company: "ZEN Home & Lifestyle", role: "admin", fileName: "B7-ancien-reglement-interieur-2022.txt",
        title: "Règlement intérieur — Version 2022 (retiré)",
        description: "Publié puis supprimé pour vérifier que RLS bloque bien les documents supprimés.",
        visibility: "company",
      });
      await client.query(`UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`, [result.documentId]);
      console.log("  ✓ deleted (soft-delete) after publish: Règlement intérieur — Version 2022 (retiré)");
    }

    console.log("\nProduction demo dataset seeded: 2 companies, 6 users, 14 source documents.");
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
