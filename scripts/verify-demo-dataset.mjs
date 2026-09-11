import { getMigrationClient } from "../db/db.mjs";

async function run() {
  const client = await getMigrationClient();
  try {
    const docs = await client.query(`
      SELECT c.name AS company, d.title, d.visibility, d.status, d.department_id IS NOT NULL AS has_dept,
             d.review_date, d.deleted_at IS NOT NULL AS is_deleted,
             (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id) AS version_count,
             (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id AND v.status = 'published') AS published_version_count,
             (SELECT count(*) FROM document_chunks ch JOIN document_versions v ON v.id = ch.document_version_id WHERE v.document_id = d.id) AS chunk_count
      FROM documents d
      JOIN companies c ON c.id = d.company_id
      WHERE c.slug IN ('zen-retail-tunisia', 'zen-home-lifestyle')
      ORDER BY c.name, d.title
    `);
    console.table(docs.rows);

    const summary = await client.query(`
      SELECT c.name AS company, d.status, count(*)::int AS n
      FROM documents d JOIN companies c ON c.id = d.company_id
      WHERE c.slug IN ('zen-retail-tunisia', 'zen-home-lifestyle')
      GROUP BY c.name, d.status ORDER BY c.name, d.status
    `);
    console.table(summary.rows);

    const dims = await client.query(`
      SELECT DISTINCT vector_dims(ch.embedding) AS dims
      FROM document_chunks ch
      JOIN document_versions v ON v.id = ch.document_version_id
      JOIN documents d ON d.id = v.document_id
      JOIN companies c ON c.id = d.company_id
      WHERE c.slug IN ('zen-retail-tunisia', 'zen-home-lifestyle')
    `);
    console.log("Embedding dimensions present:", dims.rows.map((r) => r.dims));
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
