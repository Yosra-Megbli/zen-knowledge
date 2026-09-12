import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { retryFailedVersion } from "../../../../../lib/ingestion/pipeline/retryVersion.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../../../lib/ingestion/errors.ts";

export async function POST(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { versionId } = await params;

  try {
    const result = await retryFailedVersion(ctx, versionId, `retry:${ctx.userId}`);
    return NextResponse.json(result, { status: result.status === "completed" ? 201 : 422 });
  } catch (err) {
    if (err instanceof IngestionForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof IngestionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof IngestionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    console.error("POST /api/documents/[versionId]/retry: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
