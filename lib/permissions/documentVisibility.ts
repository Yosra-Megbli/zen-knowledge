import type { AuthContext } from "./authContext.ts";

export type DocumentVisibility = "company" | "department" | "restricted";

export interface VisibilityCheckInput {
  visibility: DocumentVisibility | string;
  departmentId: string | null;
}

/**
 * The single source of truth for "can this authenticated user see a
 * document/version/file given its visibility", mirroring the
 * document_chunks_select RLS policy (0009_rls_and_grants.sql) exactly.
 *
 * Needed because documents/document_versions RLS only enforces company
 * isolation (by design, for library management — see 0009's comments),
 * NOT visibility. Any code path that exposes document/version content
 * or files (not just chunk retrieval) MUST call this — see
 * app/api/documents/[versionId]/file/route.ts.
 */
export function canAccessDocumentVisibility(ctx: AuthContext, doc: VisibilityCheckInput): boolean {
  if (doc.visibility === "company") return true;
  if (doc.visibility === "department") {
    return doc.departmentId !== null && doc.departmentId === ctx.departmentId;
  }
  if (doc.visibility === "restricted") {
    return ctx.role === "admin";
  }
  return false;
}
