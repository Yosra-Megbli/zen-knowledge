import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { getAuditLogs, formatAuditLogsAsCsv } from "../../../../lib/admin/audit.ts";

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 5000 ? limitParam : (format === "csv" ? 5000 : 50);
  const pageParam = Number(url.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const result = await getAuditLogs(ctx, { limit, page });

  if (format === "csv") {
    const csvContent = formatAuditLogsAsCsv(result.rows);
    const today = new Date().toISOString().slice(0, 10);

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="zen-knowledge-audit-logs-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    total: result.total,
    page,
    limit,
    rows: result.rows,
  });
}
