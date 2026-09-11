import { withAuthContext } from "../db/withAuthContext.ts";
import type { AuthContext } from "../permissions/authContext.ts";

export interface RagAuditEntry {
  action: "rag_answer" | "rag_refusal" | "rag_error";
  sourceCount: number;
  refusal: boolean;
  modelUsed: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  errorCategory: string | null;
  // Question text is stored only as a length indicator to avoid
  // retaining full user queries in the audit log by default.
  questionLength: number;
  chunkIds: string[];
}

/**
 * Writes one row to audit_logs. Uses app_role via withAuthContext so
 * RLS applies — the audit row is scoped to the same company as the
 * request. Never logs API keys, passwords, or auth tokens.
 * Best-effort: a failure here must never surface to the end user.
 */
export async function writeRagAudit(ctx: AuthContext, entry: RagAuditEntry): Promise<void> {
  const metadata = {
    sourceCount: entry.sourceCount,
    refusal: entry.refusal,
    modelUsed: entry.modelUsed,
    latencyMs: entry.latencyMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    errorCategory: entry.errorCategory,
    questionLength: entry.questionLength,
    chunkIds: entry.chunkIds,
  };

  try {
    await withAuthContext(ctx, (client) =>
      client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, resource_type, metadata)
         VALUES ($1, $2, $3, 'rag_request', $4)`,
        [ctx.companyId, ctx.userId, entry.action, JSON.stringify(metadata)]
      )
    );
  } catch {
    // Audit failure must never break the user-facing response.
    // Errors are intentionally swallowed here — in a production system
    // this would emit a metric/alert instead.
  }
}
