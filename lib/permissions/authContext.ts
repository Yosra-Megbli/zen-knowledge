import { auth } from "../../auth.ts";

export type Role = "admin" | "contributor" | "employee";

export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  departmentId: string | null;
}

/**
 * The ONLY place company_id/role/department_id are read for the
 * purpose of building an authorization context. Values come exclusively
 * from the server-side Auth.js session (a signed JWT the browser cannot
 * forge or edit) — never from a request body, query string, or header.
 *
 * Returns null both when there is no session AND when an authenticated
 * user has no company_id (e.g. a user record created without one).
 * Callers MUST treat null as "deny" — there is no fallback company and
 * none is ever silently assigned here.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.companyId) {
    return null;
  }
  return {
    userId: user.id,
    companyId: user.companyId,
    role: user.role,
    departmentId: user.departmentId ?? null,
  };
}
