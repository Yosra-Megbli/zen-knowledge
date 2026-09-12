"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ExternalLink, Trash2 } from "lucide-react";

interface Document {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  status: string;
  owner_email: string;
  department_name: string | null;
  version_count: number;
  latest_version: number | null;
  latest_version_id: string | null;
  latest_status: string | null;
  latest_error_message: string | null;
  review_date: string | null;
  created_at: string;
}

const VISIBILITY_LABELS: Record<string, string> = {
  company: "Entreprise",
  department: "Département",
  restricted: "Restreint",
};

// "restricted" gets a visually distinct (amber) badge so
// confidentiality is legible at a glance in the table, not just
// identical styling to the other two (non-sensitive) visibilities.
const VISIBILITY_COLORS: Record<string, string> = {
  restricted: "bg-amber-50 text-amber-700 border border-amber-200",
};

const STATUS_COLORS: Record<string, string> = {
  published: "bg-green-100 text-green-700",
  draft: "bg-yellow-100 text-yellow-700",
  archived: "bg-ink-100 text-ink-500",
  pending_review: "bg-blue-100 text-blue-700",
  // Ingestion succeeded (extraction/chunking/embeddings done) but the
  // document has NOT been published yet — awaiting explicit review.
  // Upload never auto-publishes; see handlePublish below.
  ready: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ versionId: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "company" as "company" | "department" | "restricted",
    departmentId: "",
    reviewDate: "",
    file: null as File | null,
  });

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/documents/list");
    if (res.ok) setDocs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern (no data-fetching library in this
    // stack); the effect itself sets no state directly, it only invokes
    // fetchDocs(), whose own setState calls happen after the async fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDocs();

    fetch("/api/departments")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => setDepartments([]));
  }, [fetchDocs]);

  // Client-side only — /api/documents/list already scopes results to
  // the caller's company/permissions via RLS; this just narrows what's
  // already been authorized to fetch, never a second access check.
  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((doc) => {
      if (q && !doc.title.toLowerCase().includes(q) && !(doc.description ?? "").toLowerCase().includes(q)) {
        return false;
      }
      const status = doc.latest_status ?? doc.status;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (visibilityFilter !== "all" && doc.visibility !== visibilityFilter) return false;
      return true;
    });
  }, [docs, search, statusFilter, visibilityFilter]);

  const statusOptions = useMemo(
    () => Array.from(new Set(docs.map((d) => d.latest_status ?? d.status))).sort(),
    [docs]
  );

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!form.file || !form.title.trim()) return;

    if (form.visibility === "department" && !form.departmentId) {
      setError("Veuillez sélectionner un département pour la visibilité départementale.");
      return;
    }

    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", form.file);
    fd.append("title", form.title.trim());
    if (form.description.trim()) fd.append("description", form.description.trim());
    fd.append("visibility", form.visibility);
    if (form.visibility === "department" && form.departmentId) {
      fd.append("departmentId", form.departmentId);
    }
    if (form.reviewDate) {
      fd.append("reviewDate", form.reviewDate);
    }

    const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (!res.ok) {
      const errCode = (data.errorCode ?? data.code) as string | undefined;
      const errMsg = (data.errorMessage ?? data.error) as string | undefined;
      if (errCode === "NO_EXTRACTABLE_TEXT" || errMsg?.includes("scanned/image-only")) {
        setError(
          "Ce PDF ne contient pas de couche texte exploitable. Il s'agit probablement d'un document scanné. Les PDF scannés nécessitent actuellement une étape OCR qui n'est pas disponible dans cette version."
        );
      } else {
        setError(errMsg || "Erreur lors de l'upload.");
      }
    } else {
      // Deliberately NOT auto-published here: upload only runs
      // extraction/chunking/embeddings (status becomes "ready" on
      // success). Publication is a separate, explicit action — see
      // handlePublish — so a reviewer always sees new content before
      // it becomes visible to chat/retrieval.
      setShowModal(false);
      setForm({ title: "", description: "", visibility: "company", departmentId: "", reviewDate: "", file: null });
      fetchDocs();
    }
    setUploading(false);
  }

  async function handlePublish(versionId: string) {
    setPublishingId(versionId);
    setError(null);
    const res = await fetch(`/api/documents/${versionId}/publish`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      setError(data.error ?? "Erreur lors de la publication.");
    } else {
      fetchDocs();
    }
    setPublishingId(null);
  }

  async function handleRetry(versionId: string) {
    setRetryingId(versionId);
    setError(null);
    const res = await fetch(`/api/documents/${versionId}/retry`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      setError(data.error ?? "Erreur lors de la réindexation.");
    }
    fetchDocs();
    setRetryingId(null);
  }

  async function handleDelete(versionId: string, title: string) {
    setConfirmDelete({ versionId, title });
  }

  async function confirmAndDelete() {
    if (!confirmDelete) return;
    const { versionId } = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(versionId);
    setError(null);
    const res = await fetch(`/api/documents/${versionId}/delete`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      setError(data.error ?? "Erreur lors de la suppression.");
    }
    fetchDocs();
    setDeletingId(null);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-950 tracking-tight">Bibliothèque de documents</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-ink-950 hover:bg-ink-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nouveau document
        </button>
      </div>

      {!loading && docs.length > 0 && (
        <div className="flex flex-col gap-2 mb-4">
          {/* Search — full width on mobile */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un document…"
            className="w-full border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
          />
          {/* Filters row + counter */}
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
            >
              <option value="all">Tous les statuts</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={visibilityFilter}
              onChange={(e) => setVisibilityFilter(e.target.value)}
              className="flex-1 border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
            >
              <option value="all">Toutes visibilités</option>
              {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="text-xs text-ink-300 whitespace-nowrap shrink-0">
              {filteredDocs.length} doc{filteredDocs.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-ink-300 py-20">Chargement…</div>
      ) : docs.length === 0 ? (
        <div className="text-center text-ink-300 py-20">Aucun document disponible.</div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center text-ink-300 py-20">Aucun document ne correspond à ces critères.</div>
      ) : (
        <>
          {/* ── Mobile cards (< md) ──────────────────────────────────────── */}
          <div className="md:hidden flex flex-col gap-3">
            {filteredDocs.map((doc) => {
              const status = doc.latest_status ?? doc.status;
              const isOverdue =
                doc.status === "published" &&
                doc.review_date != null &&
                new Date(doc.review_date) < new Date();
              return (
                <div key={doc.id} className="bg-white rounded-2xl border border-ink-100 p-4">
                  {/* Title + badges row */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-950 truncate">{doc.title}</p>
                      {doc.description && (
                        <p className="text-xs text-ink-300 truncate mt-0.5">{doc.description}</p>
                      )}
                      {doc.latest_status === "failed" && doc.latest_error_message && (
                        <p className="text-xs text-red-500 truncate mt-0.5" title={doc.latest_error_message}>
                          {doc.latest_error_message}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-ink-100 text-ink-500"}`}>
                        {status}
                      </span>
                      {VISIBILITY_COLORS[doc.visibility] ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VISIBILITY_COLORS[doc.visibility]}`}>
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">{VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}</span>
                      )}
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400 mb-3">
                    <span>{doc.owner_email}</span>
                    {doc.latest_version && (
                      <span>
                        v{doc.latest_version}
                        {doc.version_count > 1 && <span className="text-ink-300 ml-1">({doc.version_count})</span>}
                      </span>
                    )}
                    {doc.review_date && (
                      <span
                        className={
                          isOverdue
                            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700 border border-orange-200"
                            : ""
                        }
                      >
                        {new Date(doc.review_date).toLocaleDateString("fr-FR")}
                        {isOverdue && " · Révision dépassée"}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 border-t border-ink-50 pt-3">
                    {doc.latest_status === "ready" && doc.latest_version_id ? (
                      <button
                        onClick={() => handlePublish(doc.latest_version_id!)}
                        disabled={publishingId === doc.latest_version_id}
                        className="text-xs font-medium text-lime-600 hover:text-lime-800 disabled:opacity-50 transition-colors"
                      >
                        {publishingId === doc.latest_version_id ? "Publication…" : "Publier"}
                      </button>
                    ) : doc.latest_status === "failed" && doc.latest_version_id ? (
                      <button
                        onClick={() => handleRetry(doc.latest_version_id!)}
                        disabled={retryingId === doc.latest_version_id}
                        className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                      >
                        {retryingId === doc.latest_version_id ? "Réindexation…" : "Réindexer"}
                      </button>
                    ) : doc.latest_version_id ? (
                      <a
                        href={`/documents/${doc.latest_version_id}/preview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 transition-colors"
                      >
                        Voir <ExternalLink size={12} strokeWidth={2} />
                      </a>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
                    {doc.latest_version_id && (
                      <button
                        onClick={() => handleDelete(doc.latest_version_id!, doc.title)}
                        disabled={deletingId === doc.latest_version_id}
                        className="text-xs font-medium text-ink-300 hover:text-red-600 disabled:opacity-50 transition-colors ml-auto"
                      >
                        {deletingId === doc.latest_version_id ? "…" : "Supprimer"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (md+) ────────────────────────────────────── */}
          <div className="hidden md:block bg-white rounded-2xl border border-ink-100 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-100 border-b border-ink-100">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Titre</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Visibilité</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Statut</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Version</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Propriétaire</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Révision</th>
                  <th className="text-left px-4 py-3 font-medium text-ink-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-paper-100 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-950">{doc.title}</p>
                      {doc.description && (
                        <p className="text-xs text-ink-300 truncate max-w-xs">{doc.description}</p>
                      )}
                      {doc.latest_status === "failed" && doc.latest_error_message && (
                        <p className="text-xs text-red-500 truncate max-w-xs" title={doc.latest_error_message}>
                          {doc.latest_error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {VISIBILITY_COLORS[doc.visibility] ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VISIBILITY_COLORS[doc.visibility]}`}>
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      ) : (
                        <span className="text-ink-500">{VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.latest_status ?? doc.status] ?? "bg-ink-100 text-ink-500"}`}>
                        {doc.latest_status ?? doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-500">
                      {doc.latest_version ? `v${doc.latest_version}` : "—"}
                      {doc.version_count > 1 && (
                        <span className="text-xs text-ink-300 ml-1">({doc.version_count} versions)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-500 text-xs">{doc.owner_email}</td>
                    <td className="px-4 py-3 text-xs">
                      {doc.review_date ? (
                        <span
                          className={
                            doc.status === "published" && new Date(doc.review_date) < new Date()
                              ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700 border border-orange-200"
                              : "text-ink-500"
                          }
                          title={
                            doc.status === "published" && new Date(doc.review_date) < new Date()
                              ? "Date de révision dépassée — voir W3 (obsolescence)"
                              : undefined
                          }
                        >
                          {new Date(doc.review_date).toLocaleDateString("fr-FR")}
                          {doc.status === "published" && new Date(doc.review_date) < new Date() && " · Révision dépassée"}
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {doc.latest_status === "ready" && doc.latest_version_id ? (
                          <button
                            onClick={() => handlePublish(doc.latest_version_id!)}
                            disabled={publishingId === doc.latest_version_id}
                            className="text-xs font-medium text-lime-600 hover:text-lime-800 disabled:opacity-50 transition-colors"
                            title="Rend cette version visible dans le chat (recherche RAG)"
                          >
                            {publishingId === doc.latest_version_id ? "Publication…" : "Publier"}
                          </button>
                        ) : doc.latest_status === "failed" && doc.latest_version_id ? (
                          <button
                            onClick={() => handleRetry(doc.latest_version_id!)}
                            disabled={retryingId === doc.latest_version_id}
                            className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
                            title="Relance l'extraction/l'indexation à partir du même fichier"
                          >
                            {retryingId === doc.latest_version_id ? "Réindexation…" : "Réindexer"}
                          </button>
                        ) : doc.latest_version_id ? (
                          <a
                            href={`/documents/${doc.latest_version_id}/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 transition-colors"
                            title="Voir le document"
                          >
                            Voir <ExternalLink size={12} strokeWidth={2} />
                          </a>
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                        {doc.latest_version_id && (
                          <button
                            onClick={() => handleDelete(doc.latest_version_id!, doc.title)}
                            disabled={deletingId === doc.latest_version_id}
                            className="text-xs font-medium text-ink-300 hover:text-red-600 disabled:opacity-50 transition-colors"
                            title="Supprimer ce document"
                          >
                            {deletingId === doc.latest_version_id ? "…" : "Supprimer"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-red-600" strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1">Supprimer ce document ?</h2>
                <p className="text-sm text-ink-500">
                  <span className="font-medium text-ink-900">« {confirmDelete.title} »</span> ne sera plus
                  accessible dans le chat ni la bibliothèque. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-ink-100 rounded-xl py-2.5 text-sm font-medium text-ink-600 hover:bg-paper-100 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAndDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-medium transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">Nouveau document</h2>
            <form onSubmit={handleUpload} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Titre *</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Visibilité</label>
                <select
                  value={form.visibility}
                  onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as "company" | "department" | "restricted" }))}
                  className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                >
                  <option value="company">Entreprise</option>
                  <option value="department">Département</option>
                  <option value="restricted">Restreint</option>
                </select>
              </div>
              {form.visibility === "department" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700">Département *</label>
                  {departments.length === 0 ? (
                    <p className="text-xs text-ink-500 bg-paper-100 rounded-lg p-2.5">
                      Aucun département configuré pour votre entreprise.
                    </p>
                  ) : (
                    <select
                      required
                      value={form.departmentId}
                      onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                      className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                    >
                      <option value="">Sélectionnez un département</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Date de révision</label>
                <input
                  type="date"
                  value={form.reviewDate}
                  onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
                  className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                />
                <p className="text-xs text-ink-400">Facultatif — utilisé pour le suivi d&apos;obsolescence.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Fichier (PDF ou TXT) *</label>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  required
                  onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                  className="text-sm text-ink-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-lime-50 file:text-lime-700 hover:file:bg-lime-100"
                />
                <p className="text-xs text-ink-400">Formats acceptés : PDF, TXT (max 20 Mo)</p>
                {form.file && (
                  <div className="flex items-center justify-between text-xs bg-paper-100 border border-ink-100 rounded-lg px-3 py-2 text-ink-700 mt-1">
                    <span className="truncate font-medium">{form.file.name}</span>
                    <span className="shrink-0 text-ink-400 ml-2">{formatFileSize(form.file.size)}</span>
                  </div>
                )}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setError(null);
                    setForm({ title: "", description: "", visibility: "company", departmentId: "", reviewDate: "", file: null });
                  }}
                  className="flex-1 border border-ink-100 rounded-lg py-2 text-sm font-medium text-ink-500 hover:bg-paper-100 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 bg-ink-950 hover:bg-ink-900 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {uploading ? "Upload…" : "Uploader"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
