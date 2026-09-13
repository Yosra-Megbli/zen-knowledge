"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ExternalLink,
  Trash2,
  FileUp,
  Calendar,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { CustomSelect } from "../../components/CustomSelect.tsx";

interface Document {
  id: string;
  title: string;
  description: string | null;
  visibility: string;
  status: string;
  owner_email: string;
  owner_name?: string;
  company_name?: string;
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

const VISIBILITY_COLORS: Record<string, string> = {
  restricted: "bg-amber-50 text-amber-700 border border-amber-200",
  department: "bg-paper-100 text-ink-700 border border-ink-100",
  company: "bg-paper-50 text-ink-600 border border-ink-100",
};

const STATUS_LABELS: Record<string, string> = {
  published: "Publié",
  ready: "Prêt",
  processing: "En cours",
  indexing: "En cours",
  failed: "Échec",
  draft: "Brouillon",
  archived: "Archivé",
  unpublished: "Dépublié",
  pending_review: "En attente",
};

const STATUS_COLORS: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  ready: "bg-blue-50 text-blue-700 border border-blue-200",
  processing: "bg-amber-50 text-amber-700 border border-amber-200 animate-pulse",
  indexing: "bg-amber-50 text-amber-700 border border-amber-200 animate-pulse",
  failed: "bg-red-50 text-red-700 border border-red-200",
  draft: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  archived: "bg-ink-100 text-ink-500 border border-ink-200",
  unpublished: "bg-gray-100 text-gray-700 border border-gray-200",
  pending_review: "bg-blue-50 text-blue-700 border border-blue-200",
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
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Filters state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  // Sorting state
  const [sortField, setSortField] = useState<"title" | "version" | "review_date">("title");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "company" as "company" | "department" | "restricted",
    departmentId: "",
    reviewDate: "",
    file: null as File | null,
  });

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/documents/list");
    if (res.ok) setDocs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDocs();

    fetch("/api/departments")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => setDepartments([]));
  }, [fetchDocs]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = docs.filter((doc) => {
      if (q && !doc.title.toLowerCase().includes(q) && !(doc.description ?? "").toLowerCase().includes(q)) {
        return false;
      }
      const status = doc.latest_status ?? doc.status;
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (visibilityFilter !== "all" && doc.visibility !== visibilityFilter) return false;
      if (companyFilter !== "all" && (doc.company_name ?? "") !== companyFilter) return false;
      if (departmentFilter !== "all") {
        if (departmentFilter === "none" && doc.department_name) return false;
        if (departmentFilter !== "none" && doc.department_name !== departmentFilter) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") {
        cmp = a.title.localeCompare(b.title, "fr", { sensitivity: "base" });
      } else if (sortField === "version") {
        const vA = a.latest_version ?? 0;
        const vB = b.latest_version ?? 0;
        cmp = vA - vB;
      } else if (sortField === "review_date") {
        const tA = a.review_date ? new Date(a.review_date).getTime() : 0;
        const tB = b.review_date ? new Date(b.review_date).getTime() : 0;
        cmp = tA - tB;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [docs, search, statusFilter, visibilityFilter, companyFilter, departmentFilter, sortField, sortOrder]);

  const statusOptions = useMemo(
    () => Array.from(new Set(docs.map((d) => d.latest_status ?? d.status))).sort(),
    [docs]
  );

  const companyOptions = useMemo(
    () => Array.from(new Set(docs.map((d) => d.company_name).filter(Boolean) as string[])).sort(),
    [docs]
  );

  const departmentOptions = useMemo(
    () => Array.from(new Set(docs.map((d) => d.department_name).filter(Boolean) as string[])).sort(),
    [docs]
  );

  function handleSort(field: "title" | "version" | "review_date") {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  function renderSortHeader(field: "title" | "version" | "review_date", label: string) {
    const isActive = sortField === field;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="inline-flex items-center gap-1.5 font-medium text-ink-600 hover:text-ink-950 transition-colors cursor-pointer group"
      >
        <span>{label}</span>
        {isActive ? (
          sortOrder === "asc" ? (
            <ArrowUp size={14} className="text-lime-700" />
          ) : (
            <ArrowDown size={14} className="text-lime-700" />
          )
        ) : (
          <ArrowUpDown size={14} className="text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    );
  }

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
      } else if (errCode === "DUPLICATE_DOCUMENT") {
        setError(errMsg || "Un document identique ou de même titre existe déjà dans votre organisation.");
      } else {
        setError(errMsg || "Erreur lors de l'upload.");
      }
    } else {
      setShowModal(false);
      setForm({ title: "", description: "", visibility: "company", departmentId: "", reviewDate: "", file: null });
      showToast("Document uploadé avec succès !", "success");
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
      showToast(data.error ?? "Erreur lors de la publication.", "error");
    } else {
      showToast("Document publié et actif dans le RAG !", "success");
      fetchDocs();
    }
    setPublishingId(null);
  }

  async function handleRetry(versionId: string) {
    setRetryingId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${versionId}/retry`, { method: "POST" });
      const json = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        showToast(json.error ?? "Erreur lors de la réindexation.", "error");
      } else {
        showToast("Réindexation effectuée avec succès !", "success");
        await fetchDocs();
      }
    } catch {
      showToast("Erreur réseau lors de la réindexation.", "error");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleDelete(versionId: string, title: string) {
    setConfirmDelete({ versionId, title });
  }

  async function confirmAndDelete() {
    if (!confirmDelete) return;
    const { versionId, title } = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${versionId}/delete`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        showToast(data.error ?? "Erreur lors de la suppression.", "error");
      } else {
        showToast(`Document « ${title} » supprimé.`, "success");
        await fetchDocs();
      }
    } catch {
      showToast("Erreur réseau.", "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      {/* Toast feedback */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium transition-all animate-in fade-in slide-in-from-top-3 ${
            toast.type === "success"
              ? "bg-white text-emerald-900 border-emerald-200 shadow-emerald-500/10"
              : "bg-white text-red-900 border-red-200 shadow-red-500/10"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-red-600 shrink-0" />
          )}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 text-ink-400 hover:text-ink-700 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-950 tracking-tight">
            Bibliothèque de documents
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Gestion du catalogue documentaire multi-sociétés, suivi d&apos;indexation et contrôle de publication.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-ink-950 hover:bg-ink-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer shadow-xs"
        >
          + Nouveau document
        </button>
      </div>

      {!loading && docs.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-5">
          {/* Search — full width */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un document par titre ou description…"
            className="w-full border border-ink-100 rounded-xl px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs"
          />

          {/* Filters row: Statut, Visibilité, Société, Service */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <CustomSelect
              id="status-filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "Tous les statuts" },
                ...statusOptions.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s })),
              ]}
            />
            <CustomSelect
              id="visibility-filter"
              value={visibilityFilter}
              onChange={setVisibilityFilter}
              options={[
                { value: "all", label: "Toutes visibilités" },
                ...Object.entries(VISIBILITY_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
            <CustomSelect
              id="company-filter"
              value={companyFilter}
              onChange={setCompanyFilter}
              options={[
                { value: "all", label: "Toutes sociétés" },
                ...companyOptions.map((c) => ({ value: c, label: c })),
              ]}
            />
            <CustomSelect
              id="department-filter"
              value={departmentFilter}
              onChange={setDepartmentFilter}
              options={[
                { value: "all", label: "Tous les services" },
                ...departmentOptions.map((d) => ({ value: d, label: d })),
                { value: "none", label: "Sans service (Général)" },
              ]}
            />
          </div>

          {/* Results counter and reset */}
          <div className="flex items-center justify-between text-xs text-ink-400 px-1 pt-0.5">
            <span>
              {filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""} affiché{filteredDocs.length !== 1 ? "s" : ""}
            </span>
            {(search || statusFilter !== "all" || visibilityFilter !== "all" || companyFilter !== "all" || departmentFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setVisibilityFilter("all");
                  setCompanyFilter("all");
                  setDepartmentFilter("all");
                }}
                className="text-lime-700 hover:text-lime-900 font-medium hover:underline cursor-pointer"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-ink-400 py-20">Chargement…</div>
      ) : docs.length === 0 ? (
        <div className="text-center text-ink-400 py-20">Aucun document disponible.</div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center text-ink-400 py-20">Aucun document ne correspond à ces critères.</div>
      ) : (
        <>
          {/* ── Mobile cards (< md) ──────────────────────────────────────── */}
          <div className="md:hidden flex flex-col gap-3">
            {filteredDocs.map((doc) => {
              const statusKey = doc.latest_status ?? doc.status;
              const isOverdue =
                doc.status === "published" &&
                doc.review_date != null &&
                new Date(doc.review_date) < new Date();
              return (
                <div key={doc.id} className="bg-white rounded-2xl border border-ink-100 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-950 text-sm">{doc.title}</p>
                      {doc.description && (
                        <p className="text-xs text-ink-400 truncate mt-0.5">{doc.description}</p>
                      )}
                      <p className="text-xs text-ink-500 font-medium mt-1">
                        {doc.company_name ?? "ZEN Knowledge"} · {doc.department_name ?? "Groupe"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[statusKey] ?? "bg-ink-100 text-ink-500"}`}>
                        {STATUS_LABELS[statusKey] ?? statusKey}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-50 text-ink-600"}`}>
                        {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                      </span>
                    </div>
                  </div>

                  {/* Error banner if failed */}
                  {doc.latest_status === "failed" && doc.latest_error_message && (
                    <div className="flex items-start gap-1.5 p-2 bg-red-50 text-red-700 rounded-lg text-xs border border-red-100">
                      <AlertCircle size={14} className="shrink-0 text-red-600 mt-0.5" />
                      <span>{doc.latest_error_message}</span>
                    </div>
                  )}

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
                    <span className="font-medium text-ink-700">{doc.owner_name || doc.owner_email}</span>
                    {doc.latest_version && (
                      <span>
                        v{doc.latest_version}
                        {doc.version_count > 1 && <span className="text-ink-300 ml-1">({doc.version_count} versions)</span>}
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
                        {isOverdue && " · Dépassée"}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
                    {doc.latest_status === "ready" && doc.latest_version_id ? (
                      <button
                        onClick={() => handlePublish(doc.latest_version_id!)}
                        disabled={publishingId === doc.latest_version_id}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-lime-400 text-ink-950 hover:bg-lime-500 disabled:opacity-50 transition-colors"
                      >
                        {publishingId === doc.latest_version_id ? "Publication…" : "Publier"}
                      </button>
                    ) : null}

                    {doc.latest_version_id && (
                      <button
                        onClick={() => handleRetry(doc.latest_version_id!)}
                        disabled={retryingId === doc.latest_version_id}
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                          doc.latest_status === "failed"
                            ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                            : "text-ink-600 hover:bg-paper-100"
                        }`}
                      >
                        <RefreshCw size={12} className={retryingId === doc.latest_version_id ? "animate-spin" : ""} />
                        <span>{retryingId === doc.latest_version_id ? "Réindexation…" : "Réindexer"}</span>
                      </button>
                    )}

                    {doc.latest_version_id && (
                      <a
                        href={`/documents/${doc.latest_version_id}/preview`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-lime-700 transition-colors px-2 py-1.5"
                      >
                        Voir <ExternalLink size={12} strokeWidth={2} />
                      </a>
                    )}

                    {doc.latest_version_id && (
                      <button
                        onClick={() => handleDelete(doc.latest_version_id!, doc.title)}
                        disabled={deletingId === doc.latest_version_id}
                        className="text-xs font-medium text-ink-400 hover:text-red-600 disabled:opacity-50 transition-colors ml-auto p-1.5"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (md+) ────────────────────────────────────── */}
          <div className="hidden md:block bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-paper-100 border-b border-ink-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      {renderSortHeader("title", "Titre")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      Société · Service
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      Visibilité
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      Statut
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      {renderSortHeader("version", "Version")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      Propriétaire
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      {renderSortHeader("review_date", "Révision")}
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-ink-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {filteredDocs.map((doc) => {
                    const statusKey = doc.latest_status ?? doc.status;
                    const isOverdue =
                      doc.status === "published" &&
                      doc.review_date != null &&
                      new Date(doc.review_date) < new Date();

                    return (
                      <tr key={doc.id} className="hover:bg-paper-50 transition-colors">
                        {/* Titre */}
                        <td className="px-4 py-3">
                          <p className="font-semibold text-ink-950">{doc.title}</p>
                          {doc.description && (
                            <p className="text-xs text-ink-400 truncate max-w-xs">{doc.description}</p>
                          )}
                        </td>

                        {/* Société · Service */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-ink-900 text-xs">
                              {doc.company_name ?? "—"}
                            </span>
                            <span className="text-[11px] text-ink-500">
                              {doc.department_name ?? "Groupe (Général)"}
                            </span>
                          </div>
                        </td>

                        {/* Visibilité */}
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-50 text-ink-600"
                            }`}
                          >
                            {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                          </span>
                        </td>

                        {/* Statut & Erreur */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                STATUS_COLORS[statusKey] ?? "bg-ink-100 text-ink-500"
                              }`}
                            >
                              {STATUS_LABELS[statusKey] ?? statusKey}
                            </span>
                            {doc.latest_status === "failed" && doc.latest_error_message && (
                              <div
                                className="flex items-center gap-1 text-[11px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 max-w-[180px]"
                                title={doc.latest_error_message}
                              >
                                <AlertCircle size={11} className="shrink-0 text-red-500" />
                                <span className="truncate">{doc.latest_error_message}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Version */}
                        <td className="px-4 py-3 text-ink-600">
                          {doc.latest_version ? `v${doc.latest_version}` : "—"}
                          {doc.version_count > 1 && (
                            <span className="text-xs text-ink-400 ml-1">({doc.version_count} v.)</span>
                          )}
                        </td>

                        {/* Propriétaire */}
                        <td className="px-4 py-3 text-xs">
                          <div className="font-medium text-ink-900">{doc.owner_name || doc.owner_email}</div>
                          {doc.owner_name && doc.owner_name !== doc.owner_email && (
                            <div className="text-[11px] text-ink-400 truncate max-w-[130px]" title={doc.owner_email}>
                              {doc.owner_email}
                            </div>
                          )}
                        </td>

                        {/* Date de révision */}
                        <td className="px-4 py-3 text-xs">
                          {doc.review_date ? (
                            <span
                              className={
                                isOverdue
                                  ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700 border border-orange-200"
                                  : "text-ink-600"
                              }
                              title={isOverdue ? "Date de révision dépassée — voir W3 (obsolescence)" : undefined}
                            >
                              {new Date(doc.review_date).toLocaleDateString("fr-FR")}
                              {isOverdue && " · Dépassée"}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {doc.latest_status === "ready" && doc.latest_version_id && (
                              <button
                                onClick={() => handlePublish(doc.latest_version_id!)}
                                disabled={publishingId === doc.latest_version_id}
                                className="text-xs font-medium px-2.5 py-1 rounded-lg bg-lime-400 text-ink-950 hover:bg-lime-500 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
                                title="Publier ce document dans l'assistant RAG"
                              >
                                {publishingId === doc.latest_version_id ? "Publication…" : "Publier"}
                              </button>
                            )}

                            {doc.latest_version_id && (
                              <button
                                onClick={() => handleRetry(doc.latest_version_id!)}
                                disabled={retryingId === doc.latest_version_id}
                                className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                                  doc.latest_status === "failed"
                                    ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 shadow-2xs"
                                    : "text-ink-600 hover:bg-paper-100 hover:text-ink-950"
                                }`}
                                title={doc.latest_status === "failed" ? "Relancer l'ingestion" : "Réindexer ce document"}
                              >
                                <RefreshCw size={12} className={retryingId === doc.latest_version_id ? "animate-spin" : ""} />
                                <span>{retryingId === doc.latest_version_id ? "Réindexation…" : "Réindexer"}</span>
                              </button>
                            )}

                            {doc.latest_version_id && (
                              <a
                                href={`/documents/${doc.latest_version_id}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 text-ink-500 hover:text-lime-700 transition-colors rounded-lg hover:bg-paper-100"
                                title="Voir le document"
                              >
                                <span>Voir</span>
                                <ExternalLink size={12} strokeWidth={2} />
                              </a>
                            )}

                            {doc.latest_version_id && (
                              <button
                                onClick={() => handleDelete(doc.latest_version_id!, doc.title)}
                                disabled={deletingId === doc.latest_version_id}
                                className="p-1.5 text-ink-300 hover:text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer"
                                title="Supprimer ce document"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-ink-100">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-red-600">
                <Trash2 size={22} strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1.5">
                  Supprimer « {confirmDelete.title} » ?
                </h2>
                <p className="text-sm text-ink-500 leading-relaxed">
                  Cette action est irréversible. Le document et ses versions seront immédiatement retirés de la bibliothèque et exclus du chat/RAG.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-ink-100 rounded-xl py-2 text-sm font-medium text-ink-600 hover:bg-paper-100 transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAndDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2 text-sm font-medium transition-colors cursor-pointer shadow-xs"
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto border-t-4 border-lime-400">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-9 h-9 rounded-xl bg-lime-400 flex items-center justify-center shrink-0">
                <FileUp size={18} className="text-ink-900" />
              </div>
              <h2 className="text-lg font-semibold text-ink-900">Nouveau document</h2>
            </div>
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
                <CustomSelect
                  id="modal-visibility"
                  value={form.visibility}
                  onChange={(v) => setForm((f) => ({ ...f, visibility: v as "company" | "department" | "restricted" }))}
                  options={[
                    { value: "company", label: "Entreprise" },
                    { value: "department", label: "Département" },
                    { value: "restricted", label: "Restreint" },
                  ]}
                />
              </div>
              {form.visibility === "department" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-ink-700">Département *</label>
                  {departments.length === 0 ? (
                    <p className="text-xs text-ink-500 bg-paper-100 rounded-lg p-2.5">
                      Aucun département configuré pour votre entreprise.
                    </p>
                  ) : (
                    <CustomSelect
                      id="modal-department"
                      required
                      value={form.departmentId}
                      onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                      options={[
                        { value: "", label: "Sélectionnez un département" },
                        ...departments.map((dept) => ({ value: dept.id, label: dept.name })),
                      ]}
                    />
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Date de révision</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Calendar size={15} className="text-ink-300" strokeWidth={1.75} />
                  </span>
                  {!form.reviewDate && (
                    <span className="absolute left-9 top-1/2 -translate-y-1/2 pointer-events-none text-sm text-ink-300 select-none">
                      jj/mm/aaaa
                    </span>
                  )}
                  <input
                    type="date"
                    value={form.reviewDate}
                    onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
                    className="w-full border border-ink-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
                  />
                </div>
                <p className="text-xs text-ink-400">Facultatif — utilisé pour le suivi d&apos;obsolescence.</p>
              </div>
              <hr className="border-ink-100 my-1" />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-700">Fichier (PDF ou TXT) *</label>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  required
                  onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
                  className="text-sm text-ink-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-lime-400 file:text-ink-900 hover:file:bg-lime-500"
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
                  className="flex-1 border border-ink-200 rounded-lg py-2 text-sm font-medium text-ink-700 hover:bg-paper-100 transition-colors"
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