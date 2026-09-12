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
//
// Conversations are seeded directly via ensureConversation/persistTurn
// (lib/conversation/persist.ts) rather than through a real
// POST /api/rag/answer call: that route calls the real Groq provider
// when hit over HTTP (setLlmProvider()'s in-process mock, used by
// every other RAG test, cannot reach a separately-running server
// process), and this suite has nothing to do with LLM availability —
// only with who is allowed to read a conversation back. Matches the
// project's own documented stance (README "Limitations connues"): no
// test here depends on a real GROQ_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import { ensureConversation, persistTurn } from "../../../lib/conversation/persist.ts";
import { fixtures } from "../rls/helpers.mjs";

const BASE_URL = process.env.CONVERSATIONS_TEST_BASE_URL ?? "http://localhost:3100";
const DEMO_PASSWORD = "ZenDemo2026!";

const f = await fixtures();

function ctxFor(company, role) {
  const user = f.users[`${company}:${role}`];
  return { userId: user.id, companyId: f.companies[company], role, departmentId: user.department_id };
}

async function seedConversation(ctx, question) {
  const conversationId = await ensureConversation(ctx, null, question);
  const fakeResult = {
    answer: "Seeded test answer — no real LLM call was made.",
    citations: [],
    refusal: false,
    metadata: { model: "test-seed", latencyMs: 1, promptTokens: null, completionTokens: null, totalTokens: null, sourceCount: 0 },
  };
  await persistTurn(ctx, conversationId, question, fakeResult);
  return conversationId;
}

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
  const ctx = ctxFor("Acme Corp", "admin");
  const conversationId = await seedConversation(ctx, "guide onboarding entreprise");

  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const list = await listConversations(jar);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((c) => c.id === conversationId));

  const msgs = await getMessages(jar, conversationId);
  assert.equal(msgs.status, 200);
  assert.ok(msgs.body.messages.length >= 1);
});

test("a same-company colleague cannot list or read another user's conversation (404, not 403)", async () => {
  const adminCtx = ctxFor("Acme Corp", "admin");
  const conversationId = await seedConversation(adminCtx, "guide onboarding entreprise");

  const contributorJar = await login("contributor@acmecorp.example", DEMO_PASSWORD);

  const list = await listConversations(contributorJar);
  assert.equal(list.status, 200);
  assert.ok(
    !list.body.some((c) => c.id === conversationId),
    "another user's conversation must never appear in someone else's list, even same company"
  );

  const msgs = await getMessages(contributorJar, conversationId);
  assert.equal(msgs.status, 404, "must be 404 (not found), never 403 (which would confirm it exists)");
});

test("a nonexistent conversation id also returns 404 for a logged-in user", async () => {
  const jar = await login("admin@acmecorp.example", DEMO_PASSWORD);
  const msgs = await getMessages(jar, "00000000-0000-0000-0000-000000000000");
  assert.equal(msgs.status, 404);
});
