import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestDocument } from "../../../lib/ingestion/pipeline/ingestDocument.ts";
import { getAppPool } from "../../../lib/db/appPool.ts";
import { fixtures } from "../rls/helpers.mjs";
import type { AuthContext } from "../../../lib/permissions/authContext.ts";

const f = await fixtures();
const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/ingestion");

function readFixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

function ctxFor(company: "Acme Corp" | "Nova Bank", role: "admin" | "contributor" | "employee"): AuthContext {
  const user = f.users[`${company}:${role}`];
  return { userId: user.id, companyId: f.companies[company], role, departmentId: user.department_id };
}

test("simulated DB outage / failure during pipeline: produces DATABASE_FAILURE error code gracefully", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const pool = getAppPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyPool = pool as any;
  const originalConnect = anyPool.connect.bind(anyPool);

  let connectCount = 0;
  const touchedClients: Array<{ client: { query: unknown }; originalQuery: unknown }> = [];
  anyPool.connect = async function (...args: unknown[]) {
    connectCount++;
    const client = await originalConnect(...args);
    if (connectCount >= 3) {
      const originalQuery = client.query.bind(client);
      touchedClients.push({ client, originalQuery });
      client.query = async function (...qArgs: unknown[]) {
        const sql = typeof qArgs[0] === "string" ? qArgs[0] : (qArgs[0] as { text?: string })?.text ?? "";
        if (sql.includes("document_chunks") || sql.includes("INSERT")) {
          client.query = originalQuery; // immediately restore
          const err = new Error("connection terminated unexpectedly: server closed the connection unexpectedly");
          Object.assign(err, { code: "57P01" });
          throw err;
        }
        return originalQuery(...qArgs);
      };
    }
    return client;
  };

  try {
    const result = await ingestDocument({
      ctx,
      fileName: "valid.txt",
      data: readFixture("valid.txt"),
      target: { kind: "new", title: `DB Fail Test ${Date.now()}`, visibility: "company" },
      triggeredBy: "test",
    });

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "DATABASE_FAILURE");
    assert.match(result.errorMessage ?? "", /connection/i);
    // Ensure no passwords or database connection URLs leak
    assert.ok(!JSON.stringify(result).includes("postgresql://"));
    assert.ok(!JSON.stringify(result).includes("postgres:"));
  } finally {
    // Restore original pool method and any patched clients
    anyPool.connect = originalConnect;
    for (const { client, originalQuery } of touchedClients) {
      client.query = originalQuery;
    }
  }
});
