// Supports Phase 3 item 9 ("no-source foundation"): proves the
// configurable threshold mechanism itself works, without generating
// any LLM answer — that remains out of scope until a later phase.
import test from "node:test";
import assert from "node:assert/strict";
import { retrieveAuthorizedChunks } from "../../../lib/rag/retrieveAuthorizedChunks.ts";
import { fixtures } from "../rls/helpers.mjs";
import type { AuthContext } from "../../../lib/permissions/authContext.ts";

const f = await fixtures();
const admin = f.users["Acme Corp:admin"];
const ctx: AuthContext = {
  userId: "test",
  companyId: f.companies["Acme Corp"],
  role: "admin",
  departmentId: admin.department_id,
};

test("no-source: a very high threshold rejects even the best authorized match", async () => {
  const result = await retrieveAuthorizedChunks(ctx, "onboarding guide entreprise", {
    minSimilarity: 0.999,
    k: 5,
  });
  assert.equal(result.chunks.length, 0);
  assert.equal(result.noSource, true);
  assert.equal(result.minSimilarity, 0.999);
});

test("no-source: a permissive threshold returns authorized matches (no answer generated here)", async () => {
  const result = await retrieveAuthorizedChunks(ctx, "onboarding guide entreprise", {
    minSimilarity: -1,
    k: 5,
  });
  assert.ok(result.chunks.length > 0);
  assert.equal(result.noSource, false);
});

test("no-source: default threshold is read from RAG_MIN_SIMILARITY when not overridden", async () => {
  const result = await retrieveAuthorizedChunks(ctx, "onboarding guide entreprise");
  const expected = Number(process.env.RAG_MIN_SIMILARITY ?? 0.3);
  assert.equal(result.minSimilarity, expected);
});
