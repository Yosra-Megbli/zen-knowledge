#!/usr/bin/env node
/**
 * db/supabase/seed-supabase.mjs
 *
 * Seed the Supabase database using DATABASE_URL (direct connection, port 5432).
 * Uses the same data as db/seed.mjs but connects via a single connection string.
 *
 * Usage:
 *   SUPABASE_DIRECT_URL=postgresql://postgres:<password>@<host>:5432/postgres \
 *   APP_ROLE_PASSWORD=<your-app-role-password> \
 *   node db/supabase/seed-supabase.mjs
 *
 * Or add to .env.local:
 *   SUPABASE_DIRECT_URL=...
 * then run: node --env-file=.env.local db/supabase/seed-supabase.mjs
 */

import { Client } from "pg";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", "..", ".env.local") });

const connectionString = process.env.SUPABASE_DIRECT_URL;
if (!connectionString) {
  console.error("Missing SUPABASE_DIRECT_URL in .env.local");
  console.error("Format: postgresql://postgres:<password>@<host>:5432/postgres");
  process.exit(1);
}

// Import embeddings — needs the app's TypeScript via Node's --experimental-strip-types
// or pre-compiled. For simplicity, use zero vectors for Supabase seed
// (real embeddings require the model download which is slow in CI/remote).
// Set REAL_EMBEDDINGS=1 to use actual local embeddings.
const USE_REAL_EMBEDDINGS = process.env.REAL_EMBEDDINGS === "1";

let embedPassage;
if (USE_REAL_EMBEDDINGS) {
  const mod = await import("../../lib/embeddings/index.ts");
  embedPassage = mod.embedPassage;
} else {
  // 384-dimension zero vector — sufficient for schema validation,
  // not for semantic search. Run with REAL_EMBEDDINGS=1 for a working demo.
  embedPassage = async () => new Array(384).fill(0);
  console.warn("Using zero vectors. Set REAL_EMBEDDINGS=1 for real embeddings (slower).");
}

const COMPANY_NAMES = ["Acme Corp", "Nova Bank"];
const DEPARTMENTS = ["RH", "IT"];
const ROLE_DEPARTMENT = [
  ["admin", "IT"],
  ["contributor", "RH"],
  ["employee", "RH"],
];
const DEMO_PASSWORD = "ZenDemo2026!";

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  console.log("Seeding Supabase demo data...");

  const companies = {};
  for (const name of COMPANY_NAMES) {
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const { rows } = await client.query(
      `INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id`,
      [name, slug]
    );
    companies[name] = rows[0].id;
  }

  const departments = {};
  for (const company of COMPANY_NAMES) {
    for (const deptName of DEPARTMENTS) {
      const { rows } = await client.query(
        `INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING id`,
        [companies[company], deptName]
      );
      departments[`${company}:${deptName}`] = rows[0].id;
    }
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = {};
  for (const company of COMPANY_NAMES) {
    for (const [role, dept] of ROLE_DEPARTMENT) {
      const domain = company.toLowerCase().replace(/\s+/g, "");
      const { rows } = await client.query(
        `INSERT INTO users (company_id, department_id, email, name, role, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          companies[company],
          departments[`${company}:${dept}`],
          `${role}@${domain}.example`,
          `${role[0].toUpperCase()}${role.slice(1)} (${company})`,
          role,
          passwordHash,
        ]
      );
      users[`${company}:${role}`] = rows[0].id;
    }
  }

  async function insertDoc(company, title, visibility, status, dept, deletedAt = null, reviewDate = null) {
    const { rows } = await client.query(
      `INSERT INTO documents (company_id, department_id, owner_id, title, visibility, status, deleted_at, review_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [companies[company], dept ? departments[`${company}:${dept}`] : null,
       users[`${company}:admin`], title, visibility, status, deletedAt, reviewDate]
    );
    return rows[0].id;
  }

  async function insertVersion(documentId, company, versionNumber, status) {
    const publishedAt = status === "published" ? new Date() : null;
    const archivedAt = status === "archived" ? new Date() : null;
    const { rows } = await client.query(
      `INSERT INTO document_versions
         (document_id, company_id, version_number, status, file_key, file_type, uploaded_by, published_at, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [documentId, companies[company], versionNumber, status,
       `seed/${documentId}/v${versionNumber}.pdf`, "application/pdf",
       users[`${company}:admin`], publishedAt, archivedAt]
    );
    return rows[0].id;
  }

  async function insertChunks(versionId, contents) {
    for (let i = 0; i < contents.length; i++) {
      const embedding = await embedPassage(contents[i]);
      await client.query(
        `INSERT INTO document_chunks (document_version_id, chunk_index, content, page_number, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [versionId, i, contents[i], i + 1, `[${embedding.join(",")}]`]
      );
    }
  }

  for (const company of COMPANY_NAMES) {
    const d1 = await insertDoc(company, "Guide onboarding", "company", "published", "RH");
    const v1 = await insertVersion(d1, company, 1, "published");
    await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [v1, d1]);
    await insertChunks(v1, [
      "Le guide d'onboarding explique les étapes pour rejoindre l'entreprise : accès aux outils, présentation des équipes et premiers rendez-vous.",
      "Chaque nouvel employé dispose d'un parrain pendant les deux premières semaines pour faciliter son intégration.",
    ]);

    const d2 = await insertDoc(company, "Politique salariale", "restricted", "published", "RH");
    const v2 = await insertVersion(d2, company, 1, "published");
    await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [v2, d2]);
    await insertChunks(v2, [
      "La politique salariale définit les grilles de rémunération par poste et les critères d'augmentation annuelle.",
    ]);

    const d3 = await insertDoc(company, "Procédure IT interne", "department", "published", "IT");
    const v3 = await insertVersion(d3, company, 1, "published");
    await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [v3, d3]);
    await insertChunks(v3, [
      "La procédure informatique interne décrit la marche à suivre pour demander un accès serveur ou signaler un incident.",
    ]);

    const d4 = await insertDoc(company, "Brouillon en cours", "company", "draft", "RH");
    await insertVersion(d4, company, 1, "processing");

    const d5 = await insertDoc(company, "Document supprimé", "company", "deleted", "RH", new Date());
    await insertVersion(d5, company, 1, "archived");

    const d6 = await insertDoc(company, "Manuel avec versions", "company", "published", "IT");
    await insertVersion(d6, company, 1, "archived");
    const v6b = await insertVersion(d6, company, 2, "published");
    await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [v6b, d6]);
    await insertChunks(v6b, ["Version 2 (courante) du manuel — la sauvegarde est désormais automatisée quotidiennement."]);

    const d7 = await insertDoc(company, "Procédure obsolète", "company", "published", "RH", null, "2025-01-01");
    const v7 = await insertVersion(d7, company, 1, "published");
    await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [v7, d7]);
    await insertChunks(v7, ["Cette procédure n'a pas été révisée depuis longtemps et devrait être mise à jour prochainement."]);
  }

  console.log("✅ Seed complete: 2 companies, 3 users each, 7 documents each.");
  console.log(`Demo login: admin@acmecorp.example / ${DEMO_PASSWORD}`);
} finally {
  await client.end();
}
