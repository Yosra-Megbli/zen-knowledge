import { NextResponse } from "next/server";
import { getAuthContext } from "../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../lib/db/withAuthContext.ts";

// GET /api/conversations
//
// Lists the CALLER'S OWN conversations, most recently active first.
//
// RLS on `conversations` (db/migrations/0009) is company-isolation
// only (`company_id = app_current_company_id()`), the same coarse
// boundary used on `documents`/`document_versions` — it does not know
// about per-user ownership. Exactly like
// app/api/documents/[versionId]/file/route.ts already does for
// visibility, this route adds the narrower "mine only" filter itself
// (`user_id = $1`) on top of RLS, rather than writing a new migration
// for a restriction only this one read path needs — a company-wide
// admin view over conversations, if ever built, would want the
// broader RLS boundary intact.
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await withAuthContext(ctx, async (client) => {
    const { rows } = await client.query<{ id: string; title: string | null; updated_at: string }>(
      `SELECT id, title, updated_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [ctx.userId]
    );
    return rows;
  });

  return NextResponse.json(rows);
}
