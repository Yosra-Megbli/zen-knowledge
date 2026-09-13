import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "nb";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function api(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${options.method || "GET"} ${path} failed (${res.status}): ${txt}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Minimal valid PDF without extractable text (blank page)
const BLANK_PDF = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
  "xref\n" +
  "0 4\n" +
  "0000000000 65535 f\n" +
  "0000000009 00000 n\n" +
  "0000000052 00000 n\n" +
  "0000000108 00000 n\n" +
  "trailer<</Size 4/Root 1 0 R>>\n" +
  "startxref\n" +
  "180\n" +
  "%%EOF\n"
);

async function main() {
  console.log("=== PATCH DEMO DATA EN PROD (SUPABASE) ===");

  // 1. Get ZEN Retail Tunisia company
  const companies = await api("/companies?name=eq.ZEN%20Retail%20Tunisia&select=id,name");
  if (!companies.length) {
    throw new Error("Company 'ZEN Retail Tunisia' not found");
  }
  const company = companies[0];
  console.log(`✓ Société : ${company.name} (${company.id})`);

  // 2. Get admin user
  const admins = await api(`/users?company_id=eq.${company.id}&role=eq.admin&select=id,email`);
  if (!admins.length) {
    throw new Error("Admin user not found for ZEN Retail Tunisia");
  }
  const admin = admins[0];
  console.log(`✓ Admin : ${admin.email} (${admin.id})`);

  // 3. Ensure 'Service Client' department exists for ZEN Retail Tunisia
  let serviceClientDept = (await api(`/departments?company_id=eq.${company.id}&name=eq.Service%20Client&select=id,name`))[0];
  if (!serviceClientDept) {
    const inserted = await api("/departments", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        name: "Service Client",
      }),
    });
    serviceClientDept = inserted[0];
    console.log(`✓ Créé département 'Service Client' (${serviceClientDept.id})`);
  } else {
    console.log(`✓ Département 'Service Client' existant (${serviceClientDept.id})`);
  }

  // 4. Ensure 'Comptabilité' department exists for ZEN Retail Tunisia
  let comptaDept = (await api(`/departments?company_id=eq.${company.id}&name=eq.Comptabilit%C3%A9&select=id,name`))[0];
  if (!comptaDept) {
    const inserted = await api("/departments", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        name: "Comptabilité",
      }),
    });
    comptaDept = inserted[0];
    console.log(`✓ Créé département 'Comptabilité' (${comptaDept.id})`);
  } else {
    console.log(`✓ Département 'Comptabilité' existant (${comptaDept.id})`);
  }

  // 5. Update "Gestion des incidents clients — Service Client" -> department_id = Service Client
  const incidentDoc = (await api(`/documents?company_id=eq.${company.id}&title=ilike.*incidents%20clients%20%E2%80%94%20Service%20Client*&select=id,title,department_id`))[0];
  if (incidentDoc) {
    await api(`/documents?id=eq.${incidentDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        department_id: serviceClientDept.id,
        updated_at: new Date().toISOString(),
      }),
    });
    console.log(`✓ Document "${incidentDoc.title}" assigné au service 'Service Client' (${serviceClientDept.id})`);
  } else {
    console.warn("⚠ Document 'Gestion des incidents clients — Service Client' introuvable");
  }

  // 6. Check / create demo failed document: "Note de frais scannée — Comptabilité"
  const failedDocTitle = "Note de frais scannée — Comptabilité";
  let failedDoc = (await api(`/documents?company_id=eq.${company.id}&title=eq.${encodeURIComponent(failedDocTitle)}&select=id,title,status,current_version_id`))[0];

  if (!failedDoc) {
    console.log(`Création du document en échec : "${failedDocTitle}"...`);
    const docInserted = await api("/documents", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        department_id: comptaDept.id,
        owner_id: admin.id,
        title: failedDocTitle,
        description: "Note de frais numérisée sans couche texte exploitable (échec OCR/extraction).",
        visibility: "department",
        status: "draft",
      }),
    });
    failedDoc = docInserted[0];
    console.log(`✓ Document créé : id ${failedDoc.id}`);

    // Create version row first to obtain versionId
    const verInserted = await api("/document_versions", {
      method: "POST",
      body: JSON.stringify({
        document_id: failedDoc.id,
        company_id: company.id,
        version_number: 1,
        status: "failed",
        file_key: "pending",
        file_type: "application/pdf",
        uploaded_by: admin.id,
      }),
    });
    const versionId = verInserted[0].id;
    console.log(`✓ Version créée : id ${versionId}`);

    // Upload blank PDF to Supabase Storage
    const storageKey = `${company.id}/${failedDoc.id}/${versionId}/note_de_frais_scannee.pdf`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storageKey}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: BLANK_PDF,
    });
    if (!uploadRes.ok) {
      console.warn(`Upload storage warning: ${uploadRes.status} ${await uploadRes.text()}`);
    } else {
      console.log(`✓ PDF scanné vierge téléversé dans Supabase Storage : ${storageKey}`);
    }

    // Also write locally to disk in storage directory for local dev server
    try {
      const localDir = path.join(__dirname, "..", "storage", company.id, failedDoc.id, versionId);
      mkdirSync(localDir, { recursive: true });
      writeFileSync(path.join(localDir, "note_de_frais_scannee.pdf"), BLANK_PDF);
      console.log(`✓ Fichier miroir local écrit dans storage/${storageKey}`);
    } catch (e) {
      console.warn("Local storage write warning:", e.message);
    }

    // Update version with real file_key
    await api(`/document_versions?id=eq.${versionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        file_key: storageKey,
      }),
    });

    // Update document with current_version_id
    await api(`/documents?id=eq.${failedDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        current_version_id: versionId,
        updated_at: new Date().toISOString(),
      }),
    });

    // Insert failed ingestion_job
    await api("/ingestion_jobs", {
      method: "POST",
      body: JSON.stringify({
        document_version_id: versionId,
        company_id: company.id,
        status: "failed",
        error_code: "NO_EXTRACTABLE_TEXT",
        error_message: "Document scanné vide — aucun texte extractible",
        triggered_by: "demo-fixture",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      }),
    });
    console.log(`✓ Ingestion job failed enregistré avec message : "Document scanné vide — aucun texte extractible"`);
  } else {
    console.log(`✓ Document en échec "${failedDocTitle}" existe déjà.`);
  }

  // 7. Check / create dedicated published document with review_date = CURRENT_DATE + 15 days:
  // "Procédure de traitement des réclamations VIP — Service Client"
  const now = new Date();
  const j15Date = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Date J+15 cible : ${j15Date}`);

  const vipDocTitle = "Procédure de traitement des réclamations VIP — Service Client";
  let vipDoc = (await api(`/documents?company_id=eq.${company.id}&title=eq.${encodeURIComponent(vipDocTitle)}&select=id,title,status,current_version_id,review_date`))[0];

  const VIP_CONTENT = `# Procédure de traitement des réclamations VIP — Service Client
Date d'effet : 2026-03-01
Dernière révision : 2026-09-13
Service responsable : Service Client

## 1. Périmètre et éligibilité
Cette procédure encadre le traitement prioritaire des réclamations émanant de clients titulaires d'une carte Fidélité VIP Platine, Grands Comptes institutionnels ou de litiges signalés en boutique d'un montant supérieur à 500 TND.

## 2. Délais de réponse et SLA
- Prise en charge initiale : sous 2 heures ouvrées après réception de la notification.
- Proposition de résolution définitive : sous 24 heures ouvrées.
- Attribution d'un interlocuteur dédié du Service Client dès l'ouverture du dossier.

## 3. Modalités d'indemnisation et gestes commerciaux
- Avoir immédiat en boutique ou remboursement sur carte bancaire jusqu'à 300 TND avec accord du superviseur Service Client.
- Au-delà de 300 TND : validation conjointe requise avec la Direction Administrative et Financière.
- Bon de fidélité ou cadeau de courtoisie systématique en cas de retard de livraison avéré supérieur à 72 heures.

## 4. Escalade hiérarchique
En l'absence de résolution sous 48 heures, le dossier est automatiquement transféré au Responsable de la Relation Client avec copie au Directeur des Opérations Réseau.`;

  if (!vipDoc) {
    console.log(`Création du document publié J+15 : "${vipDocTitle}"...`);
    const docInserted = await api("/documents", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        department_id: serviceClientDept.id,
        owner_id: admin.id,
        title: vipDocTitle,
        description: "Processus accéléré de médiation, dédommagement et fidélisation pour les clients VIP et réclamations critiques.",
        visibility: "company",
        status: "published",
        review_date: j15Date,
      }),
    });
    vipDoc = docInserted[0];
    console.log(`✓ Document créé : id ${vipDoc.id}`);

    // Create version v1 published
    const verInserted = await api("/document_versions", {
      method: "POST",
      body: JSON.stringify({
        document_id: vipDoc.id,
        company_id: company.id,
        version_number: 1,
        status: "published",
        file_key: "pending",
        file_type: "text/plain",
        uploaded_by: admin.id,
        published_at: new Date().toISOString(),
      }),
    });
    const vipVersionId = verInserted[0].id;
    console.log(`✓ Version créée : id ${vipVersionId}`);

    // Upload content to Storage
    const storageKey = `${company.id}/${vipDoc.id}/${vipVersionId}/reclamations_vip_service_client.txt`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storageKey}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "text/plain; charset=utf-8",
        "x-upsert": "true",
      },
      body: Buffer.from(VIP_CONTENT, "utf-8"),
    });
    if (!uploadRes.ok) {
      console.warn(`Upload storage warning: ${uploadRes.status} ${await uploadRes.text()}`);
    } else {
      console.log(`✓ Fichier texte téléversé dans Supabase Storage : ${storageKey}`);
    }

    // Local mirror
    try {
      const localDir = path.join(__dirname, "..", "storage", company.id, vipDoc.id, vipVersionId);
      mkdirSync(localDir, { recursive: true });
      writeFileSync(path.join(localDir, "reclamations_vip_service_client.txt"), Buffer.from(VIP_CONTENT, "utf-8"));
    } catch (e) {
      console.warn("Local storage write warning:", e.message);
    }

    // Update version file_key
    await api(`/document_versions?id=eq.${vipVersionId}`, {
      method: "PATCH",
      body: JSON.stringify({ file_key: storageKey }),
    });

    // Update document current_version_id
    await api(`/documents?id=eq.${vipDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        current_version_id: vipVersionId,
        review_date: j15Date,
        updated_at: new Date().toISOString(),
      }),
    });

    // Insert successful ingestion job
    await api("/ingestion_jobs", {
      method: "POST",
      body: JSON.stringify({
        document_version_id: vipVersionId,
        company_id: company.id,
        status: "completed",
        chunk_count: 2,
        triggered_by: "demo-fixture",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      }),
    });

    // Insert chunks with 1536-dim zero embeddings
    const zeroVector = `[${new Array(384).fill(0).join(",")}]`;
    const chunksData = [
      {
        document_version_id: vipVersionId,
        document_id: vipDoc.id,
        company_id: company.id,
        department_id: serviceClientDept.id,
        visibility: "company",
        document_status: "published",
        version_status: "published",
        chunk_index: 0,
        content: "Procédure de traitement des réclamations VIP — Service Client. Périmètre : cartes VIP Platine, Grands Comptes, litiges > 500 TND. Prise en charge initiale sous 2 heures ouvrées, proposition de résolution sous 24 heures.",
        page_number: 1,
        embedding: zeroVector,
      },
      {
        document_version_id: vipVersionId,
        document_id: vipDoc.id,
        company_id: company.id,
        department_id: serviceClientDept.id,
        visibility: "company",
        document_status: "published",
        version_status: "published",
        chunk_index: 1,
        content: "Modalités d'indemnisation réclamations VIP : avoir immédiat ou remboursement carte bancaire jusqu'à 300 TND avec accord superviseur. Au-delà : accord DAF requis. Escalade hiérarchique sous 48h.",
        page_number: 1,
        embedding: zeroVector,
      },
    ];

    for (const chunk of chunksData) {
      await api("/document_chunks", {
        method: "POST",
        body: JSON.stringify(chunk),
      });
    }
    console.log(`✓ 2 chunks indexés créés pour "${vipDocTitle}"`);
  } else {
    // Ensure review_date is set to J+15
    await api(`/documents?id=eq.${vipDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        review_date: j15Date,
        status: "published",
        department_id: serviceClientDept.id,
        updated_at: new Date().toISOString(),
      }),
    });
    console.log(`✓ Document existant "${vipDocTitle}" vérifié (review_date = ${j15Date})`);

    // Ensure chunks exist
    const existingChunks = await api(`/document_chunks?document_id=eq.${vipDoc.id}&select=id`);
    if (!existingChunks.length && vipDoc.current_version_id) {
      console.log(`Création des chunks manquants pour "${vipDocTitle}"...`);
      const zeroVector = `[${new Array(384).fill(0).join(",")}]`;
      const chunksData = [
        {
          document_version_id: vipDoc.current_version_id,
          document_id: vipDoc.id,
          company_id: company.id,
          department_id: serviceClientDept.id,
          visibility: "company",
          document_status: "published",
          version_status: "published",
          chunk_index: 0,
          content: "Procédure de traitement des réclamations VIP — Service Client. Périmètre : cartes VIP Platine, Grands Comptes, litiges > 500 TND. Prise en charge initiale sous 2 heures ouvrées, proposition de résolution sous 24 heures.",
          page_number: 1,
          embedding: zeroVector,
        },
        {
          document_version_id: vipDoc.current_version_id,
          document_id: vipDoc.id,
          company_id: company.id,
          department_id: serviceClientDept.id,
          visibility: "company",
          document_status: "published",
          version_status: "published",
          chunk_index: 1,
          content: "Modalités d'indemnisation réclamations VIP : avoir immédiat ou remboursement carte bancaire jusqu'à 300 TND avec accord superviseur. Au-delà : accord DAF requis. Escalade hiérarchique sous 48h.",
          page_number: 1,
          embedding: zeroVector,
        },
      ];

      for (const chunk of chunksData) {
        await api("/document_chunks", {
          method: "POST",
          body: JSON.stringify(chunk),
        });
      }
      console.log(`✓ 2 chunks indexés créés pour "${vipDocTitle}"`);
    }

    // Ensure ingestion job exists
    const existingJobs = await api(`/ingestion_jobs?document_version_id=eq.${vipDoc.current_version_id}&select=id`);
    if (!existingJobs.length && vipDoc.current_version_id) {
      await api("/ingestion_jobs", {
        method: "POST",
        body: JSON.stringify({
          document_version_id: vipDoc.current_version_id,
          company_id: company.id,
          status: "completed",
          chunk_count: 2,
          triggered_by: "demo-fixture",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        }),
      });
      console.log(`✓ Ingestion job completed créé pour "${vipDocTitle}"`);
    }
  }

  // 8. Update 2-3 missing review dates with 2026-2027 dates
  const retourDoc = (await api(`/documents?company_id=eq.${company.id}&title=ilike.*retour%20et%20remboursement*&select=id,title`))[0];
  if (retourDoc) {
    await api(`/documents?id=eq.${retourDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ review_date: "2027-03-15", updated_at: new Date().toISOString() }),
    });
    console.log(`✓ "${retourDoc.title}" -> review_date = 2027-03-15`);
  }

  const intDoc = (await api(`/documents?company_id=eq.${company.id}&title=ilike.*int%C3%A9gration%20des%20nouveaux%20employ%C3%A9s*&select=id,title`))[0];
  if (intDoc) {
    await api(`/documents?id=eq.${intDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ review_date: "2027-01-20", updated_at: new Date().toISOString() }),
    });
    console.log(`✓ "${intDoc.title}" -> review_date = 2027-01-20`);
  }

  const stockDoc = (await api(`/documents?company_id=eq.${company.id}&title=ilike.*gestion%20des%20stocks*&select=id,title`))[0];
  if (stockDoc) {
    await api(`/documents?id=eq.${stockDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ review_date: "2027-04-15", updated_at: new Date().toISOString() }),
    });
    console.log(`✓ "${stockDoc.title}" -> review_date = 2027-04-15`);
  }

  const guideDoc = (await api(`/documents?company_id=eq.${company.id}&title=ilike.*assistant%20ZEN%20Knowledge*&select=id,title`))[0];
  if (guideDoc) {
    await api(`/documents?id=eq.${guideDoc.id}`, {
      method: "PATCH",
      body: JSON.stringify({ review_date: "2027-06-30", updated_at: new Date().toISOString() }),
    });
    console.log(`✓ "${guideDoc.title}" -> review_date = 2027-06-30`);
  }

  console.log("\n=== VÉRIFICATION FINALE DES DOCUMENTS DE ZEN RETAIL TUNISIA ===");
  const finalDocs = await api(`/documents?company_id=eq.${company.id}&status=neq.deleted&select=id,title,status,review_date,departments(name),current_version_id&order=title.asc`);
  finalDocs.forEach((d) => {
    console.log(`- "${d.title}" | Dept: ${d.departments?.name ?? '—'} | Statut: ${d.status} | Révision: ${d.review_date ?? '—'}`);
  });

  console.log("\n🎉 TOUTES LES MODIFICATIONS ONT ÉTÉ APPLIQUÉES AVEC SUCCÈS SUR SUPABASE PROD !");
}

main().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
