import { NextResponse } from "next/server";
import { getAuthContext } from "../../../lib/permissions/authContext.ts";
import { withAuthContext } from "../../../lib/db/withAuthContext.ts";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await withAuthContext(ctx, async (client) => {
    const res = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM departments ORDER BY name ASC`
    );
    return res.rows;
  });

  return NextResponse.json(rows);
}
