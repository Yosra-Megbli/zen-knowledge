#!/usr/bin/env node
/**
 * db/supabase/export-migrations.mjs
 *
 * Génère un fichier SQL unique prêt à coller dans le SQL Editor Supabase.
 * Remplace __APP_ROLE_PASSWORD__ par la valeur de APP_ROLE_PASSWORD dans .env.local.
 *
 * Usage :
 *   node db/supabase/export-migrations.mjs
 *   → écrit db/supabase/supabase-setup.sql
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

config({ path: path.join(root, ".env.local") });

const APP_ROLE_PASSWORD = process.env.APP_ROLE_PASSWORD;
if (!APP_ROLE_PASSWORD) {
  console.error("Missing APP_ROLE_PASSWORD in .env.local");
  process.exit(1);
}

const migrationsDir = path.join(root, "db", "migrations");
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

const parts = [
  "-- ============================================================",
  "-- ZEN Knowledge — Supabase setup (generated, do not edit)",
  `-- Generated: ${new Date().toISOString()}`,
  "-- Paste this entire file into Supabase SQL Editor and run.",
  "-- ============================================================",
  "",
];

for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  parts.push(`-- ---- ${file} ----`);
  parts.push(sql.replaceAll("__APP_ROLE_PASSWORD__", APP_ROLE_PASSWORD));
  parts.push("");
}

const out = path.join(__dirname, "supabase-setup.sql");
await writeFile(out, parts.join("\n"), "utf8");
console.log(`Written: ${out}`);
console.log("Next: paste db/supabase/supabase-setup.sql into Supabase SQL Editor and run.");
console.log("");
console.log("⚠ This file contains the real APP_ROLE_PASSWORD in plain text.");
console.log("  It is gitignored (db/supabase/supabase-setup.sql) — NEVER `git add -f` it.");
