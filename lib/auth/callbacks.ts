// Pure auth logic, deliberately kept free of any `next-auth` or
// `next/*` import. auth.ts (project root) imports these functions and
// wires them into NextAuth(), but that wiring — and only that wiring —
// depends on next-auth's own module graph, which pulls in "next/server"
// in a way that only resolves correctly inside Next.js's own bundler,
// not under a plain `node` process. Keeping this logic here (instead of
// inline in auth.ts) is what makes it directly unit-testable via
// node:test — see tests/unit/auth-callbacks.test.ts.
import bcrypt from "bcryptjs";
import { getAppPool } from "../db/appPool.ts";
import type { Role } from "../permissions/authContext.ts";

export interface AuthorizedUser {
  id: string;
  name: string;
  email: string;
  companyId: string | null;
  role: Role;
  departmentId: string | null;
}

/**
 * `credentials` is whatever the client submitted to the login request.
 * This function deliberately destructures ONLY email/password. Any
 * other field an attacker includes (company_id, role, department_id,
 * ...) is never read — there is no code path through which it could
 * reach the returned user, the JWT, or the session.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined
): Promise<AuthorizedUser | null> {
  const email = typeof credentials?.email === "string" ? credentials.email : null;
  const password = typeof credentials?.password === "string" ? credentials.password : null;
  if (!email || !password) return null;

  const pool = getAppPool();
  const client = await pool.connect();
  try {
    // SECURITY DEFINER lookup (db/migrations/0010_auth.sql) — the one
    // narrow, audited exception needed to find a user's company BEFORE
    // any RLS context can exist. See that migration's comment for why
    // this does not weaken RLS.
    const { rows } = await client.query("SELECT * FROM auth_find_user_by_email($1)", [email]);
    const user = rows[0];
    if (!user || user.status !== "active" || !user.password_hash) {
      return null;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return null;

    return {
      id: user.id,
      name: user.name,
      email,
      companyId: user.company_id,
      role: user.role,
      departmentId: user.department_id,
    };
  } finally {
    client.release();
  }
}

export interface MinimalToken extends Record<string, unknown> {
  userId?: string;
  companyId?: string | null;
  role?: Role;
  departmentId?: string | null;
}

export interface MinimalSessionUser {
  id?: string;
  companyId?: string | null;
  role?: Role;
  departmentId?: string | null;
}

/**
 * `user` is only present on the initial sign-in call, and it is
 * exactly the object authorizeCredentials() returned (DB-derived). On
 * every later call `user` is undefined and `token` (the previously
 * issued, signed JWT) is trusted as-is — this function never re-reads
 * client-supplied fields.
 */
export function applyUserToToken(token: MinimalToken, user: AuthorizedUser | null | undefined): MinimalToken {
  if (user) {
    token.userId = user.id;
    token.companyId = user.companyId;
    token.role = user.role;
    token.departmentId = user.departmentId;
  }
  return token;
}

export function applyTokenToSessionUser(sessionUser: MinimalSessionUser, token: MinimalToken): MinimalSessionUser {
  if (token.userId) sessionUser.id = token.userId;
  sessionUser.companyId = token.companyId ?? null;
  if (token.role) sessionUser.role = token.role;
  sessionUser.departmentId = token.departmentId ?? null;
  return sessionUser;
}
