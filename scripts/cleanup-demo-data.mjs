// One-off: apply the LOT 1 fixes directly to the PRODUCTION database,
// without re-running the full seed (which refuses to run twice — see
// seed-production-dataset.mjs). Scoped strictly to the exact rows
// below by id; touches nothing else.
//
// 1. Deletes the "y" document — a leftover test artifact from an
//    earlier debugging session, never part of the real demo dataset.
// 2. Rewrites 6 document descriptions that leaked developer/meta
//    commentary ("volontairement", "pour tester W3", "test
//    d'injection de prompt") into user-facing text — the underlying
//    test scenarios (contradiction, obsolescence, injection, deleted
//    doc) stay exactly as-is in the actual file content; only the
//    description field changes to what a real company would write.
// 3. Conversation cleanup (see cleanupConversations() below) — safe
//    by default (dry-run), only deletes with --apply, never run
//    automatically as part of the document fixes above.
//
// Requires SUPABASE_DIRECT_URL in .env.local.
// Run with: node --env-file-if-exists=.env.local scripts/cleanup-demo-data.mjs
//       or: node --env-file-if-exists=.env.local scripts/cleanup-demo-data.mjs --apply
import { Client } from "pg";

const POLLUTION_DOC_ID = "f37791c2-2967-4e78-a7ef-72730a60ec3f"; // title "y"

const DESCRIPTION_FIXES = [
  {
    id: "7bf5110c-c2a0-4f28-af18-ce4d2d073908", // A6 — sécurité incendie
    description: "Consignes de sécurité incendie applicables à l'entrepôt central.",
  },
  {
    id: "69486f8b-7c44-40ac-8a3a-263d84a133da", // A7 — guide assistant
    description: "Guide pratique pour utiliser l'assistant documentaire interne.",
  },
  {
    id: "7a5f2f23-9615-4e85-99c9-af894edfe713", // B4 — politique livraison
    description: "Politique officielle du service Logistique concernant les délais de livraison.",
  },
  {
    id: "bbb133df-4b88-456e-93bb-22ff0090f90c", // B5 — FAQ livraison
    description: "Questions fréquentes du service client au sujet des livraisons.",
  },
  {
    id: "f07d19e6-b9a1-4938-b06d-4b4bf7c2b9b0", // B6 — brouillon
    description: "Version de travail en cours de relecture, non finalisée.",
  },
  {
    id: "f241be68-9b55-4bbb-8120-d2ebe3777165", // B7 — règlement intérieur (deleted)
    description: "Ancien règlement intérieur, remplacé par la version en vigueur.",
  },
];

// ── Conversation cleanup ────────────────────────────────────────────
//
// Targets ONLY two explicit, low-risk patterns — no broad heuristic
// (e.g. "title shorter than 8 characters") is applied, because that
// was never verified against real production data (a direct-connection
// inspection attempt failed from this environment — see the git log
// for this file). Skipping an unverified broad rule is the documented
// fallback, not a shortcut.
//
// Pattern A — the conversation's FIRST user message is an exact match
// (trimmed, case-sensitive) for one of a short list of unmistakable
// test inputs. Exact match only: no substring/fuzzy matching, so a
// real question can never be caught by accident.
const TEST_FIRST_MESSAGES = ["kkk", "comment allez vous", "test"];

// Pattern B — two or more conversations share the exact same
// non-null title; every row except the most recently created one in
// each group is a target (duplicates come from re-running the same
// demo question, not from genuine distinct conversations).
//
// conversations/conversation_messages/citations/feedback have no
// ON DELETE CASCADE (db/migrations/0006) — children must be deleted
// before parents, in this order: feedback -> citations ->
// conversation_messages -> conversations. Every DELETE below is
// scoped to message_id/conversation_id IN (the exact target set),
// so nothing outside the targeted conversations is ever touched —
// no document, chunk, user, or company row is read or written here.
async function findCleanupTargets(client) {
  const patternA = await client.query(
    `SELECT c.id, c.title, c.created_at
     FROM conversations c
     JOIN conversation_messages m ON m.conversation_id = c.id
     WHERE m.role = 'user'
       AND m.id = (
         SELECT m2.id FROM conversation_messages m2
         WHERE m2.conversation_id = c.id AND m2.role = 'user'
         ORDER BY m2.created_at ASC LIMIT 1
       )
       AND TRIM(m.content) = ANY($1::text[])`,
    [TEST_FIRST_MESSAGES]
  );

  const patternB = await client.query(
    `SELECT id, title, created_at FROM (
       SELECT id, title, created_at,
         ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC) AS rn
       FROM conversations
       WHERE title IS NOT NULL
     ) ranked
     WHERE rn > 1`
  );

  const byId = new Map();
  for (const row of [...patternA.rows, ...patternB.rows]) byId.set(row.id, row);
  return [...byId.values()];
}

async function reportCounts(client, targetIds, label) {
  if (targetIds.length === 0) {
    console.log(`  (${label}: 0 conversations)`);
    return;
  }
  const msgCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM conversation_messages WHERE conversation_id = ANY($1::uuid[])`,
    [targetIds]
  );
  const citCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM citations WHERE message_id IN
       (SELECT id FROM conversation_messages WHERE conversation_id = ANY($1::uuid[]))`,
    [targetIds]
  );
  const fbCount = await client.query(
    `SELECT COUNT(*)::int AS n FROM feedback WHERE message_id IN
       (SELECT id FROM conversation_messages WHERE conversation_id = ANY($1::uuid[]))`,
    [targetIds]
  );
  console.log(
    `  (${label}: ${targetIds.length} conversations, ${msgCount.rows[0].n} messages, ` +
      `${citCount.rows[0].n} citations, ${fbCount.rows[0].n} feedback rows)`
  );
}

async function cleanupConversations(client, apply) {
  console.log(`\nConversation cleanup (${apply ? "APPLY" : "DRY-RUN"})...`);

  const targets = await findCleanupTargets(client);
  if (targets.length === 0) {
    console.log("  No matching conversations found. Nothing to do.");
    return;
  }

  console.log(`\n  ${targets.length} conversation(s) match a cleanup pattern:`);
  for (const t of targets) {
    console.log(`    - ${t.id}  "${t.title}"  (${t.created_at.toISOString()})`);
  }

  const targetIds = targets.map((t) => t.id);
  await reportCounts(client, targetIds, "would be deleted");

  if (!apply) {
    console.log("\n  Dry-run only — nothing was deleted. Re-run with --apply to delete.");
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM feedback WHERE message_id IN
         (SELECT id FROM conversation_messages WHERE conversation_id = ANY($1::uuid[]))`,
      [targetIds]
    );
    await client.query(
      `DELETE FROM citations WHERE message_id IN
         (SELECT id FROM conversation_messages WHERE conversation_id = ANY($1::uuid[]))`,
      [targetIds]
    );
    await client.query(
      `DELETE FROM conversation_messages WHERE conversation_id = ANY($1::uuid[])`,
      [targetIds]
    );
    const del = await client.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [targetIds]);
    await client.query("COMMIT");
    console.log(`\n  Deleted ${del.rowCount} conversations.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  const remaining = await findCleanupTargets(client);
  console.log(`\n  After cleanup: ${remaining.length} matching conversation(s) remain.`);
}

async function run() {
  if (!process.env.SUPABASE_DIRECT_URL) {
    console.error("SUPABASE_DIRECT_URL is not set — required. Check .env.local.");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");

  const client = new Client({ connectionString: process.env.SUPABASE_DIRECT_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // These two document fixes were already applied to production in
    // an earlier session (both are naturally idempotent — deleting an
    // already-gone row / rewriting an already-correct description are
    // no-ops) but are now gated behind --apply too, so the script's
    // default invocation is a genuine no-mutation dry-run end to end,
    // not just for the conversation section below.
    console.log(apply ? `Deleting pollution document ${POLLUTION_DOC_ID} ("y")...` : `[dry-run] would delete pollution document ${POLLUTION_DOC_ID} ("y") if still present`);
    if (apply) {
    await client.query(
      `DELETE FROM document_chunks WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(
      `DELETE FROM ingestion_jobs WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(
      `DELETE FROM citations WHERE document_version_id IN
         (SELECT id FROM document_versions WHERE document_id = $1)`,
      [POLLUTION_DOC_ID]
    );
    await client.query(`UPDATE documents SET current_version_id = NULL WHERE id = $1`, [POLLUTION_DOC_ID]);
    await client.query(`DELETE FROM document_versions WHERE document_id = $1`, [POLLUTION_DOC_ID]);
    const del = await client.query(`DELETE FROM documents WHERE id = $1`, [POLLUTION_DOC_ID]);
    console.log(`  ✓ deleted (${del.rowCount} document row)`);
    }

    console.log(apply ? "\nRewriting meta descriptions to in-world text..." : "\n[dry-run] would rewrite 6 meta descriptions to in-world text");
    if (apply) {
    for (const fix of DESCRIPTION_FIXES) {
      const res = await client.query(
        `UPDATE documents SET description = $1 WHERE id = $2 RETURNING title`,
        [fix.description, fix.id]
      );
      if (res.rowCount === 0) {
        console.warn(`  ! no document found for id ${fix.id} — skipped`);
      } else {
        console.log(`  ✓ ${res.rows[0].title}`);
      }
    }
    }

    await cleanupConversations(client, apply);

    console.log("\nDone.");
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
