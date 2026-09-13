import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import { unpublishDocument } from "../../../../../lib/ingestion/pipeline/unpublishDocument.ts";
import { republishDocument } from "../../../../../lib/ingestion/pipeline/republishDocument.ts";
import { captureError } from "../../../../../lib/monitoring/logger.ts";

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const { documentId, action } = body as { documentId?: string; action?: string };

    if (!documentId || !action) {
      return NextResponse.json(
        { error: "documentId et action ('notify' | 'remind' | 'unpublish' | 'republish') sont requis." },
        { status: 400 }
      );
    }

    if (action === "unpublish") {
      const result = await unpublishDocument(ctx, documentId);
      // Mark any open review task as unpublished
      await withAuthContext(ctx, async (client) => {
        await client.query(
          `UPDATE review_tasks SET status = 'unpublished', updated_at = now() WHERE document_id = $1 AND status IN ('warning', 'overdue')`,
          [documentId]
        ).catch(() => {});
      });
      return NextResponse.json({ ok: true, action: "unpublish", documentVersionId: result.documentVersionId });
    }

    if (action === "republish") {
      const result = await republishDocument(ctx, documentId);
      await withAuthContext(ctx, async (client) => {
        await client.query(
          `UPDATE review_tasks SET status = 'warning', updated_at = now() WHERE document_id = $1 AND status = 'unpublished'`,
          [documentId]
        ).catch(() => {});
      });
      return NextResponse.json({ ok: true, action: "republish", documentVersionId: result.documentVersionId });
    }

    if (action === "notify" || action === "remind") {
      const taskResult = await withAuthContext(ctx, async (client) => {
        // Fetch document info to ensure it exists and get owner and due date
        const docRes = await client.query<{ id: string; owner_id: string; review_date: string; days_overdue: number }>(
          `SELECT id, owner_id, review_date::text, (CURRENT_DATE - review_date::date)::int AS days_overdue
           FROM documents WHERE id = $1 AND status = 'published'`,
          [documentId]
        );
        if (docRes.rowCount === 0) {
          throw new Error("Document introuvable ou non publié.");
        }
        const doc = docRes.rows[0];
        const classification = doc.days_overdue > 0 ? "overdue" : "warning";

        const hasReminderCountCol = await client.query<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'review_tasks' AND column_name = 'reminder_count'
          ) as exists
        `).then((r) => r.rows[0]?.exists).catch(() => false);

        if (action === "notify") {
          const insertQuery = hasReminderCountCol
            ? `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at, reminder_count)
               VALUES ($1, $2, $3, $4, $5, now(), 0)
               ON CONFLICT (document_id) WHERE status IN ('warning', 'overdue')
               DO UPDATE SET notified_at = COALESCE(review_tasks.notified_at, now()), updated_at = now()
               RETURNING id, status, notified_at, reminded_at, reminder_count`
            : `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at)
               VALUES ($1, $2, $3, $4, $5, now())
               ON CONFLICT (document_id) WHERE status IN ('warning', 'overdue')
               DO UPDATE SET notified_at = COALESCE(review_tasks.notified_at, now()), updated_at = now()
               RETURNING id, status, notified_at, reminded_at, 0 AS reminder_count`;

          const res = await client.query(insertQuery, [doc.id, ctx.companyId, doc.owner_id, classification, doc.review_date]);
          return res.rows[0];
        } else {
          // remind
          const updateQuery = hasReminderCountCol
            ? `UPDATE review_tasks
               SET reminded_at = now(),
                   reminder_count = COALESCE(reminder_count, 0) + 1,
                   updated_at = now()
               WHERE document_id = $1 AND status IN ('warning', 'overdue')
               RETURNING id, status, notified_at, reminded_at, reminder_count`
            : `UPDATE review_tasks
               SET reminded_at = now(),
                   updated_at = now()
               WHERE document_id = $1 AND status IN ('warning', 'overdue')
               RETURNING id, status, notified_at, reminded_at, 1 AS reminder_count`;

          const res = await client.query(updateQuery, [doc.id]);
          if (res.rowCount === 0) {
            const resInsert = await client.query(
              hasReminderCountCol
                ? `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at, reminded_at, reminder_count)
                   VALUES ($1, $2, $3, $4, $5, now(), now(), 1)
                   RETURNING id, status, notified_at, reminded_at, reminder_count`
                : `INSERT INTO review_tasks (document_id, company_id, owner_id, status, due_date, notified_at, reminded_at)
                   VALUES ($1, $2, $3, $4, $5, now(), now())
                   RETURNING id, status, notified_at, reminded_at, 1 AS reminder_count`,
              [doc.id, ctx.companyId, doc.owner_id, classification, doc.review_date]
            );
            return resInsert.rows[0];
          }
          return res.rows[0];
        }
      });

      return NextResponse.json({ ok: true, action, task: taskResult });
    }

    return NextResponse.json({ error: "Action non reconnue." }, { status: 400 });
  } catch (err) {
    captureError(err, { route: "admin/obsolete/action" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors de l'exécution de l'action." },
      { status: 500 }
    );
  }
}
