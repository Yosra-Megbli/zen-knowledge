// TEST A-L — exercises the actual retrieveAuthorizedChunks() function
// (not raw SQL) with real local embeddings, proving the RLS guarantees
// established in Phase 2 (tests/integration/rls/) still hold when
// reached through the application retrieval path. Every call here uses
// app_role via lib/db/withAuthContext.ts — there is no other code path
// through which retrieveAuthorizedChunks could run.
import test from "node:test";
import assert from "node:assert/strict";
import { retrieveAuthorizedChunks } from "../../../lib/rag/retrieveAuthorizedChunks.ts";
import { getMigrationClient } from "../../../db/db.mjs";
import { fixtures } from "../rls/helpers.mjs";
import type { AuthContext } from "../../../lib/permissions/authContext.ts";

const f = await fixtures();
const company = "Acme Corp";
const companyId: string = f.companies[company];
const employee = f.users[`${company}:employee`]; // RH
const admin = f.users[`${company}:admin`]; // IT

// minSimilarity: -1 accepts every authorized row regardless of
// relevance score — isolates "does authorization let this through"
// from "is this the best-ranked match", which is a separate concern
// (see tests/integration/rag/no-source-threshold.test.ts).
const NO_THRESHOLD = { minSimilarity: -1, k: 10 };

function ctx(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: "test",
    companyId,
    role: "employee",
    departmentId: null,
    ...overrides,
  };
}

test("TEST A — Company A user cannot retrieve Company B chunks", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ companyId: f.companies["Acme Corp"], role: "employee", departmentId: employee.department_id }),
    "onboarding",
    NO_THRESHOLD
  );
  // Explicit cross-check: none of the returned chunks belong to Nova Bank-only content.
  const novaOnlyTitle = f.documents["Nova Bank:Politique salariale"];
  assert.ok(!result.chunks.some((c) => c.documentId === novaOnlyTitle));
});

test("TEST B — Company B user cannot retrieve Company A chunks", async () => {
  const bEmployee = f.users["Nova Bank:employee"];
  const result = await retrieveAuthorizedChunks(
    ctx({ companyId: f.companies["Nova Bank"], role: "employee", departmentId: bEmployee.department_id }),
    "onboarding",
    NO_THRESHOLD
  );
  const acmeOnlyDoc = f.documents["Acme Corp:Politique salariale"];
  assert.ok(!result.chunks.some((c) => c.documentId === acmeOnlyDoc));
});

test("TEST C — Employee cannot retrieve restricted chunks", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "employee", departmentId: employee.department_id }),
    "politique salariale rémunération",
    NO_THRESHOLD
  );
  const restrictedDocId = f.documents[`${company}:Politique salariale`];
  assert.ok(!result.chunks.some((c) => c.documentId === restrictedDocId));
});

test("TEST D — Correct department can retrieve its department-visible chunks", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "admin", departmentId: admin.department_id }), // admin is in IT
    "procédure informatique accès serveur",
    NO_THRESHOLD
  );
  const itDocId = f.documents[`${company}:Procédure IT interne`];
  assert.ok(result.chunks.some((c) => c.documentId === itDocId));
});

test("TEST E — Wrong department cannot retrieve them", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "employee", departmentId: employee.department_id }), // employee is in RH
    "procédure informatique accès serveur",
    NO_THRESHOLD
  );
  const itDocId = f.documents[`${company}:Procédure IT interne`];
  assert.ok(!result.chunks.some((c) => c.documentId === itDocId));
});

test("TEST F — Unpublished chunks are not retrieved", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "admin", departmentId: admin.department_id }),
    "brouillon en cours de rédaction",
    NO_THRESHOLD
  );
  const draftDocId = f.documents[`${company}:Brouillon en cours`];
  assert.ok(!result.chunks.some((c) => c.documentId === draftDocId));
});

test("TEST G — Deleted document/chunks are not retrieved", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "admin", departmentId: admin.department_id }),
    "ancien contenu retiré audit",
    NO_THRESHOLD
  );
  const deletedDocId = f.documents[`${company}:Document supprimé`];
  assert.ok(!result.chunks.some((c) => c.documentId === deletedDocId));
});

test("TEST H — Old archived/inactive version is not retrieved as current content", async () => {
  const result = await retrieveAuthorizedChunks(
    ctx({ role: "admin", departmentId: admin.department_id }),
    "sauvegarde hebdomadaire quotidienne",
    NO_THRESHOLD
  );
  const versionedDocId = f.documents[`${company}:Manuel avec versions`];
  const matches = result.chunks.filter((c) => c.documentId === versionedDocId);
  assert.ok(matches.length > 0, "the published version's content must be retrievable");
  assert.ok(
    matches.every((c) => c.versionNumber === 2),
    "only version 2 (published) must appear, never version 1 (archived)"
  );
});

test("TEST I — No authorization context means zero protected rows (fail-closed)", async () => {
  // An empty companyId is set_config'd verbatim, then
  // app_current_company_id() collapses '' to NULL (NULLIF), and the
  // RLS policy's `company_id = NULL` is never true — no error, just
  // zero rows. This is the fail-closed behavior by design (see
  // db/migrations/0009_rls_and_grants.sql for why NULLIF is required).
  const result = await retrieveAuthorizedChunks(ctx({ companyId: "" }), "onboarding", NO_THRESHOLD);
  assert.equal(result.chunks.length, 0);
  assert.equal(result.noSource, true);
});

test("TEST J — Changing authorization context changes retrievable rows correctly", async () => {
  const asAcme = await retrieveAuthorizedChunks(
    ctx({ companyId: f.companies["Acme Corp"], role: "admin", departmentId: admin.department_id }),
    "onboarding guide",
    NO_THRESHOLD
  );
  const novaAdmin = f.users["Nova Bank:admin"];
  const asNova = await retrieveAuthorizedChunks(
    ctx({ companyId: f.companies["Nova Bank"], role: "admin", departmentId: novaAdmin.department_id }),
    "onboarding guide",
    NO_THRESHOLD
  );
  const acmeIds = new Set(asAcme.chunks.map((c) => c.documentId));
  const novaIds = new Set(asNova.chunks.map((c) => c.documentId));
  for (const id of acmeIds) assert.ok(!novaIds.has(id), "Acme and Nova result sets must never overlap");
});

test("TEST K — Context does not leak after COMMIT (across independent calls)", async () => {
  const first = await retrieveAuthorizedChunks(
    ctx({ companyId: f.companies["Acme Corp"], role: "admin", departmentId: admin.department_id }),
    "onboarding",
    NO_THRESHOLD
  );
  assert.ok(first.chunks.length > 0, "sanity check: the first call must find authorized rows");

  // A later call with a deliberately empty context, possibly on a
  // pooled connection previously used by the call above, must not
  // inherit anything from it.
  const second = await retrieveAuthorizedChunks(ctx({ companyId: "" }), "onboarding", NO_THRESHOLD);
  assert.equal(second.chunks.length, 0, "no leaked context: must see 0 rows regardless of connection reuse");
});

test("TEST L — retrieveAuthorizedChunks (app_role) still respects RLS vs. an unfiltered superuser query", async () => {
  const migClient = await getMigrationClient();
  try {
    const allChunks = await migClient.query(`SELECT id FROM document_chunks WHERE embedding IS NOT NULL`);
    const totalAcrossAllCompanies = allChunks.rows.length;

    const result = await retrieveAuthorizedChunks(
      ctx({ companyId: f.companies["Acme Corp"], role: "admin", departmentId: admin.department_id }),
      "onboarding",
      { minSimilarity: -1, k: 1000 }
    );

    assert.ok(
      result.chunks.length < totalAcrossAllCompanies,
      "the retrieval function must return strictly fewer rows than exist globally across both companies"
    );
  } finally {
    await migClient.end();
  }
});
