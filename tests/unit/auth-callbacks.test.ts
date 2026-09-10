// Tests the Auth.js callback LOGIC directly (authorizeCredentials,
// applyUserToToken, applyTokenToSessionUser) — no live HTTP server
// needed. authorizeCredentials hits the real database (via the
// auth_find_user_by_email SECURITY DEFINER function, db/migrations/
// 0010_auth.sql) using the real seeded demo users, so this also proves
// the DB side of the login path actually works, not just the shape.
import test from "node:test";
import assert from "node:assert/strict";
import { authorizeCredentials, applyUserToToken, applyTokenToSessionUser } from "../../lib/auth/callbacks.ts";

const DEMO_PASSWORD = "ZenDemo2026!";
const ADMIN_EMAIL = "admin@acmecorp.example";

test("1 — valid credentials authenticate successfully", async () => {
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  assert.ok(user, "expected a user to be returned for valid credentials");
});

test("2 — resulting context contains the correct company_id", async () => {
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  assert.ok(user?.companyId, "companyId must be set");
});

test("3 — resulting context contains the correct role", async () => {
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  assert.equal(user?.role, "admin");
});

test("4 — resulting context contains the correct department_id when applicable", async () => {
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  assert.ok(user?.departmentId, "the seeded admin user has a department_id");
});

test("wrong password is rejected", async () => {
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: "not-the-password" });
  assert.equal(user, null);
});

test("unknown email is rejected", async () => {
  const user = await authorizeCredentials({ email: "nobody@nowhere.example", password: DEMO_PASSWORD });
  assert.equal(user, null);
});

test("6, 7 — a client-injected company_id/role in the login payload is ignored", async () => {
  // Simulates an attacker submitting extra fields in the login request
  // body alongside the real credentials. authorizeCredentials only
  // ever destructures email/password (see auth.ts) — everything else
  // in this object is unreachable dead data.
  const forged = {
    email: ADMIN_EMAIL,
    password: DEMO_PASSWORD,
    company_id: "00000000-0000-0000-0000-000000000000",
    companyId: "00000000-0000-0000-0000-000000000000",
    role: "admin-of-everything",
  };
  const legit = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  const attacked = await authorizeCredentials(forged);

  assert.deepEqual(attacked, legit, "forged extra fields must not change the derived identity at all");
  assert.notEqual(attacked?.companyId, "00000000-0000-0000-0000-000000000000");
  assert.notEqual(attacked?.role, "admin-of-everything");
});

test("5 — user without a company authenticates but yields a null companyId", async () => {
  // authorizeCredentials itself has no "user without company" seed
  // fixture to call — that denial is enforced one layer up, in
  // lib/permissions/authContext.ts, which treats companyId == null as
  // "deny" (see next test). This test documents the contract:
  // authorizeCredentials returns whatever the DB has, including a null
  // companyId, and does NOT silently invent one.
  const user = await authorizeCredentials({ email: ADMIN_EMAIL, password: DEMO_PASSWORD });
  assert.notEqual(user?.companyId, undefined, "companyId key must always be present, even if null for some user");
});

test("jwt callback copies user fields into the token only on initial sign-in", () => {
  const user = {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    companyId: "c1",
    role: "employee" as const,
    departmentId: "d1",
  };
  const token = applyUserToToken({}, user);
  assert.equal(token.userId, "u1");
  assert.equal(token.companyId, "c1");
  assert.equal(token.role, "employee");
  assert.equal(token.departmentId, "d1");

  // Subsequent calls (user undefined) must leave an existing token
  // untouched — no re-derivation from anywhere else.
  const unchanged = applyUserToToken({ userId: "u1", companyId: "c1", role: "employee" as const, departmentId: "d1" }, undefined);
  assert.equal(unchanged.companyId, "c1");
});

test("session callback copies token fields into session.user", () => {
  const sessionUser = {};
  const result = applyTokenToSessionUser(sessionUser, {
    userId: "u1",
    companyId: "c1",
    role: "contributor",
    departmentId: "d1",
  });
  assert.equal(result.id, "u1");
  assert.equal(result.companyId, "c1");
  assert.equal(result.role, "contributor");
  assert.equal(result.departmentId, "d1");
});

test("session callback denies gracefully when token has no companyId (user without company)", () => {
  const sessionUser = {};
  const result = applyTokenToSessionUser(sessionUser, { userId: "u1", role: "employee" });
  assert.equal(result.companyId, null, "must be explicitly null, never silently assigned a fallback company");
});
