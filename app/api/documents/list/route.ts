import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../../lib/db/withAuthContext.ts";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await withAuthContext(ctx, async (client) => {
    const { rows } = await client.query<{
      id: string;
      title: string;
      description: string | null;
      visibility: string;
      status: string;
      owner_email: string;
      department_name: string | null;
      version_count: number;
      latest_version: number | null;
      latest_status: string | null;
      review_date: string | null;
      created_at: string;
    }>(`
      SELECT
        d.id,
        d.title,
        d.description,
        d.visibility,
        d.status,
        u.email AS owner_email,
        dep.name AS department_name,
        COUNT(v.id)::int AS version_count,
        MAX(v.version_number) AS latest_version,
        (SELECT v2.status FROM document_versions v2
         WHERE v2.document_id = d.id
         ORDER BY v2.version_number DESC LIMIT 1) AS latest_status,
        d.review_date,
        d.created_at
      FROM documents d
      JOIN users u ON u.id = d.owner_id
      LEFT JOIN departments dep ON dep.id = d.department_id
      LEFT JOIN document_versions v ON v.document_id = d.id
      WHERE d.status != 'deleted'
      GROUP BY d.id, u.email, dep.name
      ORDER BY d.created_at DESC
    `);
    return rows;
  });

  return NextResponse.json(rows);
}
