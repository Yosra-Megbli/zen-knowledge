import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { deleteConversation } from "../../../../../lib/conversation/persist.ts";

// POST /api/conversations/[id]/delete
//
// Same ownership pattern as GET /api/conversations/[id]/messages:
// RLS on conversations is company-isolation only (db/migrations/0009),
// so per-user ownership is enforced here, in the query itself
// (deleteConversation), not as a separate check — a same-company
// colleague's conversation returns 404, identical to one that doesn't
// exist, never 403.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const deleted = await deleteConversation(ctx, id);
    if (!deleted) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("POST /api/conversations/[id]/delete: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
