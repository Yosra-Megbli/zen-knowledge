import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";
import { estimateCostUsd } from "../../../../lib/rag/pricing.ts";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await withAuthContext(ctx, async (client) => {
    const [company, totals, costRows, feedbackRows, refusals, recent] = await Promise.all([
      client.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [ctx.companyId]),
      client.query<{ total: number; answers: number; errors: number; total_tokens: number | null }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE action = 'rag_answer')::int AS answers,
          COUNT(*) FILTER (WHERE action = 'rag_error')::int AS errors,
          SUM((metadata->>'totalTokens')::int) AS total_tokens
        FROM audit_logs
        WHERE action IN ('rag_answer','rag_refusal','rag_error')
      `),
      // Cost is computed in JS (lib/rag/pricing.ts), not SQL, so the
      // price table stays a single reusable/testable source of truth
      // instead of duplicated arithmetic — one row per priceable
      // answer is small enough at this dataset's scale.
      client.query<{ model: string | null; prompt_tokens: number | null; completion_tokens: number | null }>(`
        SELECT
          metadata->>'modelUsed' AS model,
          (metadata->>'promptTokens')::int AS prompt_tokens,
          (metadata->>'completionTokens')::int AS completion_tokens
        FROM audit_logs
        WHERE action = 'rag_answer'
      `),
      client.query<{ rating: "useful" | "not_useful"; count: number }>(`
        SELECT rating, COUNT(*)::int AS count FROM feedback GROUP BY rating
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
      client.query<{
        action: string;
        model: string | null;
        latency_ms: number | null;
        source_count: number;
        created_at: string;
        main_document_title: string | null;
      }>(`
        SELECT
          al.action,
          al.metadata->>'modelUsed' AS model,
          (al.metadata->>'latencyMs')::int AS latency_ms,
          (al.metadata->>'sourceCount')::int AS source_count,
          al.created_at,
          d.title AS main_document_title
        FROM audit_logs al
        LEFT JOIN document_chunks dc ON dc.id = (al.metadata->'chunkIds'->>0)::uuid
        LEFT JOIN documents d ON d.id = dc.document_id
        WHERE al.action IN ('rag_answer','rag_refusal','rag_error')
        ORDER BY al.created_at DESC
        LIMIT 50
      `),
    ]);

    const estimatedCostUsd = costRows.rows.reduce(
      (sum, r) => sum + estimateCostUsd(r.model, r.prompt_tokens, r.completion_tokens),
      0
    );

    const feedbackByRating = { useful: 0, not_useful: 0 };
    for (const r of feedbackRows.rows) feedbackByRating[r.rating] = r.count;

    return {
      companyName: company.rows[0]?.name ?? null,
      totals: totals.rows[0],
      estimatedCostUsd,
      feedback: feedbackByRating,
      refusals: refusals.rows,
      recent: recent.rows,
    };
  });

  return NextResponse.json(data);
}
