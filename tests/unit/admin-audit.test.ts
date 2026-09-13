import test from "node:test";
import assert from "node:assert/strict";
import { getAuditLogs, formatAuditLogsAsCsv, escapeCsvField, type AuditLogRow } from "../../lib/admin/audit.ts";
import { fixtures } from "../integration/rls/helpers.mjs";
import type { AuthContext } from "../../lib/permissions/authContext.ts";

const f = await fixtures();

function ctxFor(company: "Acme Corp" | "Nova Bank", role: "admin" | "contributor" | "employee"): AuthContext {
  const user = f.users[`${company}:${role}`];
  return { userId: user.id, companyId: f.companies[company], role, departmentId: user.department_id };
}

test("getAuditLogs: returns rows scoped strictly to caller's company (RLS)", async () => {
  const adminCtx = ctxFor("Acme Corp", "admin");
  const result = await getAuditLogs(adminCtx, { limit: 20 });

  assert.ok(typeof result.total === "number");
  assert.ok(Array.isArray(result.rows));
  for (const row of result.rows) {
    assert.equal(row.company_id, adminCtx.companyId);
  }
});

test("formatAuditLogsAsCsv: formats header and rows properly with escaped quotes and commas", () => {
  const sampleRows: AuditLogRow[] = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      company_id: "22222222-2222-2222-2222-222222222222",
      user_id: "33333333-3333-3333-3333-333333333333",
      user_email: "admin@example.com",
      action: "rag_answer",
      resource_type: "conversation",
      resource_id: "44444444-4444-4444-4444-444444444444",
      metadata: { note: 'Contains "quotes" and, commas' },
      created_at: "2026-09-13T10:00:00.000Z",
    },
  ];

  const csv = formatAuditLogsAsCsv(sampleRows);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "id,timestamp,user_email,action,resource_type,resource_id,metadata");
  assert.ok(lines[1].includes("admin@example.com"));
  assert.ok(lines[1].includes("rag_answer"));
  // Assert JSON metadata with quotes is properly escaped with double quotes
  assert.ok(lines[1].includes('\\""quotes\\""') || lines[1].includes('""quotes""'));
});

test("escapeCsvField: correctly handles strings, numbers, nulls and objects", () => {
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
  assert.equal(escapeCsvField("simple"), "simple");
  assert.equal(escapeCsvField("with,comma"), '"with,comma"');
  assert.equal(escapeCsvField('with"quote'), '"with""quote"');
  assert.equal(escapeCsvField({ a: 1 }), '"{""a"":1}"');
});
