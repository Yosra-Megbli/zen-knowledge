// TEST 3, 4, 5, 6, 7, 8 — role/visibility restriction and publication
// status (unpublished, deleted, old version) must gate retrieval.
import test from "node:test";
import assert from "node:assert/strict";
import { getAppClient, withAuthContext } from "../../../db/db.mjs";
import { fixtures } from "./helpers.mjs";

const f = await fixtures();
const company = "Acme Corp";
const companyId = f.companies[company];
const employee = f.users[`${company}:employee`]; // department: RH
const admin = f.users[`${company}:admin`]; // department: IT

async function chunksForDocument(ctx, documentId) {
  const client = await getAppClient();
  try {
    return await withAuthContext(client, ctx, async (c) => {
      const res = await c.query(`SELECT id FROM document_chunks WHERE document_id = $1`, [documentId]);
      return res.rows;
    });
  } finally {
    await client.end();
  }
}

test("TEST 3 — Employee cannot read a Restricted document", async () => {
  const ctx = { companyId, role: "employee", departmentId: employee.department_id };
  const rows = await chunksForDocument(ctx, f.documents[`${company}:Politique salariale`]);
  assert.equal(rows.length, 0);
});

test("TEST 4 — Published document is readable when authorized", async () => {
  const asAdmin = { companyId, role: "admin", departmentId: admin.department_id };
  const restricted = await chunksForDocument(asAdmin, f.documents[`${company}:Politique salariale`]);
  assert.ok(restricted.length > 0, "admin must read the restricted document");

  const asEmployee = { companyId, role: "employee", departmentId: employee.department_id };
  const companyWide = await chunksForDocument(asEmployee, f.documents[`${company}:Guide onboarding`]);
  assert.ok(companyWide.length > 0, "employee must read a company-wide published document");
});

test("TEST 5 — Unpublished (draft) document is not readable", async () => {
  const ctx = { companyId, role: "admin", departmentId: admin.department_id };
  const rows = await chunksForDocument(ctx, f.documents[`${company}:Brouillon en cours`]);
  assert.equal(rows.length, 0);
});

test("TEST 6 — Deleted document is not readable", async () => {
  const ctx = { companyId, role: "admin", departmentId: admin.department_id };
  const rows = await chunksForDocument(ctx, f.documents[`${company}:Document supprimé`]);
  assert.equal(rows.length, 0);
});

test("TEST 7 — Old archived version is not readable as current content", async () => {
  const ctx = { companyId, role: "admin", departmentId: admin.department_id };
  const client = await getAppClient();
  try {
    const documentId = f.documents[`${company}:Manuel avec versions`];

    const v1Rows = await withAuthContext(client, ctx, async (c) => {
      const res = await c.query(
        `SELECT dc.id FROM document_chunks dc
         JOIN document_versions v ON v.id = dc.document_version_id
         WHERE dc.document_id = $1 AND v.version_number = 1`,
        [documentId]
      );
      return res.rows;
    });
    assert.equal(v1Rows.length, 0, "version 1 (archived) must not be retrievable");

    const v2Rows = await withAuthContext(client, ctx, async (c) => {
      const res = await c.query(
        `SELECT dc.id FROM document_chunks dc
         JOIN document_versions v ON v.id = dc.document_version_id
         WHERE dc.document_id = $1 AND v.version_number = 2`,
        [documentId]
      );
      return res.rows;
    });
    assert.ok(v2Rows.length > 0, "version 2 (published) must be retrievable");
  } finally {
    await client.end();
  }
});

test("TEST 8 — Department-restricted document is inaccessible to another department", async () => {
  // employee is in RH; "Procédure IT interne" is restricted to IT.
  const ctx = { companyId, role: "employee", departmentId: employee.department_id };
  const rows = await chunksForDocument(ctx, f.documents[`${company}:Procédure IT interne`]);
  assert.equal(rows.length, 0);
});

test("TEST 8b — Department-restricted document is accessible to the correct department", async () => {
  // admin is in IT (see db/seed.mjs ROLE_DEPARTMENT).
  const ctx = { companyId, role: "admin", departmentId: admin.department_id };
  const rows = await chunksForDocument(ctx, f.documents[`${company}:Procédure IT interne`]);
  assert.ok(rows.length > 0);
});
