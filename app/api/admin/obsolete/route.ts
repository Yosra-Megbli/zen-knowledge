import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";
import { captureError } from "../../../../lib/monitoring/logger.ts";

export interface ObsoleteDocRow {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  visibility: string;
  review_date: string;
  owner_email: string;
  owner_name?: string | null;
  department_name: string | null;
  days_overdue: number;     // positive = overdue, negative = approaching (days until due)
  status: "overdue" | "approaching" | "unpublished";
  rt_id?: string | null;
  rt_status?: string | null;
  rt_notified_at?: string | null;
  rt_reminded_at?: string | null;
  reminder_count?: number;
}

/**
 * GET /api/admin/obsolete
 *
 * Returns:
 *  - "overdue"     : published documents whose review_date < TODAY
 *  - "approaching" : published documents whose review_date is within the
 *                    next APPROACHING_DAYS days (today included)
 *  - "unpublished" : documents previously unpublished (available to republish)
 */
const APPROACHING_DAYS = 30;

export async function GET() {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const data = await withAuthContext(ctx, async (client) => {
      const hasReviewTasks = await client.query<{ exists: boolean }>(`
        SELECT (to_regclass('public.review_tasks') IS NOT NULL) AS exists
      `).then((r) => Boolean(r.rows[0]?.exists)).catch(() => false);

      const hasReminderCount = hasReviewTasks
        ? await client.query<{ exists: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'review_tasks' AND column_name = 'reminder_count'
            ) as exists
          `).then((r) => Boolean(r.rows[0]?.exists)).catch(() => false)
        : false;

      const reviewTasksJoin = hasReviewTasks
        ? `LEFT JOIN review_tasks rt ON rt.document_id = d.id AND rt.status NOT IN ('resolved')`
        : "";

      const reviewTasksSelect = hasReviewTasks
        ? hasReminderCount
          ? `rt.id AS rt_id, rt.status AS rt_status, rt.notified_at AS rt_notified_at, rt.reminded_at AS rt_reminded_at, COALESCE(rt.reminder_count, 0) AS reminder_count`
          : `rt.id AS rt_id, rt.status AS rt_status, rt.notified_at AS rt_notified_at, rt.reminded_at AS rt_reminded_at, (CASE WHEN rt.reminded_at IS NOT NULL THEN 1 ELSE 0 END) AS reminder_count`
        : `NULL AS rt_id, NULL AS rt_status, NULL AS rt_notified_at, NULL AS rt_reminded_at, 0 AS reminder_count`;

      const rows = await client.query<ObsoleteDocRow>(`
        SELECT
          d.id,
          v.id                                          AS version_id,
          d.title,
          d.description,
          d.visibility,
          d.review_date::text                           AS review_date,
          u.email                                       AS owner_email,
          COALESCE(u.name, u.email)                     AS owner_name,
          dep.name                                      AS department_name,
          (CURRENT_DATE - d.review_date::date)::int     AS days_overdue,
          CASE
            WHEN d.status = 'unpublished'                THEN 'unpublished'
            WHEN d.review_date::date < CURRENT_DATE      THEN 'overdue'
            ELSE                                              'approaching'
          END                                           AS status,
          ${reviewTasksSelect}
        FROM documents d
        JOIN document_versions v ON v.id = d.current_version_id
        JOIN users u              ON u.id = v.uploaded_by
        LEFT JOIN departments dep ON dep.id = d.department_id
        ${reviewTasksJoin}
        WHERE (
          (d.status = 'published' AND d.review_date IS NOT NULL AND d.review_date::date <= (CURRENT_DATE + INTERVAL '30 days')::date)
          OR (d.status = 'unpublished' AND d.review_date IS NOT NULL)
        )
        ORDER BY d.review_date ASC
      `);

      const overdue     = rows.rows.filter((r) => r.status === "overdue");
      const approaching = rows.rows.filter((r) => r.status === "approaching");
      const unpublished = rows.rows.filter((r) => r.status === "unpublished");

      return { overdue, approaching, unpublished, approachingDays: APPROACHING_DAYS };
    });

    return NextResponse.json(data);
  } catch (err) {
    captureError(err, { route: "admin/obsolete" });
    return NextResponse.json(
      {
        error: "Impossible de charger les documents à réviser.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
