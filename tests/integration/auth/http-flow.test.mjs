// Live end-to-end HTTP test against a REAL running server — not a mock.
// Precondition (documented in README, same pattern as the Docker
// precondition for tests/integration/rls/): the app must already be
// built and started, e.g.:
//   npm run build && PORT=3100 npm run start
// BASE_URL defaults to http://localhost:3100 and can be overridden.
//
// This proves the property items 6/7/8 of the Phase 3 auth test list
// ask for, at the actual HTTP layer: a real login, a real signed
// session cookie, and a real attempt to smuggle company_id/role into
// a protected request body — exercised against the real Next.js
// route handlers (auth.ts, app/api/rag/retrieve/route.ts), not a
// simulation of them.
import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.AUTH_TEST_BASE_URL ?? "http://localhost:3100";
const DEMO_PASSWORD = "ZenDemo2026!";

function parseCookies(res) {
  const jar = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function login(email, password) {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfCookies = parseCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(csrfCookies),
    },
    body: new URLSearchParams({ email, password, csrfToken }).toString(),
  });

  const sessionCookies = parseCookies(loginRes);
  const jar = { ...csrfCookies, ...sessionCookies };
  if (!jar["authjs.session-token"]) {
    throw new Error(`login failed for ${email}: no session cookie in response (status ${loginRes.status})`);
  }
  return jar;
}

async function retrieve(jar, body) {
  const res = await fetch(`${BASE_URL}/api/rag/retrieve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jar ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("unauthenticated request to a protected route is rejected (401)", async () => {
  const { status, body } = await retrieve(null, { query: "onboarding" });
  assert.equal(status, 401);
  assert.equal(body.error, "unauthorized");
});

test("valid login establishes a session whose retrieval is scoped to that user's company", async () => {
  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const { status, body } = await retrieve(jar, { query: "guide onboarding entreprise" });
  assert.equal(status, 200);
  assert.ok(body.chunks.length > 0);
  // None of these titles exist under Acme Corp in the seed data.
  assert.ok(!body.chunks.some((c) => c.documentTitle === "Politique salariale — Nova Bank only"));
});

test("6, 7 — a forged company_id/role in the request body is silently ignored", async () => {
  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const legit = await retrieve(jar, { query: "guide onboarding entreprise" });
  const attacked = await retrieve(jar, {
    query: "guide onboarding entreprise",
    company_id: "00000000-0000-0000-0000-000000000000",
    companyId: "00000000-0000-0000-0000-000000000000",
    role: "superadmin",
  });

  assert.equal(attacked.status, 200);
  assert.deepEqual(
    attacked.body.chunks.map((c) => c.chunkId),
    legit.body.chunks.map((c) => c.chunkId),
    "forged fields in the body must not change the result at all"
  );
});

test("cross-company isolation holds through the full HTTP path (login -> session -> route -> RLS)", async () => {
  const acmeJar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const novaJar = await login("admin@novabank.example", DEMO_PASSWORD);

  const acme = await retrieve(acmeJar, { query: "onboarding" });
  const nova = await retrieve(novaJar, { query: "onboarding" });

  const acmeDocIds = new Set(acme.body.chunks.map((c) => c.documentId));
  const novaDocIds = new Set(nova.body.chunks.map((c) => c.documentId));
  for (const id of acmeDocIds) assert.ok(!novaDocIds.has(id));
});

test("wrong password does not establish a session", async () => {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfCookies = parseCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(csrfCookies),
    },
    body: new URLSearchParams({
      email: "admin@acmecorp.example",
      password: "wrong-password",
      csrfToken,
    }).toString(),
  });
  const cookies = parseCookies(loginRes);
  assert.ok(!cookies["authjs.session-token"], "no session cookie should be issued for a failed login");
});
