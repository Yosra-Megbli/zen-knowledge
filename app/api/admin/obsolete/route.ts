import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";

export interface ObsoleteDocRow {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  visibility: string;
  review_date: string;
  owner_email: string;
  department_name: string | null;
  days_overdue: number;     // positive = overdue, negative = approaching (days until due)
  status: "overdue" | "approaching";
}

/**
 * GET /api/admin/obsolete
 *
 * Returns two buckets (both scoped to the caller's company via RLS):
 *  - "overdue"     : published documents whose review_date < TODAY
 *  - "approaching" : published documents whose review_date is within the
 *                    next APPROACHING_DAYS days (today included)
 *
 * No query parameter: returns the full dataset (typically small enough to
 * fit in one response at any real-world scale).
 */
const APPROACHING_DAYS = 30;

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await withAuthContext(ctx, async (client) => {
    const rows = await client.query<ObsoleteDocRow>(`
      SELECT
        d.id,
        v.id                                          AS version_id,
        d.title,
        d.description,
        d.visibility,
        d.review_date::text                           AS review_date,
        u.email                                       AS owner_email,
        dep.name                                      AS department_name,
        (CURRENT_DATE - d.review_date::date)::int     AS days_overdue,
        CASE
          WHEN d.review_date::date < CURRENT_DATE      THEN 'overdue'
          ELSE                                              'approaching'
        END                                           AS status
      FROM documents d
      JOIN document_versions v ON v.document_id = d.id AND v.status = 'published'
      JOIN users u              ON u.id = v.uploaded_by
      LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.status = 'published'
        AND d.review_date IS NOT NULL
        AND d.review_date::date <= CURRENT_DATE + $1
      ORDER BY d.review_date ASC
    `, [APPROACHING_DAYS]);

    const overdue     = rows.rows.filter((r) => r.status === "overdue");
    const approaching = rows.rows.filter((r) => r.status === "approaching");

    return { overdue, approaching, approachingDays: APPROACHING_DAYS };
  });

  return NextResponse.json(data);
}
