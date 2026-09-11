// Pure logic test for the visibility check used by
// app/api/documents/[versionId]/file/route.ts (and any future code path
// that exposes document content outside the RLS-enforced
// document_chunks_select policy). Mirrors that policy's visibility
// clause exactly — see lib/permissions/documentVisibility.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { canAccessDocumentVisibility } from "../../lib/permissions/documentVisibility.ts";
import type { AuthContext } from "../../lib/permissions/authContext.ts";

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return { userId: "u1", companyId: "c1", role: "employee", departmentId: "d-rh", ...overrides };
}

test("company visibility is accessible to any authenticated user of the company", () => {
  assert.equal(canAccessDocumentVisibility(ctx({ role: "employee" }), { visibility: "company", departmentId: null }), true);
});

test("restricted visibility — admin can access", () => {
  assert.equal(canAccessDocumentVisibility(ctx({ role: "admin" }), { visibility: "restricted", departmentId: null }), true);
});

test("restricted visibility — employee is denied (the exact bug this fixes)", () => {
  assert.equal(canAccessDocumentVisibility(ctx({ role: "employee" }), { visibility: "restricted", departmentId: null }), false);
});

test("restricted visibility — contributor is denied", () => {
  assert.equal(canAccessDocumentVisibility(ctx({ role: "contributor" }), { visibility: "restricted", departmentId: null }), false);
});

test("department visibility — matching department is allowed", () => {
  assert.equal(
    canAccessDocumentVisibility(ctx({ departmentId: "d-it" }), { visibility: "department", departmentId: "d-it" }),
    true
  );
});

test("department visibility — different department is denied", () => {
  assert.equal(
    canAccessDocumentVisibility(ctx({ departmentId: "d-rh" }), { visibility: "department", departmentId: "d-it" }),
    false
  );
});

test("department visibility — user with no department is denied", () => {
  assert.equal(
    canAccessDocumentVisibility(ctx({ departmentId: null }), { visibility: "department", departmentId: "d-it" }),
    false
  );
});

test("unknown/malformed visibility value is denied (fail-closed)", () => {
  assert.equal(canAccessDocumentVisibility(ctx({ role: "admin" }), { visibility: "something-else", departmentId: null }), false);
});
