import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestDocument } from "../../../lib/ingestion/pipeline/ingestDocument.ts";
import { publishVersion } from "../../../lib/ingestion/pipeline/publishVersion.ts";
import { IngestionError } from "../../../lib/ingestion/errors.ts";
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

test("deduplication: uploading two documents with identical title and content is rejected", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const title = `Unique Doc ${Date.now()}`;
  const data = readFixture("valid.txt");

  // First upload succeeds
  const first = await ingestDocument({
    ctx,
    fileName: "valid.txt",
    data,
    target: { kind: "new", title, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(first.status, "completed");

  // Second upload with identical title and content in same company must be rejected
  await assert.rejects(
    () =>
      ingestDocument({
        ctx,
        fileName: "valid.txt",
        data,
        target: { kind: "new", title, visibility: "company" },
        triggeredBy: "test",
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestionError);
      assert.equal(err.code, "DUPLICATE_DOCUMENT");
      return true;
    }
  );
});

test("deduplication: uploading a document with existing title but different content warns to use new version", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const title = `Title Collision Test ${Date.now()}`;

  const first = await ingestDocument({
    ctx,
    fileName: "valid.txt",
    data: readFixture("valid.txt"),
    target: { kind: "new", title, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(first.status, "completed");
  await publishVersion(ctx, first.documentVersionId);

  // Uploading different file with same title
  await assert.rejects(
    () =>
      ingestDocument({
        ctx,
        fileName: "valid.pdf",
        data: readFixture("valid.pdf"),
        target: { kind: "new", title, visibility: "company" },
        triggeredBy: "test",
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestionError);
      assert.equal(err.code, "DUPLICATE_DOCUMENT");
      assert.match(err.message, /ajoutez une nouvelle version/i);
      return true;
    }
  );
});

test("deduplication: adding a new version with identical content to current version is rejected", async () => {
  const ctx = ctxFor("Acme Corp", "admin");
  const title = `Version Duplicate Test ${Date.now()}`;
  const data = readFixture("valid.txt");

  const first = await ingestDocument({
    ctx,
    fileName: "valid.txt",
    data,
    target: { kind: "new", title, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(first.status, "completed");
  await publishVersion(ctx, first.documentVersionId);

  // Adding new version with identical content
  await assert.rejects(
    () =>
      ingestDocument({
        ctx,
        fileName: "valid.txt",
        data,
        target: { kind: "version", documentId: first.documentId },
        triggeredBy: "test",
      }),
    (err: unknown) => {
      assert.ok(err instanceof IngestionError);
      assert.equal(err.code, "DUPLICATE_DOCUMENT");
      assert.match(err.message, /identique au contenu de la version actuelle/i);
      return true;
    }
  );
});

test("deduplication: identical title across DIFFERENT companies is permitted (RLS isolation)", async () => {
  const acmeCtx = ctxFor("Acme Corp", "admin");
  const novaCtx = ctxFor("Nova Bank", "admin");
  const sharedTitle = `Cross Company Same Title ${Date.now()}`;
  const data = readFixture("valid.txt");

  // Upload in Acme Corp
  const acmeResult = await ingestDocument({
    ctx: acmeCtx,
    fileName: "valid.txt",
    data,
    target: { kind: "new", title: sharedTitle, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(acmeResult.status, "completed");

  // Upload in Nova Bank with identical title must NOT collide due to RLS scoping
  const novaResult = await ingestDocument({
    ctx: novaCtx,
    fileName: "valid.txt",
    data,
    target: { kind: "new", title: sharedTitle, visibility: "company" },
    triggeredBy: "test",
  });
  assert.equal(novaResult.status, "completed");
  assert.notEqual(acmeResult.documentId, novaResult.documentId);
});
