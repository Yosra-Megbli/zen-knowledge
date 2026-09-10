// PROOF — demonstrates the property this project needs to be able to
// show in the presentation: "even if the application forgot the company
// filter, PostgreSQL RLS still prevents cross-company access." Neither
// query below has a WHERE clause on company_id — the restriction comes
// entirely from the database role and RLS policy, not from TypeScript.
import test from "node:test";
import assert from "node:assert/strict";
import { getAppClient, getMigrationClient, withAuthContext } from "../../../db/db.mjs";
import { fixtures } from "./helpers.mjs";

const f = await fixtures();

test("PROOF — migration_role (superuser) bypasses RLS; app_role does not", async () => {
  const migClient = await getMigrationClient();
  const appClient = await getAppClient();
  try {
    const asSuperuser = await migClient.query(`SELECT id, company_id FROM document_chunks`);
    assert.ok(asSuperuser.rows.length > 0, "sanity: seed created chunks");

    const distinctCompanies = new Set(asSuperuser.rows.map((r) => r.company_id));
    assert.ok(distinctCompanies.size >= 2, "sanity: chunks exist for at least 2 companies");

    const asAppRole = await withAuthContext(
      appClient,
      { companyId: f.companies["Acme Corp"], role: "admin", departmentId: f.users["Acme Corp:admin"].department_id },
      // Deliberately NO "WHERE company_id = ..." here — proving RLS,
      // not application code, does the filtering.
      async (c) => (await c.query(`SELECT id, company_id FROM document_chunks`)).rows
    );

    assert.ok(
      asAppRole.length < asSuperuser.rows.length,
      "app_role under RLS must see strictly fewer rows than the superuser sees"
    );
    assert.ok(
      asAppRole.every((r) => r.company_id === f.companies["Acme Corp"]),
      "every row app_role sees must belong to Acme Corp, even with no WHERE clause"
    );
  } finally {
    await migClient.end();
    await appClient.end();
  }
});

test("PROOF — app_role with no context set sees zero rows, even though data exists", async () => {
  const appClient = await getAppClient();
  try {
    await appClient.query("BEGIN");
    const res = await appClient.query(`SELECT id FROM document_chunks`); // no WHERE, no context
    assert.equal(res.rows.length, 0);
    await appClient.query("COMMIT");
  } finally {
    await appClient.end();
  }
});
