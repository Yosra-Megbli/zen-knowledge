import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";
import { estimateCostUsd } from "../../../../lib/rag/pricing.ts";
import { captureError } from "../../../../lib/monitoring/logger.ts";

const ACTIVITY_PAGE_SIZE = 15;

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // Only the activity table is paginated — every KPI aggregate below
    // (totals, cost, feedback, refusals) still runs over the full,
    // unpaginated dataset.
    const pageParam = Number(new URL(request.url).searchParams.get("page"));
    const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
    const offset = (page - 1) * ACTIVITY_PAGE_SIZE;

    const data = await withAuthContext(ctx, async (client) => {
      // Check if review_tasks table exists to remain backward-compatible
      // even if migration 0015 has not been applied yet in production.
      const hasReviewTasksRes = await client.query<{ has_table: boolean }>(`
        SELECT (to_regclass('public.review_tasks') IS NOT NULL) AS has_table
      `).catch(() => ({ rows: [{ has_table: false }] }));
      const hasReviewTasks = Boolean(hasReviewTasksRes.rows[0]?.has_table);

      const overdueQuery = hasReviewTasks
        ? `
          SELECT
            d.id,
            v.id AS version_id,
            d.title,
            d.review_date,
            u.email AS owner_email,
            COALESCE(u.name, u.email) AS owner_name,
            (CURRENT_DATE - d.review_date::date)::int AS days_overdue,
            rt.status                                   AS rt_status,
            rt.notified_at                              AS rt_notified_at,
            rt.reminded_at                              AS rt_reminded_at
          FROM documents d
          JOIN document_versions v ON v.document_id = d.id AND v.status = 'published'
          JOIN users u ON u.id = v.uploaded_by
          LEFT JOIN review_tasks rt
            ON rt.document_id = d.id
           AND rt.status NOT IN ('unpublished', 'resolved')
          WHERE d.status = 'published'
            AND d.review_date IS NOT NULL
            AND d.review_date::date < CURRENT_DATE
          ORDER BY d.review_date ASC
        `
        : `
          SELECT
            d.id,
            v.id AS version_id,
            d.title,
            d.review_date,
            u.email AS owner_email,
            COALESCE(u.name, u.email) AS owner_name,
            (CURRENT_DATE - d.review_date::date)::int AS days_overdue,
            NULL::text                                  AS rt_status,
            NULL::timestamptz                           AS rt_notified_at,
            NULL::timestamptz                           AS rt_reminded_at
          FROM documents d
          JOIN document_versions v ON v.document_id = d.id AND v.status = 'published'
          JOIN users u ON u.id = v.uploaded_by
          WHERE d.status = 'published'
            AND d.review_date IS NOT NULL
            AND d.review_date::date < CURRENT_DATE
          ORDER BY d.review_date ASC
        `;

      const [company, totals, costRows, feedbackRows, refusals, recent, overdue] = await Promise.all([
        client.query<{ name: string }>(`SELECT name FROM companies WHERE id = $1`, [ctx.companyId]),
        client.query<{ total: number; answers: number; errors: number; total_tokens: number | null }>(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE action = 'rag_answer')::int AS answers,
            COUNT(*) FILTER (WHERE action = 'rag_error')::int AS errors,
            SUM((metadata->>'totalTokens')::int)::int AS total_tokens
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
          LIMIT $1 OFFSET $2
        `, [ACTIVITY_PAGE_SIZE + 1, offset]),
        // Documents whose review date has passed and are still published —
        // scoped to the caller's company by RLS (no WHERE company_id needed).
        // CURRENT_DATE used (not NOW()) because review_date is a date column,
        // not a timestamp — comparing with NOW() would do an implicit cast.
        // If review_tasks exists, LEFT JOIN surfaces the W3 notification state.
        client.query<{ id: string; version_id: string; title: string; review_date: string; owner_email: string; owner_name: string; days_overdue: number; rt_status: string | null; rt_notified_at: string | null; rt_reminded_at: string | null }>(
          overdueQuery
        ).catch((err) => {
          captureError(err, { route: "admin/stats", query: "overdue" });
          return { rows: [] };
        }),
      ]);

      const estimatedCostUsd = costRows.rows.reduce(
        (sum, r) => sum + estimateCostUsd(r.model, r.prompt_tokens, r.completion_tokens),
        0
      );

      const feedbackByRating = { useful: 0, not_useful: 0 };
      for (const r of feedbackRows.rows) feedbackByRating[r.rating] = r.count;

      const hasNextPage = recent.rows.length > ACTIVITY_PAGE_SIZE;
      const recentRows = hasNextPage ? recent.rows.slice(0, ACTIVITY_PAGE_SIZE) : recent.rows;

      return {
        companyName: company.rows[0]?.name ?? null,
        totals: totals.rows[0],
        estimatedCostUsd,
        feedback: feedbackByRating,
        refusals: refusals.rows,
        recent: { rows: recentRows, page, hasNextPage },
        overdueDocuments: overdue.rows,
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    captureError(err, { route: "admin/stats" });
    return NextResponse.json(
      {
        error: "Impossible de charger les statistiques.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
