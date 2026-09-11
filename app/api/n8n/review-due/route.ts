import { NextResponse } from "next/server";
import { getAppPool } from "../../../../lib/db/appPool.ts";

// GET /api/n8n/review-due?warningDays=7&graceDays=30
//
// Returns published documents whose review_date is approaching or past.
// Called by the n8n W3 cron workflow.
//
// Auth: X-N8N-Secret shared secret (same as W1).
//
// Uses w3_get_review_due_documents() — a SECURITY DEFINER function
// (migration 0016) that allows app_role to scan across all companies
// for this administrative cron, without weakening per-user RLS.
// Same pattern as auth_find_user_by_email (migration 0010).
//
// warningDays: days before review_date to start warning (default 7)
// graceDays:   days past review_date before auto-unpublish (default 30)

export async function GET(request: Request) {
  const secret = request.headers.get("x-n8n-secret");
  const expectedSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("GET /api/n8n/review-due: N8N_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  if (!secret || secret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const warningDays = Math.max(1, Number(url.searchParams.get("warningDays") ?? 7));
  const graceDays = Math.max(1, Number(url.searchParams.get("graceDays") ?? 30));

  const pool = getAppPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      document_id: string;
      company_id: string;
      title: string;
      review_date: string;
      days_past_due: number;
      owner_id: string;
      owner_email: string;
      task_id: string | null;
      task_status: string | null;
      task_notified_at: string | null;
      task_reminded_at: string | null;
    }>(
      `SELECT * FROM w3_get_review_due_documents($1)`,
      [warningDays]
    );

    const items = rows.map((row) => {
      const daysPastDue = Number(row.days_past_due);
      let classification: "warning" | "overdue" | "unpublish";
      if (daysPastDue > graceDays) {
        classification = "unpublish";
      } else if (daysPastDue > 0) {
        classification = "overdue";
      } else {
        classification = "warning";
      }
      return { ...row, days_past_due: daysPastDue, classification };
    });

    return NextResponse.json({
      items,
      count: items.length,
      warningDays,
      graceDays,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/n8n/review-due: error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
