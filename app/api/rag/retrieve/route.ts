import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { retrieveAuthorizedChunks } from "../../../../lib/rag/retrieveAuthorizedChunks.ts";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    // Covers both "no session" and "authenticated user without a
    // company" — both are denied identically, never distinguished in
    // a way that would let a caller probe for account existence.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const query = typeof body.query === "string" ? body.query : "";
  if (!query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // Any `company_id` / `role` / `department_id` the client included in
  // `body` is intentionally never read here — ctx came exclusively
  // from the server-side session (getAuthContext -> Auth.js).
  const result = await retrieveAuthorizedChunks(ctx, query);
  return NextResponse.json(result);
}
