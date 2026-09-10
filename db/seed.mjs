// Fictional demo data only — no real company, person, or document.
// Runs as migration_role (superuser): seeding is administrative
// maintenance, not a runtime user action, and needs to write data for
// BOTH companies in one script. Every RLS test in
// tests/integration/rls/ then reads this same data back through
// app_role to prove isolation actually holds.
import { getMigrationClient } from "./db.mjs";

const COMPANY_NAMES = ["Acme Corp", "Nova Bank"];
const DEPARTMENTS = ["RH", "IT"];
const ROLE_DEPARTMENT = [
  ["admin", "IT"],
  ["contributor", "RH"],
  ["employee", "RH"],
];

async function run() {
  const client = await getMigrationClient();
  try {
    console.log("Seeding demo data...");

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

    const users = {};
    for (const company of COMPANY_NAMES) {
      for (const [role, dept] of ROLE_DEPARTMENT) {
        const domain = company.toLowerCase().replace(/\s+/g, "");
        const { rows } = await client.query(
          `INSERT INTO users (company_id, department_id, email, name, role)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, department_id`,
          [
            companies[company],
            departments[`${company}:${dept}`],
            `${role}@${domain}.example`,
            `${role[0].toUpperCase()}${role.slice(1)} (${company})`,
            role,
          ]
        );
        users[`${company}:${role}`] = rows[0];
      }
    }

    async function insertDocument({ company, title, visibility, status, department, deletedAt = null, reviewDate = null }) {
      const { rows } = await client.query(
        `INSERT INTO documents (company_id, department_id, owner_id, title, visibility, status, deleted_at, review_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          companies[company],
          department ? departments[`${company}:${department}`] : null,
          users[`${company}:admin`].id,
          title,
          visibility,
          status,
          deletedAt,
          reviewDate,
        ]
      );
      return rows[0].id;
    }

    async function insertVersion({ documentId, company, versionNumber, status }) {
      const publishedAt = status === "published" ? new Date() : null;
      const archivedAt = status === "archived" ? new Date() : null;
      const { rows } = await client.query(
        `INSERT INTO document_versions
           (document_id, company_id, version_number, status, file_key, file_type, uploaded_by, published_at, archived_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          documentId,
          companies[company],
          versionNumber,
          status,
          `seed/${documentId}/v${versionNumber}.pdf`,
          "application/pdf",
          users[`${company}:admin`].id,
          publishedAt,
          archivedAt,
        ]
      );
      return rows[0].id;
    }

    async function setCurrentVersion(documentId, versionId) {
      await client.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [versionId, documentId]);
    }

    async function insertChunks(versionId, count = 2) {
      for (let i = 0; i < count; i++) {
        await client.query(
          `INSERT INTO document_chunks (document_version_id, chunk_index, content, page_number)
           VALUES ($1, $2, $3, $4)`,
          [versionId, i, `[Fictional demo content] Chunk ${i} of version ${versionId}.`, i + 1]
        );
      }
    }

    for (const company of COMPANY_NAMES) {
      // 1. Company-wide published document.
      const doc1 = await insertDocument({ company, title: "Guide onboarding", visibility: "company", status: "published", department: "RH" });
      const v1 = await insertVersion({ documentId: doc1, company, versionNumber: 1, status: "published" });
      await setCurrentVersion(doc1, v1);
      await insertChunks(v1);

      // 2. Restricted document (admin role only).
      const doc2 = await insertDocument({ company, title: "Politique salariale", visibility: "restricted", status: "published", department: "RH" });
      const v2 = await insertVersion({ documentId: doc2, company, versionNumber: 1, status: "published" });
      await setCurrentVersion(doc2, v2);
      await insertChunks(v2);

      // 3. Department-restricted document (IT only).
      const doc3 = await insertDocument({ company, title: "Procédure IT interne", visibility: "department", status: "published", department: "IT" });
      const v3 = await insertVersion({ documentId: doc3, company, versionNumber: 1, status: "published" });
      await setCurrentVersion(doc3, v3);
      await insertChunks(v3);

      // 4. Draft / unpublished document.
      const doc4 = await insertDocument({ company, title: "Brouillon en cours", visibility: "company", status: "draft", department: "RH" });
      const v4 = await insertVersion({ documentId: doc4, company, versionNumber: 1, status: "processing" });
      await insertChunks(v4);

      // 5. Deleted document.
      const doc5 = await insertDocument({ company, title: "Document supprimé", visibility: "company", status: "deleted", department: "RH", deletedAt: new Date() });
      const v5 = await insertVersion({ documentId: doc5, company, versionNumber: 1, status: "archived" });
      await insertChunks(v5);

      // 6. Multi-version document — v1 archived, v2 published/current.
      const doc6 = await insertDocument({ company, title: "Manuel avec versions", visibility: "company", status: "published", department: "IT" });
      const v6a = await insertVersion({ documentId: doc6, company, versionNumber: 1, status: "archived" });
      const v6b = await insertVersion({ documentId: doc6, company, versionNumber: 2, status: "published" });
      await setCurrentVersion(doc6, v6b);
      await insertChunks(v6a);
      await insertChunks(v6b);

      // 7. Published but obsolete (review date long passed).
      const doc7 = await insertDocument({ company, title: "Procédure obsolète", visibility: "company", status: "published", department: "RH", reviewDate: "2025-01-01" });
      const v7 = await insertVersion({ documentId: doc7, company, versionNumber: 1, status: "published" });
      await setCurrentVersion(doc7, v7);
      await insertChunks(v7);
    }

    console.log("Seed complete: 2 companies, 2 departments each, 3 users each, 7 documents each.");
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
