// TEST 1 & TEST 2 — cross-company isolation.
import test from "node:test";
import assert from "node:assert/strict";
import { getAppClient, withAuthContext } from "../../../db/db.mjs";
import { fixtures } from "./helpers.mjs";

const f = await fixtures();

async function chunksForCompany(ctx, targetCompanyId) {
  const client = await getAppClient();
  try {
    return await withAuthContext(client, ctx, async (c) => {
      const res = await c.query(`SELECT id FROM document_chunks WHERE company_id = $1`, [targetCompanyId]);
      return res.rows;
    });
  } finally {
    await client.end();
  }
}

test("TEST 1 — Company A employee cannot read Company B document_chunks", async () => {
  const ctx = {
    companyId: f.companies["Acme Corp"],
    role: "employee",
    departmentId: f.users["Acme Corp:employee"].department_id,
  };
  const rows = await chunksForCompany(ctx, f.companies["Nova Bank"]);
  assert.equal(rows.length, 0);
});

test("TEST 2 — Company B employee cannot read Company A document_chunks", async () => {
  const ctx = {
    companyId: f.companies["Nova Bank"],
    role: "employee",
    departmentId: f.users["Nova Bank:employee"].department_id,
  };
  const rows = await chunksForCompany(ctx, f.companies["Acme Corp"]);
  assert.equal(rows.length, 0);
});
