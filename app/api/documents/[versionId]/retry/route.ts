import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { retryFailedVersion } from "../../../../../lib/ingestion/pipeline/retryVersion.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../../../lib/ingestion/errors.ts";

export async function POST(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { versionId } = await params;
    const result = await retryFailedVersion(ctx, versionId, `retry:${ctx.userId}`);
    if (result.status === "failed") {
      return NextResponse.json(
        { error: result.errorMessage ?? "Échec lors de la réindexation.", ...result },
        { status: 422 }
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof IngestionForbiddenError || (err as Error)?.name === "IngestionForbiddenError") {
      return NextResponse.json({ error: (err as Error).message }, { status: 403 });
    }
    if (err instanceof IngestionNotFoundError || (err as Error)?.name === "IngestionNotFoundError") {
      return NextResponse.json({ error: (err as Error).message }, { status: 404 });
    }
    if (err instanceof IngestionError || (err as Error)?.name === "IngestionError") {
      return NextResponse.json({ error: (err as Error).message, code: (err as IngestionError).code }, { status: 422 });
    }
    const message = (err as Error)?.message || "Erreur interne lors de la réindexation.";
    console.error("POST /api/documents/[versionId]/retry: unexpected error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
