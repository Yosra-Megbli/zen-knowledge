import { NextResponse } from "next/server";
import { getAuthContext } from "../../../../lib/permissions/authContext.ts";
import { ingestDocument, type IngestDocumentTarget } from "../../../../lib/ingestion/pipeline/ingestDocument.ts";
import { IngestionError, IngestionForbiddenError, IngestionNotFoundError } from "../../../../lib/ingestion/errors.ts";

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const data = Buffer.from(await file.arrayBuffer());

  // Any company_id / owner_id / role field present in the submitted
  // form is intentionally never read below. `target` only ever carries
  // metadata the uploader chooses (title/visibility/department/
  // reviewDate) — identity and authorization always come from `ctx`.
  const documentIdField = form.get("documentId");
  let target: IngestDocumentTarget;
  if (typeof documentIdField === "string" && documentIdField.length > 0) {
    target = { kind: "version", documentId: documentIdField };
  } else {
    const title = form.get("title");
    const visibility = form.get("visibility");
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required for a new document" }, { status: 400 });
    }
    if (visibility !== "company" && visibility !== "department" && visibility !== "restricted") {
      return NextResponse.json(
        { error: "visibility must be one of: company, department, restricted" },
        { status: 400 }
      );
    }
    const departmentId = form.get("departmentId");
    const reviewDate = form.get("reviewDate");
    const description = form.get("description");
    target = {
      kind: "new",
      title,
      description: typeof description === "string" && description ? description : null,
      departmentId: typeof departmentId === "string" && departmentId ? departmentId : null,
      visibility,
      reviewDate: typeof reviewDate === "string" && reviewDate ? reviewDate : null,
    };
  }

  try {
    const result = await ingestDocument({
      ctx,
      fileName: file.name,
      data,
      target,
      triggeredBy: `user:${ctx.userId}`,
    });
    return NextResponse.json(result, { status: result.status === "completed" ? 201 : 422 });
  } catch (err) {
    if (err instanceof IngestionForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof IngestionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof IngestionError) {
      const status = err.code === "DOCUMENT_DELETED" ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    // Never leak internal error details/stack traces to the client.
    console.error("POST /api/documents/upload: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
