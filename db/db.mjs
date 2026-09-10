import { Client } from "pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (check .env.local)`);
  }
  return value;
}

function baseConfig() {
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: requireEnv("POSTGRES_DB"),
  };
}

// migration_role: the Postgres superuser bootstrapped by docker-compose
// (POSTGRES_USER). Used ONLY by db/migrate.mjs, db/reset.mjs, db/seed.mjs
// and the "bypass proof" test — never by application runtime code.
export function migrationConnectionConfig() {
  return {
    ...baseConfig(),
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
  };
}

// app_role: the RLS-enforced role every other query must use.
export function appConnectionConfig() {
  return {
    ...baseConfig(),
    user: "app_role",
    password: requireEnv("APP_ROLE_PASSWORD"),
  };
}

export async function getMigrationClient() {
  const client = new Client(migrationConnectionConfig());
  await client.connect();
  return client;
}

export async function getAppClient() {
  const client = new Client(appConnectionConfig());
  await client.connect();
  return client;
}

/**
 * Runs fn(client) inside BEGIN/COMMIT, having first set the
 * authorization context as transaction-local settings (SET LOCAL via
 * set_config(..., true)). Only keys that are actually provided are set;
 * an omitted key stays unset (current_setting returns NULL for it),
 * which every RLS policy treats as "deny".
 */
export async function withAuthContext(client, ctx, fn) {
  await client.query("BEGIN");
  try {
    if (ctx.companyId) {
      await client.query("SELECT set_config('app.company_id', $1, true)", [ctx.companyId]);
    }
    if (ctx.role) {
      await client.query("SELECT set_config('app.role', $1, true)", [ctx.role]);
    }
    if (ctx.departmentId) {
      await client.query("SELECT set_config('app.department_id', $1, true)", [ctx.departmentId]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
