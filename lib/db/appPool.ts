// No `import "server-only"` guard — see lib/embeddings/local-e5.ts for
// why: it would break direct node:test execution of this module.
import { Pool } from "pg";

// The ONLY Postgres role ever used by application runtime code.
// NOSUPERUSER, NOBYPASSRLS (see db/migrations/0002_roles.sql) — this
// pool can never see a row RLS would otherwise hide. migration_role
// (superuser) is used exclusively by db/*.mjs scripts, never here.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let pool: Pool | null = null;

export function getAppPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: requireEnv("POSTGRES_DB"),
      user: "app_role",
      password: requireEnv("APP_ROLE_PASSWORD"),
      max: 10,
    });
  }
  return pool;
}
