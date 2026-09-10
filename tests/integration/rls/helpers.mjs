// Reads back the fixtures created by db/seed.mjs, using migration_role
// (read-only lookup, bypasses RLS — this is test setup, not the thing
// under test).
import { getMigrationClient } from "../../../db/db.mjs";

export async function fixtures() {
  const client = await getMigrationClient();
  try {
    const companies = {};
    for (const name of ["Acme Corp", "Nova Bank"]) {
      const { rows } = await client.query(`SELECT id FROM companies WHERE name = $1`, [name]);
      if (!rows[0]) throw new Error(`Seed data missing: company "${name}". Run npm run db:seed first.`);
      companies[name] = rows[0].id;
    }

    const users = {};
    const departments = {};
    const documents = {};

    for (const [company, companyId] of Object.entries(companies)) {
      const userRows = (await client.query(`SELECT id, role, department_id FROM users WHERE company_id = $1`, [companyId])).rows;
      for (const row of userRows) users[`${company}:${row.role}`] = row;

      const deptRows = (await client.query(`SELECT id, name FROM departments WHERE company_id = $1`, [companyId])).rows;
      for (const row of deptRows) departments[`${company}:${row.name}`] = row.id;

      const docRows = (await client.query(`SELECT id, title FROM documents WHERE company_id = $1`, [companyId])).rows;
      for (const row of docRows) documents[`${company}:${row.title}`] = row.id;
    }

    return { companies, users, departments, documents };
  } finally {
    await client.end();
  }
}
