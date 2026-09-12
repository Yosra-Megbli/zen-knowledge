import { withAuthContext } from "../db/withAuthContext.ts";
import type { AuthContext } from "../permissions/authContext.ts";
import type { RagAnswer } from "../rag/answerQuestion.ts";

export async function ensureConversation(
  ctx: AuthContext,
  conversationId: string | null,
  firstQuestion: string
): Promise<string> {
  return withAuthContext(ctx, async (client) => {
    if (conversationId) {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM conversations WHERE id = $1`,
        [conversationId]
      );
      if (res.rows[0]) return res.rows[0].id;
    }
    const title = firstQuestion.slice(0, 80);
    const res = await client.query<{ id: string }>(
      `INSERT INTO conversations (company_id, user_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [ctx.companyId, ctx.userId, title]
    );
    return res.rows[0].id;
  });
}

// Persists a user+assistant turn and returns the assistant message id.
export async function persistTurn(
  ctx: AuthContext,
  conversationId: string,
  question: string,
  result: RagAnswer
): Promise<string> {
  return withAuthContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO conversation_messages (conversation_id, company_id, role, content)
       VALUES ($1, $2, 'user', $3)`,
      [conversationId, ctx.companyId, question]
    );

    const msgRes = await client.query<{ id: string }>(
      `INSERT INTO conversation_messages
         (conversation_id, company_id, role, content, model_used, latency_ms)
       VALUES ($1, $2, 'assistant', $3, $4, $5) RETURNING id`,
      [
        conversationId,
        ctx.companyId,
        result.answer,
        result.metadata.model ?? null,
        result.metadata.latencyMs ?? null,
      ]
    );
    const messageId = msgRes.rows[0].id;

    // So a conversation resumed after new activity sorts to the top of
    // GET /api/conversations (ORDER BY updated_at DESC) instead of
    // staying pinned at its original creation time forever.
    await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);

    for (const c of result.citations) {
      await client.query(
        `INSERT INTO citations
           (message_id, company_id, document_version_id, chunk_id, snippet_text, source_index)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, ctx.companyId, c.documentVersionId, c.chunkId, c.snippetText, c.sourceIndex]
      );
    }

    return messageId;
  });
}

// Hard delete — no soft-delete mechanism exists for conversations (unlike
// documents), and there's no citation-style "keep the row for historical
// display" requirement here: a deleted conversation should simply be
// gone. Deletes children before parents (no ON DELETE CASCADE on
// conversation_messages/citations/feedback — db/migrations/0006) inside
// one transaction. Scoped to `id AND user_id = ctx.userId` in the SAME
// query that finds the conversation, not a separate ownership check
// after the fact — a conversation belonging to a same-company colleague
// simply doesn't match and returns false, identical to "doesn't exist",
// mirroring the 404-not-403 pattern already used by
// GET /api/conversations/[id]/messages.
export async function deleteConversation(ctx: AuthContext, conversationId: string): Promise<boolean> {
  return withAuthContext(ctx, async (client) => {
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, ctx.userId]
    );
    if (owned.rowCount === 0) return false;

    await client.query(
      `DELETE FROM feedback WHERE message_id IN
         (SELECT id FROM conversation_messages WHERE conversation_id = $1)`,
      [conversationId]
    );
    await client.query(
      `DELETE FROM citations WHERE message_id IN
         (SELECT id FROM conversation_messages WHERE conversation_id = $1)`,
      [conversationId]
    );
    await client.query(`DELETE FROM conversation_messages WHERE conversation_id = $1`, [conversationId]);
    await client.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
    return true;
  });
}

// rating: 'useful' | 'not_useful' — matches the DB CHECK constraint.
export async function persistFeedback(
  ctx: AuthContext,
  messageId: string,
  rating: "useful" | "not_useful"
): Promise<void> {
  await withAuthContext(ctx, (client) =>
    client.query(
      `INSERT INTO feedback (message_id, company_id, user_id, rating)
       VALUES ($1, $2, $3, $4)`,
      [messageId, ctx.companyId, ctx.userId, rating]
    )
  );
}
