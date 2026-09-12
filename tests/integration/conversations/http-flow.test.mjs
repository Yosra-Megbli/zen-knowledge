// Live end-to-end HTTP test against a REAL running server — same
// pattern as tests/integration/auth/http-flow.test.mjs.
// Precondition: npm run build && PORT=3100 npm run start
// BASE_URL defaults to http://localhost:3100 and can be overridden.
//
// Proves the property GET /api/conversations and
// GET /api/conversations/[id]/messages depend on: RLS on
// conversations/conversation_messages is company-isolation ONLY
// (db/migrations/0009), so per-user ownership is enforced by these
// routes themselves — this test is what actually verifies that
// narrower guarantee holds, not just company isolation (already
// covered elsewhere).
import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.CONVERSATIONS_TEST_BASE_URL ?? "http://localhost:3100";
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

async function askQuestion(jar, question) {
  const res = await fetch(`${BASE_URL}/api/rag/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) },
    body: JSON.stringify({ question, conversationId: null }),
  });
  return res.json();
}

async function listConversations(jar) {
  const res = await fetch(`${BASE_URL}/api/conversations`, { headers: { Cookie: cookieHeader(jar) } });
  return { status: res.status, body: await res.json() };
}

async function getMessages(jar, conversationId) {
  const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/messages`, {
    headers: jar ? { Cookie: cookieHeader(jar) } : {},
  });
  return { status: res.status, body: await res.json() };
}

test("unauthenticated request to conversation routes is rejected (401)", async () => {
  const list = await listConversations({});
  assert.equal(list.status, 401);
  const msgs = await getMessages(null, "00000000-0000-0000-0000-000000000000");
  assert.equal(msgs.status, 401);
});

test("owner can list and read their own conversation", async () => {
  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const answer = await askQuestion(jar, "guide onboarding entreprise");
  assert.ok(answer.conversationId, "expected a conversation to be created");

  const list = await listConversations(jar);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((c) => c.id === answer.conversationId));

  const msgs = await getMessages(jar, answer.conversationId);
  assert.equal(msgs.status, 200);
  assert.ok(msgs.body.messages.length >= 1);
});

test("a same-company colleague cannot list or read another user's conversation (404, not 403)", async () => {
  const adminJar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const contributorJar = await login("contributor@acmecorp.example", DEMO_PASSWORD);

  const answer = await askQuestion(adminJar, "guide onboarding entreprise");
  assert.ok(answer.conversationId);

  const list = await listConversations(contributorJar);
  assert.equal(list.status, 200);
  assert.ok(
    !list.body.some((c) => c.id === answer.conversationId),
    "another user's conversation must never appear in someone else's list, even same company"
  );

  const msgs = await getMessages(contributorJar, answer.conversationId);
  assert.equal(msgs.status, 404, "must be 404 (not found), never 403 (which would confirm it exists)");
});

test("a nonexistent conversation id also returns 404 for a logged-in user", async () => {
  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const msgs = await getMessages(jar, "00000000-0000-0000-0000-000000000000");
  assert.equal(msgs.status, 404);
});
