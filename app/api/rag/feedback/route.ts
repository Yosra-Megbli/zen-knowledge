import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { persistFeedback } from "../../../../lib/conversation/persist.ts";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const messageId = typeof body.messageId === "string" ? body.messageId : null;
  const rating = body.rating === "useful" || body.rating === "not_useful" ? body.rating : null;

  if (!messageId || !rating) {
    return NextResponse.json({ error: "messageId and rating (useful|not_useful) are required" }, { status: 400 });
  }

  try {
    await persistFeedback(ctx, messageId, rating);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/rag/feedback: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
