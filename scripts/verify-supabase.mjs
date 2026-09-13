import { config } from "dotenv";
config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function verifyAll() {
  console.log("=== RAPPORT COMPLET BASE SUPABASE PRODUCTION ===\n");

  // 1. Company and Departments
  const company = (await (await fetch(`${SUPABASE_URL}/rest/v1/companies?name=eq.ZEN%20Retail%20Tunisia&select=id,name`, { headers })).json())[0];
  const depts = await (await fetch(`${SUPABASE_URL}/rest/v1/departments?company_id=eq.${company.id}&select=id,name`, { headers })).json();
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d.name]));

  // 2. All Documents for ZEN Retail Tunisia
  const docs = await (await fetch(`${SUPABASE_URL}/rest/v1/documents?company_id=eq.${company.id}&status=neq.deleted&select=id,title,status,review_date,department_id,current_version_id,visibility&order=title.asc`, { headers })).json();

  console.log(`--- DOCUMENTS EXISTANTS (${docs.length}) ---`);
  for (const doc of docs) {
    const dName = deptMap[doc.department_id] || "—";
    const vers = await (await fetch(`${SUPABASE_URL}/rest/v1/document_versions?document_id=eq.${doc.id}&order=version_number.desc`, { headers })).json();
    const latestVer = vers[0];
    const latestStatus = latestVer?.status || doc.status;

    let extra = "";
    if (latestStatus === "failed") {
      const jobs = await (await fetch(`${SUPABASE_URL}/rest/v1/ingestion_jobs?document_version_id=eq.${latestVer.id}&select=error_message`, { headers })).json();
      extra = ` [ÉCHEC: "${jobs[0]?.error_message || ""}"]`;
    }

    const chunks = await (await fetch(`${SUPABASE_URL}/rest/v1/document_chunks?document_id=eq.${doc.id}&select=id`, { headers })).json();

    console.log(`• "${doc.title}"`);
    console.log(`   Service: ${dName} | Statut doc: ${doc.status} | Statut version: ${latestStatus} | Révision: ${doc.review_date || "—"} | Chunks: ${chunks.length}${extra}`);
  }

  // 3. Obsolete / Approaching check (today + 30 days)
  console.log("\n--- SIMULATION REQUÊTE /admin/obsolete ---");
  const today = "2026-09-13";
  const approachingLimit = "2026-10-13";

  const overdueDocs = docs.filter((d) => d.status === "published" && d.review_date && d.review_date < today);
  const approachingDocs = docs.filter((d) => d.status === "published" && d.review_date && d.review_date >= today && d.review_date <= approachingLimit);

  console.log(`✓ Retard (overdue) count: ${overdueDocs.length}`);
  overdueDocs.forEach((d) => console.log(`   * ${d.title} (révision: ${d.review_date})`));

  console.log(`✓ À venir (30j) count: ${approachingDocs.length} ${approachingDocs.length >= 1 ? "(≥ 1 VALIDÉ ✓)" : "(ERREUR)"}`);
  approachingDocs.forEach((d) => console.log(`   * ${d.title} (révision: ${d.review_date})`));

  // 4. Chip counts
  console.log("\n--- SIMULATION CHIPS /documents ---");
  let publishedCount = 0;
  let archivedCount = 0;
  let failedCount = 0;

  for (const doc of docs) {
    const vers = await (await fetch(`${SUPABASE_URL}/rest/v1/document_versions?document_id=eq.${doc.id}&order=version_number.desc&limit=1`, { headers })).json();
    const st = vers[0]?.status || doc.status;
    if (st === "published") publishedCount++;
    if (st === "archived") archivedCount++;
    if (st === "failed") failedCount++;
  }

  console.log(`✓ Tous: ${docs.length} | Publiés: ${publishedCount} | Archivés: ${archivedCount} | Échec: ${failedCount}`);
  console.log(`✓ Chip Échec = ${failedCount} ${failedCount === 1 ? "(EXACTEMENT 1 VALIDÉ ✓)" : "(ERREUR)"}`);
}

verifyAll().catch(console.error);
