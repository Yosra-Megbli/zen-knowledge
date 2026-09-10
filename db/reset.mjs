// Drops and recreates the public schema. Cluster-level objects (roles,
// including app_role) are NOT affected — only schema-scoped objects
// (tables, including schema_migrations) are dropped. Run `npm run
// db:migrate` afterwards to rebuild from a clean database.
import { getMigrationClient, migrationConnectionConfig } from "./db.mjs";

async function run() {
  const client = await getMigrationClient();
  try {
    console.log("Dropping schema public...");
    await client.query("DROP SCHEMA public CASCADE;");
    await client.query("CREATE SCHEMA public;");
    const { user } = migrationConnectionConfig();
    await client.query(`GRANT ALL ON SCHEMA public TO ${client.escapeIdentifier(user)};`);
    await client.query("GRANT ALL ON SCHEMA public TO public;");
    console.log("Schema reset complete. Run `npm run db:migrate` next.");
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
