import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";

// GET /api/conversations/[id]/messages
//
// Returns one conversation's full turn history plus each assistant
// message's citations, resolved against the CURRENT title/status of
// the cited document version (not a snapshot) — an old citation
// pointing at a version later archived/deleted still resolves, it
// just carries that current status so the UI can show it accurately.
//
// Ownership check: same reasoning as GET /api/conversations — RLS is
// company-wide, so this route additionally requires the conversation's
// user_id to match the caller, returning 404 (never 403) when it
// doesn't, so a conversation belonging to a same-company colleague is
// indistinguishable from one that doesn't exist at all.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const result = await withAuthContext(ctx, async (client) => {
    const convRes = await client.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, ctx.userId]
    );
    if (convRes.rowCount === 0) return null;

    const messagesRes = await client.query<{
      id: string;
      role: "user" | "assistant";
      content: string;
      latency_ms: number | null;
      created_at: string;
    }>(
      `SELECT id, role, content, latency_ms, created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const citationsRes = await client.query<{
      message_id: string;
      document_version_id: string;
      chunk_id: string | null;
      page_number: number | null;
      snippet_text: string;
      document_title: string;
      version_number: number;
      version_status: string;
      document_status: string;
    }>(
      `SELECT
         cit.message_id,
         cit.document_version_id,
         cit.chunk_id,
         cit.page_number,
         cit.snippet_text,
         d.title AS document_title,
         v.version_number,
         v.status AS version_status,
         d.status AS document_status
       FROM citations cit
       JOIN document_versions v ON v.id = cit.document_version_id
       JOIN documents d ON d.id = v.document_id
       WHERE cit.message_id = ANY($1)
       ORDER BY cit.created_at ASC`,
      [messagesRes.rows.map((m) => m.id)]
    );

    const feedbackRes = await client.query<{ message_id: string; rating: "useful" | "not_useful" }>(
      `SELECT message_id, rating FROM feedback WHERE message_id = ANY($1)`,
      [messagesRes.rows.map((m) => m.id)]
    );

    return { messages: messagesRes.rows, citations: citationsRes.rows, feedback: feedbackRes.rows };
  });

  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const citationsByMessage = new Map<string, typeof result.citations>();
  for (const c of result.citations) {
    const list = citationsByMessage.get(c.message_id) ?? [];
    list.push(c);
    citationsByMessage.set(c.message_id, list);
  }
  const feedbackByMessage = new Map(result.feedback.map((f) => [f.message_id, f.rating]));

  const messages = result.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    latencyMs: m.latency_ms,
    feedback: feedbackByMessage.get(m.id) ?? null,
    // sourceIndex is a best-effort reconstruction (citations table has
    // no stored [SOURCE n] number — see route comment above) — chunk
    // insertion order approximates the model's original numbering
    // closely enough for display, but isn't guaranteed to match
    // [SOURCE n] markers still literally present in `content` 1:1.
    citations: (citationsByMessage.get(m.id) ?? []).map((c, i) => ({
      sourceIndex: i + 1,
      chunkId: c.chunk_id,
      documentVersionId: c.document_version_id,
      documentTitle: c.document_title,
      versionNumber: c.version_number,
      versionStatus: c.version_status,
      documentStatus: c.document_status,
      pageNumber: c.page_number,
      snippetText: c.snippet_text,
    })),
  }));

  return NextResponse.json({ messages });
}
