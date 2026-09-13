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
  RotateCcw,
  Archive,
  MoreHorizontal,
  UploadCloud,
  FileText,
  SearchX,
  Check,
  Search,
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
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [uploadStep, setUploadStep] = useState<number>(0); // 0 = form, 1 = extraction, 2 = découpage, 3 = embeddings, 4 = prêt
  const [uploadSuccessDoc, setUploadSuccessDoc] = useState<{ versionId: string; title: string; chunkCount?: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{ versionId: string; title: string } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<{ versionId: string; title: string } | null>(null);
  const [kebabOpenId, setKebabOpenId] = useState<string | null>(null);

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

  // Fermeture du kebab menu au clic extérieur ou touche Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (kebabOpenId && !(e.target as HTMLElement).closest(".kebab-container")) {
        setKebabOpenId(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setKebabOpenId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [kebabOpenId]);

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

  // Quick filter status counts
  const statusCounts = useMemo(() => {
    return {
      all: docs.length,
      published: docs.filter((d) => (d.latest_status ?? d.status) === "published").length,
      archived: docs.filter((d) => (d.latest_status ?? d.status) === "archived").length,
      failed: docs.filter((d) => (d.latest_status ?? d.status) === "failed").length,
    };
  }, [docs]);

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
            <ArrowUp size={13} className="text-lime-700" />
          ) : (
            <ArrowDown size={13} className="text-lime-700" />
          )
        ) : (
          <ArrowUpDown size={13} className="text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    );
  }

  function resetUploadModal() {
    setShowModal(false);
    setUploadStep(0);
    setUploadSuccessDoc(null);
    setError(null);
    setIsDragging(false);
    setForm({ title: "", description: "", visibility: "company", departmentId: "", reviewDate: "", file: null });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!form.file || !form.title.trim()) return;

    if (form.visibility === "department" && !form.departmentId) {
      setError("Veuillez sélectionner un département pour la visibilité départementale.");
      return;
    }

    setUploading(true);
    setUploadStep(1); // 1 = Extraction
    setError(null);
    setUploadSuccessDoc(null);

    // Simulation progressive du stepper pendant le traitement
    const timerStep2 = setTimeout(() => setUploadStep(2), 650); // 2 = Découpage
    const timerStep3 = setTimeout(() => setUploadStep(3), 1400); // 3 = Embeddings

    try {
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

      clearTimeout(timerStep2);
      clearTimeout(timerStep3);

      if (!res.ok) {
        setUploadStep(0);
        const errCode = (data.errorCode ?? data.code) as string | undefined;
        const errMsg = (data.errorMessage ?? data.error) as string | undefined;
        if (errCode === "NO_EXTRACTABLE_TEXT" || errMsg?.includes("scanned/image-only") || errMsg?.includes("aucun texte")) {
          setError(
            "Ce PDF ne contient pas de couche texte exploitable (document scanné). Les PDF scannés nécessitent actuellement une étape OCR non disponible dans cette version."
          );
        } else if (errCode === "DUPLICATE_DOCUMENT") {
          setError(errMsg || "Un document identique ou de même titre existe déjà dans votre organisation.");
        } else {
          setError(errMsg || "Erreur lors de l'upload et de l'ingestion.");
        }
      } else {
        setUploadStep(4); // 4 = Prêt
        const versionId = (data.documentVersionId ?? data.latest_version_id ?? data.versionId) as string;
        setUploadSuccessDoc({
          versionId,
          title: form.title,
          chunkCount: (data.chunkCount as number) || undefined,
        });
        showToast("Document uploadé et indexé avec succès !", "success");
        fetchDocs();
      }
    } catch {
      clearTimeout(timerStep2);
      clearTimeout(timerStep3);
      setUploadStep(0);
      setError("Erreur de connexion au serveur.");
    } finally {
      setUploading(false);
    }
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
      if (!res.ok) {
        let errorMsg = "Erreur lors de la réindexation.";
        try {
          const text = await res.text();
          try {
            const json = JSON.parse(text);
            errorMsg = json.error || json.errorMessage || json.message || errorMsg;
          } catch {
            if (res.status === 500 || res.status === 504) {
              errorMsg = "Délai dépassé (timeout serverless 10s) ou fichier source indisponible sur le cloud.";
            } else if (text && text.length < 200) {
              errorMsg = text;
            } else {
              errorMsg = `Erreur serveur (${res.status})`;
            }
          }
        } catch {
          // fallback default
        }
        showToast(errorMsg, "error");
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

  async function handleArchive(versionId: string, title: string) {
    setConfirmArchive({ versionId, title });
    setKebabOpenId(null);
  }

  async function confirmAndArchive() {
    if (!confirmArchive) return;
    const { versionId, title } = confirmArchive;
    setConfirmArchive(null);
    setArchivingId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${versionId}/archive`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        showToast(data.error ?? "Erreur lors de l'archivage.", "error");
      } else {
        showToast(`Document « ${title} » archivé avec succès.`, "success");
        await fetchDocs();
      }
    } catch {
      showToast("Erreur réseau.", "error");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleUnarchive(versionId: string, title: string) {
    setUnarchivingId(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${versionId}/unarchive`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        showToast(data.error ?? "Erreur lors de la réactivation.", "error");
      } else {
        showToast(`Document « ${title} » réactivé avec succès !`, "success");
        await fetchDocs();
      }
    } catch {
      showToast("Erreur réseau.", "error");
    } finally {
      setUnarchivingId(null);
    }
  }

  async function handleDelete(versionId: string, title: string) {
    setConfirmDelete({ versionId, title });
    setKebabOpenId(null);
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
    <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-8">
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
            Gestion du catalogue documentaire, statut d&apos;indexation et contrôle du cycle de vie.
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
        <div className="flex flex-col gap-3 mb-6 bg-white p-4 rounded-2xl border border-ink-100 shadow-2xs">
          {/* Search bar with icon and clear button */}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un document par titre ou description…"
              className="w-full border border-ink-100 rounded-xl pl-10 pr-9 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs transition-shadow"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 p-0.5 rounded-full hover:bg-paper-100 transition-colors cursor-pointer"
                title="Effacer la recherche"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Quick status filter chips */}
          <div className="flex items-center gap-2 overflow-x-auto py-0.5 text-xs no-scrollbar">
            {[
              { key: "all", label: `Tous (${statusCounts.all})` },
              { key: "published", label: `Publiés (${statusCounts.published})` },
              { key: "archived", label: `Archivés (${statusCounts.archived})` },
              { key: "failed", label: `Échec (${statusCounts.failed})` },
            ].map((chip) => {
              const isActive = statusFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setStatusFilter(chip.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:outline-none ${
                    isActive
                      ? "bg-lime-100 text-ink-950 border border-lime-400 font-semibold shadow-2xs scale-[1.02]"
                      : "bg-white text-ink-600 border border-ink-100 hover:bg-paper-100 hover:border-ink-200"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          {/* Filters row: Visibilité, Société, Service */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
          <div className="flex items-center justify-between text-xs text-ink-400 px-1 pt-0.5 border-t border-ink-50">
            <span>
              <span className="font-semibold text-ink-800">{filteredDocs.length}</span> document{filteredDocs.length !== 1 ? "s" : ""} affiché{filteredDocs.length !== 1 ? "s" : ""}
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
                className="inline-flex items-center gap-1 text-xs font-semibold text-lime-800 hover:text-lime-950 bg-lime-50 hover:bg-lime-100 px-2 py-0.5 rounded-full border border-lime-200 transition-colors cursor-pointer"
              >
                <X size={12} />
                Effacer les filtres
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-2xs p-4 space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 animate-pulse py-3 px-3 border-b border-ink-50 last:border-0">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-paper-200 rounded-md w-1/3" />
                <div className="h-3 bg-paper-100 rounded-md w-1/2" />
              </div>
              <div className="h-6 bg-paper-100 rounded-full w-24 hidden sm:block" />
              <div className="h-6 bg-paper-100 rounded-full w-20" />
              <div className="h-4 bg-paper-100 rounded-md w-12 hidden md:block" />
              <div className="h-8 bg-paper-100 rounded-lg w-16" />
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center bg-white rounded-2xl border border-ink-100 p-12 space-y-3 shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-paper-100 text-ink-400 flex items-center justify-center mx-auto border border-ink-100">
            <FileText size={24} />
          </div>
          <h3 className="font-semibold text-ink-900 text-base">Aucun document dans la bibliothèque</h3>
          <p className="text-sm text-ink-400 max-w-sm mx-auto">
            Commencez par ajouter votre premier document d&apos;entreprise pour l&apos;indexer dans le moteur RAG.
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-ink-950 hover:bg-ink-900 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors cursor-pointer mt-2 shadow-xs"
          >
            <FileUp size={16} />
            Nouveau document
          </button>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center bg-white rounded-2xl border border-ink-100 p-12 space-y-3 shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            <SearchX size={24} strokeWidth={1.75} />
          </div>
          <h3 className="font-semibold text-ink-900 text-base">Aucun document ne correspond</h3>
          <p className="text-sm text-ink-400 max-w-sm mx-auto">
            Aucun résultat trouvé pour votre sélection de filtres ou de recherche.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
              setVisibilityFilter("all");
              setCompanyFilter("all");
              setDepartmentFilter("all");
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-ink-200 text-sm font-medium text-ink-700 hover:bg-paper-100 transition-colors cursor-pointer"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        /* ── Tableau documentaire — responsive avec scroll horizontal contrôlé & alignement top ── */
        <div className="bg-white rounded-2xl border border-ink-100 overflow-x-auto shadow-2xs">
            <table className="w-full min-w-[960px] text-sm table-fixed">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[14%]" />
                <col className="w-[9%]" />
                <col className="w-[12%]" />
                <col className="w-[6%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="sticky top-0 bg-paper-100/95 backdrop-blur-xs border-b border-ink-100 z-10 shadow-2xs">
                <tr>
                  <th className="w-[22%] min-w-[190px] text-left px-3.5 py-3 font-medium text-ink-500 whitespace-nowrap">
                    {renderSortHeader("title", "Titre")}
                  </th>
                  <th className="w-[14%] min-w-[130px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    Société · Service
                  </th>
                  <th className="w-[9%] min-w-[85px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    Visibilité
                  </th>
                  <th className="w-[12%] min-w-[115px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    Statut
                  </th>
                  <th className="w-[6%] min-w-[65px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    {renderSortHeader("version", "Version")}
                  </th>
                  <th className="w-[14%] min-w-[130px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    Propriétaire
                  </th>
                  <th className="w-[15%] min-w-[140px] text-left px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    {renderSortHeader("review_date", "Révision")}
                  </th>
                  <th className="w-[8%] min-w-[75px] text-right px-3 py-3 font-medium text-ink-500 whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filteredDocs.map((doc, docIndex) => {
                  const statusKey = doc.latest_status ?? doc.status;
                  const isOverdue =
                    doc.status === "published" &&
                    doc.review_date != null &&
                    new Date(doc.review_date) < new Date();
                  const isArchived = statusKey === "archived";

                  return (
                    <tr
                      key={doc.id}
                      className={`align-top hover:bg-paper-50 transition-colors ${
                        isArchived ? "opacity-60 bg-paper-100/40" : ""
                      }`}
                    >
                      {/* Titre (proprement tronqué avec ellipsis CSS et title natif complet, max-w-0 forcé) */}
                      <td className="w-[22%] min-w-[190px] max-w-0 px-3.5 py-2.5 align-top overflow-hidden">
                        <div className="min-w-0 w-full overflow-hidden">
                          <p
                            className="font-semibold text-ink-950 truncate block text-xs sm:text-sm cursor-default"
                            title={doc.title}
                          >
                            {doc.title}
                          </p>
                          {doc.description && (
                            <p
                              className="text-xs text-ink-400 truncate block mt-0.5 cursor-default"
                              title={doc.description}
                            >
                              {doc.description}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Société · Service (2 lignes max, aligné en haut) */}
                      <td className="w-[14%] min-w-[130px] max-w-0 px-3 py-2.5 whitespace-nowrap align-top overflow-hidden">
                        <div className="min-w-0 w-full overflow-hidden">
                          <span className="font-medium text-ink-900 text-xs truncate block" title={doc.company_name}>
                            {doc.company_name ?? "—"}
                          </span>
                          <span
                            className="text-[11px] text-ink-500 truncate block mt-0.5"
                            title={doc.department_name ?? "Groupe (Général)"}
                          >
                            {doc.department_name ?? "Groupe (Général)"}
                          </span>
                        </div>
                      </td>

                      {/* Visibilité (badge aligné en haut) */}
                      <td className="w-[9%] min-w-[85px] px-3 py-2.5 whitespace-nowrap align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-50 text-ink-600"
                          }`}
                        >
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      </td>

                      {/* Statut & Erreur (troncature propre et pas de débordement) */}
                      <td className="w-[12%] min-w-[115px] max-w-0 px-3 py-2.5 whitespace-nowrap align-top overflow-hidden">
                        <div className="flex flex-col items-start gap-1 min-w-0 w-full max-w-full overflow-hidden">
                          {retryingId === doc.latest_version_id ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 animate-pulse flex items-center gap-1 shrink-0">
                              <RefreshCw size={11} className="animate-spin" />
                              <span>Indexation…</span>
                            </span>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                                STATUS_COLORS[statusKey] ?? "bg-ink-100 text-ink-500"
                              }`}
                            >
                              {STATUS_LABELS[statusKey] ?? statusKey}
                            </span>
                          )}
                          {doc.latest_status === "failed" && doc.latest_error_message && retryingId !== doc.latest_version_id && (
                            <div
                              className="flex items-center gap-1 text-[11px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100 min-w-0 max-w-full w-full overflow-hidden cursor-help"
                              title={doc.latest_error_message}
                            >
                              <AlertCircle size={10} className="shrink-0 text-red-500" />
                              <span className="truncate block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                {doc.latest_error_message}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Version (aligné en haut) */}
                      <td className="w-[6%] min-w-[65px] px-3 py-2.5 whitespace-nowrap align-top text-ink-600 text-xs">
                        <span className="inline-block mt-0.5">
                          {doc.latest_version ? `v${doc.latest_version}` : "—"}
                          {doc.version_count > 1 && (
                            <span className="text-[11px] text-ink-400 ml-1">({doc.version_count} v.)</span>
                          )}
                        </span>
                      </td>

                      {/* Propriétaire (Nom seul, email en title, aligné en haut) */}
                      <td className="w-[14%] min-w-[130px] max-w-0 px-3 py-2.5 whitespace-nowrap align-top text-xs overflow-hidden">
                        <span
                          className="font-medium text-ink-900 truncate block cursor-default mt-0.5"
                          title={doc.owner_email}
                        >
                          {doc.owner_name || doc.owner_email}
                        </span>
                      </td>

                      {/* Date de révision (aligné en haut) */}
                      <td className="w-[15%] min-w-[140px] max-w-0 px-3 py-2.5 whitespace-nowrap align-top text-xs overflow-hidden">
                        <div className="mt-0.5">
                          {doc.review_date ? (
                            <span
                              className={
                                isOverdue
                                  ? "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700 border border-orange-200"
                                  : "text-ink-600"
                              }
                              title={isOverdue ? "Date de révision dépassée" : undefined}
                            >
                              {new Date(doc.review_date).toLocaleDateString("fr-FR")}
                              {isOverdue && " · Dépassée"}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </div>
                      </td>

                      {/* Action (icônes standardisées avec menu kebab ⋯ parfaitement aligné) */}
                      <td className="w-[8%] min-w-[75px] px-3 py-2.5 text-right align-top relative whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {/* Voir le document (toujours présent dans toutes les lignes) */}
                          {doc.latest_version_id && (
                            <a
                              href={`/documents/${doc.latest_version_id}/preview`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-7 h-7 inline-flex items-center justify-center text-ink-400 hover:text-ink-950 hover:bg-paper-100 rounded-lg transition-colors cursor-pointer"
                              title="Voir le document"
                            >
                              <ExternalLink size={14} strokeWidth={2} />
                            </a>
                          )}

                          {/* Menu Kebab ⋯ TOUJOURS aligné dans le même slot */}
                          {doc.latest_version_id && (
                            <div className="relative inline-block text-left kebab-container">
                              <button
                                type="button"
                                onClick={() => setKebabOpenId(kebabOpenId === doc.id ? null : doc.id)}
                                className="w-7 h-7 inline-flex items-center justify-center text-ink-400 hover:text-ink-950 hover:bg-paper-100 rounded-lg transition-colors cursor-pointer"
                                title="Actions"
                              >
                                <MoreHorizontal size={14} />
                              </button>

                              {kebabOpenId === doc.id && (
                                <div
                                  className={`absolute right-0 ${
                                    docIndex >= Math.max(0, filteredDocs.length - 2)
                                      ? "bottom-full mb-1"
                                      : "top-full mt-1"
                                  } w-44 bg-white rounded-xl shadow-lg border border-ink-100 py-1 z-30 animate-in fade-in`}
                                  onMouseLeave={() => setKebabOpenId(null)}
                                >
                                  {/* Réactiver si archivé */}
                                  {isArchived && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setKebabOpenId(null);
                                        handleUnarchive(doc.latest_version_id!, doc.title);
                                      }}
                                      disabled={unarchivingId === doc.latest_version_id}
                                      className="w-full px-3 py-1.5 text-left text-xs font-medium text-lime-800 hover:bg-lime-50 flex items-center gap-2 cursor-pointer"
                                    >
                                      <RotateCcw
                                        size={13}
                                        className={unarchivingId === doc.latest_version_id ? "animate-spin" : "text-lime-600"}
                                      />
                                      <span>Réactiver dans le RAG</span>
                                    </button>
                                  )}

                                  {/* Publier si statut prêt */}
                                  {doc.latest_status === "ready" && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setKebabOpenId(null);
                                        handlePublish(doc.latest_version_id!);
                                      }}
                                      disabled={publishingId === doc.latest_version_id}
                                      className="w-full px-3 py-1.5 text-left text-xs font-medium text-lime-800 hover:bg-lime-50 flex items-center gap-2 cursor-pointer"
                                    >
                                      <CheckCircle2 size={13} className="text-lime-600" />
                                      <span>Publier dans le RAG</span>
                                    </button>
                                  )}

                                  {/* Réindexer si non archivé */}
                                  {!isArchived && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setKebabOpenId(null);
                                        handleRetry(doc.latest_version_id!);
                                      }}
                                      disabled={retryingId === doc.latest_version_id}
                                      className="w-full px-3 py-1.5 text-left text-xs text-ink-700 hover:bg-paper-100 flex items-center gap-2 cursor-pointer"
                                    >
                                      <RefreshCw
                                        size={12}
                                        className={retryingId === doc.latest_version_id ? "animate-spin" : ""}
                                      />
                                      <span>Réindexer</span>
                                    </button>
                                  )}

                                  {/* Archiver si publié */}
                                  {doc.status === "published" && !isArchived && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setKebabOpenId(null);
                                        handleArchive(doc.latest_version_id!, doc.title);
                                      }}
                                      className="w-full px-3 py-1.5 text-left text-xs text-amber-700 hover:bg-amber-50 flex items-center gap-2 cursor-pointer"
                                    >
                                      <Archive size={12} />
                                      <span>Archiver</span>
                                    </button>
                                  )}

                                  {/* Supprimer */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setKebabOpenId(null);
                                      handleDelete(doc.latest_version_id!, doc.title);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-ink-50 cursor-pointer"
                                  >
                                    <Trash2 size={12} />
                                    <span>Supprimer</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      )}

      {/* Archive Confirmation Modal (Étape 3) */}
      {confirmArchive && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-ink-100 space-y-4">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center shrink-0 text-amber-600">
                <Archive size={22} strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1">
                  Archiver « {confirmArchive.title} » ?
                </h2>
                <p className="text-sm text-ink-500 leading-relaxed">
                  Ce document sera immédiatement exclu de la recherche et du chat RAG, mais conservé dans la bibliothèque.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(null)}
                className="flex-1 border border-ink-100 rounded-xl py-2 text-sm font-medium text-ink-600 hover:bg-paper-100 transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAndArchive}
                disabled={Boolean(archivingId)}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2 text-sm font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {archivingId ? "Archivage…" : "Archiver"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-ink-100 space-y-4">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center shrink-0 text-red-600">
                <Trash2 size={22} strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1">
                  Supprimer « {confirmDelete.title} » ?
                </h2>
                <p className="text-sm text-ink-500 leading-relaxed">
                  Cette action est irréversible. Le document et ses versions seront immédiatement retirés de la bibliothèque et exclus du chat/RAG.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
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
                disabled={Boolean(deletingId)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2 text-sm font-medium transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {deletingId ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal (Étape 1 Premium) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 sm:p-7 max-h-[92vh] overflow-y-auto border border-ink-100 animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 mb-5 border-b border-ink-50 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-lime-400/90 text-ink-950 flex items-center justify-center shrink-0 shadow-xs">
                  <FileUp size={20} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-ink-950">Nouveau document</h2>
                  <p className="text-xs text-ink-400">Ajout et indexation dans le moteur RAG</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetUploadModal}
                className="text-ink-400 hover:text-ink-700 p-1.5 rounded-xl hover:bg-paper-100 transition-colors cursor-pointer"
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content: Success / Uploading / Form */}
            {uploadSuccessDoc ? (
              <div className="flex flex-col items-center text-center space-y-4 py-3 animate-in fade-in">
                <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border-2 border-emerald-200 shadow-sm">
                  <CheckCircle2 size={36} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-ink-950">Document indexé avec succès !</h3>
                  <p className="text-sm text-ink-500 max-w-sm mx-auto leading-relaxed">
                    « <span className="font-semibold text-ink-900">{uploadSuccessDoc.title}</span> » a été découpé et vectorisé.
                  </p>
                </div>

                <div className="w-full bg-paper-50 border border-ink-100 rounded-2xl p-4 text-xs text-left space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-500 font-medium">Statut d&apos;indexation :</span>
                    <span className="font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                      Prêt (Ready)
                    </span>
                  </div>
                  {uploadSuccessDoc.chunkCount !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-ink-500 font-medium">Segments vectorisés :</span>
                      <span className="font-semibold text-ink-800">{uploadSuccessDoc.chunkCount} chunks</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-ink-500 font-medium">Recherche RAG :</span>
                    <span className="text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                      Publication explicite requise
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                  <button
                    type="button"
                    onClick={resetUploadModal}
                    className="flex-1 border border-ink-200 rounded-xl py-2.5 text-sm font-medium text-ink-700 hover:bg-paper-100 transition-colors cursor-pointer"
                  >
                    Garder en prêt (fermer)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const vid = uploadSuccessDoc.versionId;
                      resetUploadModal();
                      if (vid) {
                        await handlePublish(vid);
                      }
                    }}
                    className="flex-1 bg-lime-400 hover:bg-lime-500 text-ink-950 font-bold rounded-xl py-2.5 text-sm transition-colors cursor-pointer shadow-xs inline-flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} />
                    Publier dans le RAG
                  </button>
                </div>
              </div>
            ) : uploading ? (
              <div className="py-8 space-y-7 animate-in fade-in">
                <div className="text-center space-y-1.5">
                  <h3 className="text-base font-bold text-ink-950">Indexation en cours…</h3>
                  <p className="text-xs text-ink-400">Traitement automatique du document et vectorisation locale</p>
                </div>

                {/* Stepper 4 étapes */}
                <div className="relative flex items-center justify-between px-3">
                  <div className="absolute left-7 right-7 top-4 -translate-y-1/2 h-0.5 bg-ink-100 -z-0" />
                  {[
                    { step: 1, label: "Extraction" },
                    { step: 2, label: "Découpage" },
                    { step: 3, label: "Embeddings" },
                    { step: 4, label: "Prêt" },
                  ].map((s) => {
                    const isDone = uploadStep > s.step;
                    const isCurrent = uploadStep === s.step;
                    return (
                      <div key={s.step} className="flex flex-col items-center gap-2 z-10 bg-white px-1">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all shadow-2xs ${
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isCurrent
                              ? "bg-lime-400 text-ink-950 ring-4 ring-lime-200 animate-pulse"
                              : "bg-paper-100 text-ink-400 border border-ink-100"
                          }`}
                        >
                          {isDone ? (
                            <Check size={16} strokeWidth={2.5} />
                          ) : isCurrent ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            s.step
                          )}
                        </div>
                        <span
                          className={`text-xs ${
                            isCurrent
                              ? "text-ink-950 font-bold"
                              : isDone
                              ? "text-emerald-700 font-semibold"
                              : "text-ink-400 font-normal"
                          }`}
                        >
                          {s.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-paper-50 rounded-xl p-3 text-center border border-ink-100/60">
                  <p className="text-xs text-ink-500">
                    {uploadStep === 1 && "Lecture du contenu texte du fichier (PDF/TXT)…"}
                    {uploadStep === 2 && "Découpage sémantique en segments chevauchants (chunks)…"}
                    {uploadStep === 3 && "Calcul des vecteurs d'embedding (modèle local Multilingual-E5)…"}
                    {uploadStep >= 4 && "Finalisation et enregistrement de la version…"}
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleUpload} className="flex flex-col gap-4">
                {/* Zone de dépôt Drag & Drop */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) {
                      setForm((f) => ({
                        ...f,
                        file: dropped,
                        title: f.title ? f.title : dropped.name.replace(/\.[^/.]+$/, ""),
                      }));
                    }
                  }}
                  onClick={() => {
                    const input = document.getElementById("file-upload-input");
                    input?.click();
                  }}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-lime-500 bg-lime-50/70 scale-[1.01]"
                      : form.file
                      ? "border-emerald-300 bg-emerald-50/30"
                      : "border-ink-200 bg-paper-50/50 hover:border-lime-400 hover:bg-lime-50/20"
                  }`}
                >
                  <input
                    id="file-upload-input"
                    type="file"
                    accept=".pdf,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const selected = e.target.files?.[0] ?? null;
                      if (selected) {
                        setForm((f) => ({
                          ...f,
                          file: selected,
                          title: f.title ? f.title : selected.name.replace(/\.[^/.]+$/, ""),
                        }));
                      }
                    }}
                  />

                  {form.file ? (
                    <div className="flex items-center justify-between gap-3 bg-white border border-emerald-200 rounded-xl p-3 shadow-2xs">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                          <FileText size={18} />
                        </div>
                        <div className="text-left min-w-0">
                          <p className="text-xs font-semibold text-ink-900 truncate">{form.file.name}</p>
                          <p className="text-[11px] text-ink-400">{formatFileSize(form.file.size)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm((f) => ({ ...f, file: null }));
                        }}
                        className="p-1 rounded-lg text-ink-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Changer de fichier"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="w-11 h-11 rounded-2xl bg-paper-100 text-ink-600 flex items-center justify-center mx-auto border border-ink-100">
                        <UploadCloud size={22} className="text-lime-700" />
                      </div>
                      <p className="text-sm font-medium text-ink-800">
                        Glissez un <span className="font-bold">PDF</span> ou <span className="font-bold">TXT</span> ici
                      </p>
                      <p className="text-xs text-ink-400">ou cliquez pour parcourir vos fichiers (max 20 Mo)</p>
                    </div>
                  )}
                </div>

                {/* Titre */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Titre du document *</label>
                  <input
                    required
                    placeholder="Ex: Politique de télétravail 2026"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className="border border-ink-100 rounded-xl px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs"
                  />
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Description</label>
                  <input
                    placeholder="Ex: Règles et démarches applicables aux collaborateurs"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="border border-ink-100 rounded-xl px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs"
                  />
                </div>

                {/* Visibilité & Département */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Niveau de visibilité</label>
                    <CustomSelect
                      id="modal-visibility"
                      value={form.visibility}
                      onChange={(v) => setForm((f) => ({ ...f, visibility: v as "company" | "department" | "restricted" }))}
                      options={[
                        { value: "company", label: "Entreprise" },
                        { value: "department", label: "Département" },
                        { value: "restricted", label: "Restreint (Admin)" },
                      ]}
                    />
                  </div>

                  {form.visibility === "department" ? (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Service concerné *</label>
                      <CustomSelect
                        id="modal-department"
                        required
                        value={form.departmentId}
                        onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                        options={[
                          { value: "", label: "Sélectionner un service" },
                          ...departments.map((dept) => ({ value: dept.id, label: dept.name })),
                        ]}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Date de révision</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                          <Calendar size={14} className="text-ink-400" />
                        </span>
                        <input
                          type="date"
                          value={form.reviewDate}
                          onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
                          className="w-full border border-ink-100 rounded-xl pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {form.visibility === "department" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-ink-600">Date de révision</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <Calendar size={14} className="text-ink-400" />
                      </span>
                      <input
                        type="date"
                        value={form.reviewDate}
                        onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
                        className="w-full border border-ink-100 rounded-xl pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-lime-400 shadow-2xs"
                      />
                    </div>
                  </div>
                )}

                {/* Erreur typée */}
                {error && (
                  <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 animate-in fade-in">
                    <AlertCircle size={16} className="shrink-0 text-red-500 mt-0.5" />
                    <p className="leading-relaxed">{error}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-3 border-t border-ink-50">
                  <button
                    type="button"
                    onClick={resetUploadModal}
                    className="flex-1 border border-ink-200 rounded-xl py-2.5 text-sm font-medium text-ink-700 hover:bg-paper-100 transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={!form.file || !form.title.trim()}
                    className="flex-1 bg-ink-950 hover:bg-ink-900 text-white rounded-xl py-2.5 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer"
                  >
                    Lancer l&apos;ingestion
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}