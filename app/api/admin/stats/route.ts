import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await withAuthContext(ctx, async (client) => {
    const [totals, refusals, recent] = await Promise.all([
      client.query<{ total: number; answers: number; errors: number; total_tokens: number | null }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE action = 'rag_answer')::int AS answers,
          COUNT(*) FILTER (WHERE action = 'rag_error')::int AS errors,
          SUM((metadata->>'totalTokens')::int) AS total_tokens
        FROM audit_logs
        WHERE action IN ('rag_answer','rag_refusal','rag_error')
      `),
      client.query<{ question_length: number; created_at: string }>(`
        SELECT
          (metadata->>'questionLength')::int AS question_length,
          created_at
        FROM audit_logs
        WHERE action = 'rag_refusal'
        ORDER BY created_at DESC
        LIMIT 20
      `),
      client.query<{ action: string; model: string | null; latency_ms: number | null; source_count: number; created_at: string }>(`
        SELECT
          action,
          metadata->>'modelUsed' AS model,
          (metadata->>'latencyMs')::int AS latency_ms,
          (metadata->>'sourceCount')::int AS source_count,
          created_at
        FROM audit_logs
        WHERE action IN ('rag_answer','rag_refusal','rag_error')
        ORDER BY created_at DESC
        LIMIT 50
      `),
    ]);
    return {
      totals: totals.rows[0],
      refusals: refusals.rows,
      recent: recent.rows,
    };
  });

  return NextResponse.json(data);
}
