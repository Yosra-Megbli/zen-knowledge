// TEST 9 & TEST 10 — the authorization context is genuinely
// transaction-scoped: it can change mid-transaction, and it never
// survives past COMMIT into a new transaction.
import test from "node:test";
import assert from "node:assert/strict";
import { getAppClient } from "../../../db/db.mjs";
import { fixtures } from "./helpers.mjs";

const f = await fixtures();

test("TEST 9 — Changing company context inside a transaction changes visible rows", async () => {
  const client = await getAppClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [f.companies["Acme Corp"]]);
    await client.query("SELECT set_config('app.role', 'admin', true)");

    const underAcme = await client.query(`SELECT id FROM document_chunks WHERE company_id = $1`, [f.companies["Acme Corp"]]);
    assert.ok(underAcme.rows.length > 0, "should see Acme rows under Acme context");

    await client.query("SELECT set_config('app.company_id', $1, true)", [f.companies["Nova Bank"]]);

    const acmeAfterSwitch = await client.query(`SELECT id FROM document_chunks WHERE company_id = $1`, [f.companies["Acme Corp"]]);
    assert.equal(acmeAfterSwitch.rows.length, 0, "Acme rows must disappear once context switches to Nova Bank");

    const novaAfterSwitch = await client.query(`SELECT id FROM document_chunks WHERE company_id = $1`, [f.companies["Nova Bank"]]);
    assert.ok(novaAfterSwitch.rows.length > 0, "Nova Bank rows must appear once context switches");

    await client.query("COMMIT");
  } finally {
    await client.end();
  }
});

test("TEST 10 — SET LOCAL context does not leak into a new transaction after COMMIT", async () => {
  const client = await getAppClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [f.companies["Acme Corp"]]);
    await client.query("SELECT set_config('app.role', 'admin', true)");
    const before = await client.query(`SELECT id FROM document_chunks`);
    assert.ok(before.rows.length > 0, "sanity check: context works before commit");
    await client.query("COMMIT");

    // Fresh transaction, NO context set at all.
    await client.query("BEGIN");
    const after = await client.query(`SELECT id FROM document_chunks`);
    assert.equal(after.rows.length, 0, "no leaked context: must see 0 rows, fail-closed");
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
});
