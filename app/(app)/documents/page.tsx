"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

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
  review_date: string | null;
  created_at: string;
}

const VISIBILITY_LABELS: Record<string, string> = {
  company: "Entreprise",
  department: "Département",
  restricted: "Restreint",
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

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "company" as "company" | "department" | "restricted",
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
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", form.file);
    fd.append("title", form.title);
    fd.append("description", form.description);
    fd.append("visibility", form.visibility);
    const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Erreur lors de l'upload.");
    } else {
      // Deliberately NOT auto-published here: upload only runs
      // extraction/chunking/embeddings (status becomes "ready" on
      // success). Publication is a separate, explicit action — see
      // handlePublish — so a reviewer always sees new content before
      // it becomes visible to chat/retrieval.
      setShowModal(false);
      setForm({ title: "", description: "", visibility: "company", file: null });
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

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold text-ink-950 tracking-tight">Bibliothèque de documents</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-ink-950 hover:bg-ink-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nouveau document
        </button>
      </div>

      {!loading && docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un document…"
            className="flex-1 min-w-[200px] border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
          >
            <option value="all">Tous les statuts</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value)}
            className="border border-ink-100 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400"
          >
            <option value="all">Toutes les visibilités</option>
            {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="text-xs text-ink-300 whitespace-nowrap">
            {filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-center text-ink-300 py-20">Chargement…</div>
      ) : docs.length === 0 ? (
        <div className="text-center text-ink-300 py-20">Aucun document disponible.</div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center text-ink-300 py-20">Aucun document ne correspond à ces critères.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
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
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
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
                  <td className="px-4 py-3 text-ink-500 text-xs">
                    {doc.review_date ? new Date(doc.review_date).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {doc.latest_status === "ready" && doc.latest_version_id ? (
                      <button
                        onClick={() => handlePublish(doc.latest_version_id!)}
                        disabled={publishingId === doc.latest_version_id}
                        className="text-xs font-medium text-lime-600 hover:text-lime-800 disabled:opacity-50 transition-colors"
                        title="Rend cette version visible dans le chat (recherche RAG)"
                      >
                        {publishingId === doc.latest_version_id ? "Publication…" : "Publier"}
                      </button>
                    ) : doc.latest_status === "failed" ? (
                      <span className="text-xs text-red-500">Échec du traitement</span>
                    ) : (
                      <span className="text-xs text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
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
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Fichier PDF *</label>
                <input
                  type="file"
                  accept=".pdf,.txt,.md"
                  required
                  onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                  className="text-sm text-ink-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-lime-50 file:text-lime-700 hover:file:bg-lime-100"
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setError(null); }}
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
