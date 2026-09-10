import type { PoolClient } from "pg";
import { getAppPool } from "./appPool.ts";
import type { AuthContext } from "../permissions/authContext.ts";

/**
 * Runs fn(client) inside BEGIN/COMMIT on a pooled app_role connection,
 * having first set the authorization context as transaction-LOCAL
 * settings (set_config('app.xxx', value, true)). This is the ONLY
 * sanctioned way for application code to touch RLS-protected tables —
 * see db/migrations/0009_rls_and_grants.sql for the policies this
 * context feeds, and README "Authorization context" for the full flow
 * diagram (Auth.js session -> AuthContext -> here -> RLS).
 *
 * The client is always released back to the pool, and LOCAL settings
 * never survive past COMMIT/ROLLBACK — verified by
 * tests/integration/rls/context-lifecycle.test.mjs (TEST 10) at the
 * database level, and by tests/integration/rag/retrieval.test.ts at
 * this function's own level.
 */
export async function withAuthContext<T>(
  ctx: AuthContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [ctx.companyId]);
    await client.query("SELECT set_config('app.role', $1, true)", [ctx.role]);
    if (ctx.departmentId) {
      await client.query("SELECT set_config('app.department_id', $1, true)", [ctx.departmentId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
