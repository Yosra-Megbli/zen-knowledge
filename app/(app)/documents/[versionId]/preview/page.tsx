import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "../../../../../auth.ts";
import { getAuthContext } from "../../../../../lib/permissions/authContext.ts";
import { canAccessDocumentVisibility } from "../../../../../lib/permissions/documentVisibility.ts";
import { withAuthContext } from "../../../../../lib/db/withAuthContext.ts";
import { storageProvider } from "../../../../../lib/storage/index.ts";
import { HighlightedText } from "./HighlightedText.tsx";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon", published: "Publié", unpublished: "Dépublié",
  archived: "Archivé", deleted: "Supprimé",
  processing: "En traitement", ready: "Prêt (non publié)", failed: "Échec",
};
const VISIBILITY_LABELS: Record<string, string> = {
  company: "Entreprise", department: "Département", restricted: "Restreint",
};

interface MetaRow {
  title: string;
  description: string | null;
  visibility: string;
  document_status: string;
  document_department_id: string | null;
  review_date: string | null;
  document_created_at: string;
  company_name: string;
  department_name: string | null;
  version_number: number;
  version_status: string;
  file_type: string;
  file_key: string;
  published_at: string | null;
  archived_at: string | null;
  version_created_at: string;
  owner_email: string;
}

export default async function DocumentPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ chunk?: string; snippet?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { versionId } = await params;
  const { chunk: chunkId, snippet: snippetParam } = await searchParams;

  const row = await withAuthContext(ctx, async (client) => {
    const res = await client.query<MetaRow>(
      `SELECT
         d.title, d.description, d.visibility, d.status AS document_status,
         d.department_id AS document_department_id, d.review_date, d.created_at AS document_created_at,
         c.name AS company_name, dep.name AS department_name,
         v.version_number, v.status AS version_status, v.file_type, v.file_key,
         v.published_at, v.archived_at, v.created_at AS version_created_at,
         u.email AS owner_email
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       JOIN companies c ON c.id = d.company_id
       LEFT JOIN departments dep ON dep.id = d.department_id
       JOIN users u ON u.id = v.uploaded_by
       WHERE v.id = $1 AND v.file_key IS NOT NULL AND v.file_key != 'pending'`,
      [versionId]
    );
    return res.rows[0] ?? null;
  });

  if (!row) notFound();
  if (!canAccessDocumentVisibility(ctx, { visibility: row.visibility, departmentId: row.document_department_id })) {
    notFound();
  }

  const isDeleted = row.document_status === "deleted";

  // Best-effort chunk lookup: prefer the live chunk row (gives the
  // exact indexed text), fall back to the snippet passed by the
  // caller (citations.snippet_text survives even after the chunk row
  // itself is gone — chunk_id is ON DELETE SET NULL). Never throws —
  // a miss just means no highlight, per "fallback silencieux".
  let highlightText: string | null = snippetParam ? decodeURIComponent(snippetParam) : null;
  if (chunkId) {
    const chunkRow = await withAuthContext(ctx, async (client) => {
      const res = await client.query<{ content: string }>(
        `SELECT content FROM document_chunks WHERE id = $1 AND document_version_id = $2`,
        [chunkId, versionId]
      );
      return res.rows[0] ?? null;
    });
    if (chunkRow) highlightText = chunkRow.content;
  }

  const metaItems: { label: string; value: string }[] = [
    { label: "Société", value: row.company_name },
    { label: "Département", value: row.department_name ?? "—" },
    { label: "Version", value: `v${row.version_number}` },
    { label: "Visibilité", value: VISIBILITY_LABELS[row.visibility] ?? row.visibility },
    { label: "Statut du document", value: STATUS_LABELS[row.document_status] ?? row.document_status },
    { label: "Statut de la version", value: STATUS_LABELS[row.version_status] ?? row.version_status },
    { label: "Propriétaire", value: row.owner_email },
    { label: "Créé le", value: new Date(row.version_created_at).toLocaleDateString("fr-FR") },
    ...(row.published_at ? [{ label: "Publié le", value: new Date(row.published_at).toLocaleDateString("fr-FR") }] : []),
    ...(row.review_date ? [{ label: "Révision", value: new Date(row.review_date).toLocaleDateString("fr-FR") }] : []),
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-lime-700 transition-colors mb-6"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        Retour à la bibliothèque
      </Link>

      <div className="bg-white rounded-2xl border border-ink-100 p-6 mb-6">
        <h1 className="font-display text-2xl font-bold text-ink-950 tracking-tight mb-1">{row.title}</h1>
        {row.description && <p className="text-sm text-ink-500 mb-4">{row.description}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-4">
          {metaItems.map((m) => (
            <div key={m.label}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-300">{m.label}</p>
              <p className="text-sm text-ink-900">{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      {isDeleted ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-10 text-center">
          <p className="text-sm font-medium text-ink-500">Ce document a été supprimé.</p>
          <p className="text-xs text-ink-300 mt-1">
            Son contenu n&apos;est plus consultable, mais ses métadonnées restent visibles pour l&apos;historique.
          </p>
        </div>
      ) : row.file_type === "pdf" ? (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          <iframe
            title={row.title}
            src={`/api/documents/${versionId}/file#page=1`}
            className="w-full h-[80vh]"
          />
        </div>
      ) : (
        <TextPreview fileKey={row.file_key} highlightText={highlightText} />
      )}
    </div>
  );
}

async function TextPreview({ fileKey, highlightText }: { fileKey: string; highlightText: string | null }) {
  let text: string;
  try {
    const data = await storageProvider.read(fileKey);
    text = data.toString("utf-8");
  } catch {
    text = "Contenu indisponible.";
  }
  return <HighlightedText text={text} highlightText={highlightText} />;
}
