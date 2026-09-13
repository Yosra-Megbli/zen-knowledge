import { withAuthContext } from "../db/withAuthContext.ts";
import type { AuthContext } from "../permissions/authContext.ts";

export interface AuditLogRow {
  id: string;
  company_id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GetAuditLogsResult {
  total: number;
  rows: AuditLogRow[];
}

export async function getAuditLogs(
  ctx: AuthContext,
  options: { limit?: number; page?: number } = {}
): Promise<GetAuditLogsResult> {
  const limit = options.limit && options.limit > 0 ? options.limit : 50;
  const page = options.page && options.page > 0 ? options.page : 1;
  const offset = (page - 1) * limit;

  return withAuthContext(ctx, async (client) => {
    const countRes = await client.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM audit_logs
    `);
    const total = countRes.rows[0]?.count ?? 0;

    const rowsRes = await client.query<AuditLogRow>(`
      SELECT
        a.id,
        a.company_id,
        a.user_id,
        u.email AS user_email,
        a.action,
        a.resource_type,
        a.resource_id,
        a.metadata,
        a.created_at
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return { total, rows: rowsRes.rows };
  });
}

export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "object" ? JSON.stringify(val) : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatAuditLogsAsCsv(rows: AuditLogRow[]): string {
  const headers = ["id", "timestamp", "user_email", "action", "resource_type", "resource_id", "metadata"];
  const lines = [
    headers.join(","),
    ...rows.map((r) => [
      escapeCsvField(r.id),
      escapeCsvField(r.created_at),
      escapeCsvField(r.user_email),
      escapeCsvField(r.action),
      escapeCsvField(r.resource_type),
      escapeCsvField(r.resource_id),
      escapeCsvField(r.metadata),
    ].join(","))
  ];
  return lines.join("\r\n");
}
