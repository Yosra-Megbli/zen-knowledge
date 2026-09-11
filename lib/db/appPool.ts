// No `import "server-only"` guard — see lib/embeddings/local-e5.ts for
// why: it would break direct node:test execution of this module.
import { Pool } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let pool: Pool | null = null;

export function getAppPool(): Pool {
  if (!pool) {
    // Supabase (production): DATABASE_URL points to the Transaction pooler
    // (port 6543) with app_role credentials embedded in the URL.
    // Local Docker: fall back to individual POSTGRES_* env vars.
    if (process.env.DATABASE_URL) {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
        max: 10,
      });
    } else {
      pool = new Pool({
        host: process.env.POSTGRES_HOST ?? "localhost",
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: requireEnv("POSTGRES_DB"),
        user: "app_role",
        password: requireEnv("APP_ROLE_PASSWORD"),
        max: 10,
      });
    }
  }
  return pool;
}
