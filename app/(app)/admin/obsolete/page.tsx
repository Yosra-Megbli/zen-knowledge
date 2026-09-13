"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Check,
  Bell,
  Send,
  EyeOff,
  Eye,
  X,
  ShieldAlert,
  ShieldCheck,
  Flame,
  Loader2,
} from "lucide-react";

export interface ObsoleteDoc {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  visibility: string;
  review_date: string;
  owner_email: string;
  owner_name?: string | null;
  department_name: string | null;
  days_overdue: number;
  status: "overdue" | "approaching" | "unpublished";
  rt_id?: string | null;
  rt_status?: string | null;
  rt_notified_at?: string | null;
  rt_reminded_at?: string | null;
  reminder_count?: number;
}

interface ObsoleteData {
  overdue: ObsoleteDoc[];
  approaching: ObsoleteDoc[];
  unpublished: ObsoleteDoc[];
  approachingDays: number;
}

const VISIBILITY_LABELS: Record<string, string> = {
  company: "Entreprise",
  department: "Département",
  restricted: "Restreint",
};

const VISIBILITY_COLORS: Record<string, string> = {
  restricted: "bg-amber-50 text-amber-700 border border-amber-200",
  department: "bg-blue-50 text-blue-700 border border-blue-200",
  company: "bg-paper-100 text-ink-500 border border-ink-100",
};

function daysLabel(days: number, status: "overdue" | "approaching" | "unpublished"): string {
  if (status === "unpublished") {
    return "Dépublié";
  }
  if (status === "overdue") {
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return "1 jour de retard";
    return `${days} jours de retard`;
  }
  const daysUntil = -days;
  if (daysUntil === 0) return "Aujourd'hui";
  if (daysUntil === 1) return "Demain";
  return `Dans ${daysUntil} jours`;
}

function getOverdueBadgeClass(days: number, status: "overdue" | "approaching" | "unpublished"): string {
  if (status === "unpublished") {
    return "bg-zinc-100 text-zinc-700 border border-zinc-200 font-medium";
  }
  if (status === "approaching") {
    return "bg-sky-50 text-sky-700 border border-sky-200 font-medium";
  }
  // 3 visual urgency tiers
  if (days > 90) {
    return "bg-red-600 text-white font-semibold shadow-xs";
  }
  if (days >= 30) {
    return "bg-amber-500 text-white font-semibold shadow-xs";
  }
  return "bg-amber-100 text-amber-800 border border-amber-300 font-medium";
}

/* ── ÉTAPE 1 : Stepper W3 par carte ── */
function W3Stepper({ doc }: { doc: ObsoleteDoc }) {
  const isUnpublished = doc.status === "unpublished";
  const isNotified = Boolean(doc.rt_notified_at);
  const reminderCount = doc.reminder_count ?? (doc.rt_reminded_at ? 1 : 0);

  const steps = [
    {
      id: "detected",
      label: "Détecté",
      icon: AlertCircle,
      status: isNotified || reminderCount > 0 || isUnpublished ? "completed" : "current",
      tooltip: `Détecté en retard de révision depuis le ${new Date(doc.review_date).toLocaleDateString("fr-FR")}`,
      date: new Date(doc.review_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    },
    {
      id: "notified",
      label: "Notifié",
      icon: Bell,
      status: !isNotified
        ? "upcoming"
        : reminderCount > 0 || isUnpublished
        ? "completed"
        : "current",
      tooltip: isNotified
        ? `Notifié le ${new Date(doc.rt_notified_at!).toLocaleDateString("fr-FR")}`
        : "En attente de notification au propriétaire",
      date: isNotified
        ? new Date(doc.rt_notified_at!).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
        : null,
    },
    {
      id: "reminded",
      label: reminderCount > 0 ? `Relancé (${reminderCount}×)` : "Relancé",
      icon: Send,
      status: reminderCount === 0
        ? "upcoming"
        : isUnpublished
        ? "completed"
        : "current",
      tooltip: reminderCount > 0
        ? `Relancé ${reminderCount} fois${doc.rt_reminded_at ? ` (dernière le ${new Date(doc.rt_reminded_at).toLocaleDateString("fr-FR")})` : ""}`
        : "Aucune relance envoyée pour le moment",
      date: doc.rt_reminded_at
        ? new Date(doc.rt_reminded_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
        : null,
    },
    {
      id: "unpublished",
      label: "Dépublié",
      icon: EyeOff,
      status: isUnpublished ? "current" : "upcoming",
      tooltip: isUnpublished
        ? "Document dépublié : exclu de l'assistant de chat RAG"
        : "Dépublication si le document n'est pas révisé",
      date: null,
    },
  ];

  return (
    <div className="w-full bg-paper-50/80 rounded-xl p-2.5 border border-ink-100/70 mb-3">
      <div className="flex items-center justify-between relative">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isCompleted = step.status === "completed";
          const isCurrent = step.status === "current";

          return (
            <div
              key={step.id}
              className="flex-1 flex flex-col items-center relative group"
              title={step.tooltip}
            >
              {/* Connecting line */}
              {idx > 0 && (
                <div
                  className={`absolute top-3.5 -left-1/2 w-full h-0.5 -z-0 transition-colors duration-300 ${
                    isCompleted || isCurrent ? "bg-lime-500" : "bg-ink-200"
                  }`}
                />
              )}

              {/* Node bubble */}
              <div
                className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 shadow-xs ${
                  isCompleted
                    ? "bg-ink-950 text-lime-400 border border-ink-900"
                    : isCurrent
                    ? step.id === "unpublished"
                      ? "bg-zinc-700 text-white ring-2 ring-zinc-400 ring-offset-1"
                      : "bg-lime-400 text-ink-950 ring-2 ring-lime-400 ring-offset-1 font-bold"
                    : "bg-paper-200 text-ink-400 border border-ink-200"
                }`}
              >
                {isCompleted ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : (
                  <Icon size={12} strokeWidth={isCurrent ? 2.5 : 2} />
                )}
              </div>

              {/* Step label & date */}
              <div className="mt-1.5 text-center">
                <span
                  className={`block text-[11px] leading-tight transition-colors ${
                    isCompleted
                      ? "font-medium text-ink-900"
                      : isCurrent
                      ? "font-bold text-ink-950"
                      : "text-ink-400"
                  }`}
                >
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.label.slice(0, 3)}.</span>
                </span>
                {step.date && (
                  <span className="hidden sm:block text-[10px] text-ink-400 leading-none mt-0.5 font-mono">
                    {step.date}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocCard({
  doc,
  onAction,
  acting,
}: {
  doc: ObsoleteDoc;
  onAction: (doc: ObsoleteDoc, action: "notify" | "remind" | "unpublish" | "republish") => void;
  acting: boolean;
}) {
  const isUnpublished = doc.status === "unpublished";
  const isOverdue = doc.status === "overdue";

  const cardBorder = isUnpublished
    ? "border-ink-100 bg-paper-50 opacity-95"
    : isOverdue
    ? doc.days_overdue >= 90
      ? "border-red-300 bg-red-50/40"
      : doc.days_overdue >= 30
      ? "border-amber-300 bg-amber-50/40"
      : "border-ink-100 bg-white"
    : "border-ink-100 bg-white";

  const reminderCount = doc.reminder_count ?? (doc.rt_reminded_at ? 1 : 0);
  const isNotified = Boolean(doc.rt_notified_at);

  return (
    <div className={`rounded-2xl border p-5 transition-all shadow-xs flex flex-col justify-between ${cardBorder}`}>
      <div>
        {/* Title and main status badge */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-ink-950 text-base truncate" title={doc.title}>
              {doc.title}
            </h3>
            {doc.description && (
              <p className="text-xs text-ink-500 truncate mt-0.5">{doc.description}</p>
            )}
          </div>
          <span
            className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs ${getOverdueBadgeClass(
              doc.days_overdue,
              doc.status
            )}`}
          >
            {daysLabel(doc.days_overdue, doc.status)}
          </span>
        </div>

        {/* ÉTAPE 2 : Mini-barre de vieillissement (pour les documents en retard) */}
        {isOverdue && (
          <div
            className="w-full mt-1 mb-3"
            title={`Ancienneté de dépassement : ${doc.days_overdue} jours`}
          >
            <div className="flex items-center justify-between text-[11px] text-ink-400 mb-1">
              <span>Vieillissement du document</span>
              <span className="font-medium text-ink-600">{doc.days_overdue} j. / 90 j. max</span>
            </div>
            <div className="h-1.5 w-full bg-paper-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-lime-400 via-amber-400 to-red-500"
                style={{ width: `${Math.min(100, Math.max(8, Math.round((doc.days_overdue / 90) * 100)))}%` }}
              />
            </div>
          </div>
        )}

        {/* Metadata info */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500 mb-3">
          <span>
            <span className="font-medium text-ink-700">Date de révision : </span>
            {new Date(doc.review_date).toLocaleDateString("fr-FR")}
          </span>
          <span>
            <span className="font-medium text-ink-700">Propriétaire : </span>
            {doc.owner_name || doc.owner_email}
          </span>
          {doc.department_name && (
            <span>
              <span className="font-medium text-ink-700">Dép. : </span>
              {doc.department_name}
            </span>
          )}
        </div>

        {/* ÉTAPE 1 : Stepper W3 par carte (affiché sur overdue et unpublished) */}
        {(isOverdue || isUnpublished) && <W3Stepper doc={doc} />}

        {/* ÉTAPE 3 : Traçabilité visible */}
        {isNotified && !isUnpublished && (
          <div className="flex items-center gap-1.5 text-xs text-ink-500 mb-3 bg-paper-50 px-2.5 py-1.5 rounded-lg border border-ink-100/60">
            <Clock size={13} className="text-ink-400 shrink-0" />
            <span>
              Notifié le {new Date(doc.rt_notified_at!).toLocaleDateString("fr-FR")}
              {reminderCount > 0 && (
                <>
                  {" · "}
                  <strong className="text-ink-800 font-medium">
                    {reminderCount} relance{reminderCount > 1 ? "s" : ""}
                  </strong>
                  {doc.rt_reminded_at && (
                    <span className="text-ink-400">
                      {" "}
                      (dernière le {new Date(doc.rt_reminded_at).toLocaleDateString("fr-FR")})
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        )}

        {/* Visibilité & Badge Dépublié */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pt-2 border-t border-black/5 text-xs">
          <span
            className={`px-2 py-0.5 rounded-full font-medium ${
              VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-100 text-ink-500"
            }`}
          >
            {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
          </span>

          {isUnpublished && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
              <EyeOff size={12} className="text-zinc-500" />
              Exclu du RAG · Réversible
            </span>
          )}
        </div>
      </div>

      {/* Actions footer */}
      <div className="pt-3 border-t border-black/5 flex flex-wrap items-center justify-between gap-2">
        {/* Document links */}
        <div className="flex items-center gap-3">
          <a
            href={`/documents/${doc.version_id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-lime-700 hover:text-lime-900 transition-colors focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none rounded"
          >
            Aperçu <ExternalLink size={11} strokeWidth={2} />
          </a>
          <Link
            href="/documents"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-ink-700 transition-colors focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none rounded"
          >
            Bibliothèque <ExternalLink size={11} strokeWidth={2} />
          </Link>
        </div>

        {/* W3 Action buttons */}
        <div className="flex items-center gap-2">
          {isUnpublished ? (
            <button
              type="button"
              disabled={acting}
              onClick={() => onAction(doc, "republish")}
              title="Réintègre le document dans l'assistant RAG"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-lime-700 hover:bg-lime-800 transition-colors disabled:opacity-50 cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
            >
              {acting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Eye size={13} strokeWidth={2} />
              )}
              Republier
            </button>
          ) : (
            <>
              {!isNotified ? (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => onAction(doc, "notify")}
                  title="Crée une tâche pour le propriétaire"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 transition-colors disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
                >
                  {acting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Bell size={13} strokeWidth={2} className="text-amber-600" />
                  )}
                  Notifier
                </button>
              ) : (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => onAction(doc, "remind")}
                  title="Envoie une relance au propriétaire du document"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-900 bg-amber-100/70 hover:bg-amber-100 border border-amber-300 transition-colors disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
                >
                  {acting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} strokeWidth={2} className="text-amber-700" />
                  )}
                  Relancer
                </button>
              )}

              <button
                type="button"
                disabled={acting}
                onClick={() => onAction(doc, "unpublish")}
                title="Exclut immédiatement le document de la recherche — réversible"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-white hover:bg-red-50 border border-red-200 transition-colors disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
              >
                {acting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <EyeOff size={13} strokeWidth={2} />
                )}
                Dépublier
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ObsoletePage() {
  const [data, setData] = useState<ObsoleteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actingDocId, setActingDocId] = useState<string | null>(null);
  const [unpublishModalDoc, setUnpublishModalDoc] = useState<ObsoleteDoc | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function load(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/obsolete");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}) as { error?: string });
        setError(d.error ?? "Erreur lors du chargement.");
      } else {
        const json = await res.json();
        // ÉTAPE 2 : Tri par retard décroissant (les plus en retard en premier)
        const overdueSorted = (json.overdue ?? []).sort(
          (a: ObsoleteDoc, b: ObsoleteDoc) => b.days_overdue - a.days_overdue
        );
        setData({
          overdue: overdueSorted,
          approaching: json.approaching ?? [],
          unpublished: json.unpublished ?? [],
          approachingDays: json.approachingDays ?? 30,
        });
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  // ÉTAPE 5 : Gestion Escape pour fermer la modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setUnpublishModalDoc(null);
      }
    }
    if (unpublishModalDoc) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [unpublishModalDoc]);

  async function executeAction(
    doc: ObsoleteDoc,
    action: "notify" | "remind" | "unpublish" | "republish"
  ) {
    if (action === "unpublish") {
      setUnpublishModalDoc(doc);
      return;
    }

    setActingDocId(doc.id);
    try {
      const res = await fetch("/api/admin/obsolete/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, action }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Échec de l'action", "error");
      } else {
        if (action === "notify") {
          showToast(`Tâche créée : notification envoyée à ${doc.owner_email}`);
        } else if (action === "remind") {
          showToast(`Relance envoyée avec succès à ${doc.owner_email}`);
        } else if (action === "republish") {
          showToast(`« ${doc.title} » republié avec succès (accessible au chat)`);
        }
        await load(true);
      }
    } catch {
      showToast("Erreur lors de l'exécution de l'action", "error");
    } finally {
      setActingDocId(null);
    }
  }

  async function confirmUnpublish() {
    if (!unpublishModalDoc) return;
    const doc = unpublishModalDoc;
    setUnpublishModalDoc(null);
    setActingDocId(doc.id);
    try {
      const res = await fetch("/api/admin/obsolete/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, action: "unpublish" }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Échec de la dépublication", "error");
      } else {
        showToast(`« ${doc.title} » dépublié (exclu du chat RAG)`);
        await load(true);
      }
    } catch {
      showToast("Erreur lors de la dépublication", "error");
    } finally {
      setActingDocId(null);
    }
  }

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const overdueCount = data?.overdue.length ?? 0;
  const criticalCount = data?.overdue.filter((d) => d.days_overdue >= 30).length ?? 0;
  const maxDays = overdueCount > 0 ? Math.max(...(data?.overdue.map((d) => d.days_overdue) ?? [0])) : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Floating Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium transition-all animate-in fade-in slide-in-from-top-3 ${
            toast.type === "success"
              ? "bg-white border-lime-300 text-ink-900 shadow-lime-900/10"
              : "bg-white border-red-300 text-red-700 shadow-red-900/10"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={17} className="text-lime-600 shrink-0" />
          ) : (
            <AlertTriangle size={17} className="text-red-600 shrink-0" />
          )}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="text-ink-400 hover:text-ink-700 ml-2 cursor-pointer focus:outline-none"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Confirmation Modal for Dépublier (avec Escape et clic extérieur) */}
      {unpublishModalDoc && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setUnpublishModalDoc(null)}
        >
          <div
            className="bg-white rounded-2xl border border-ink-100 p-6 max-w-md w-full shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h3 className="text-base font-bold text-ink-950">
                Confirmer la dépublication
              </h3>
              <p className="text-sm text-ink-500 mt-2 leading-relaxed">
                Le document <span className="font-semibold text-ink-900">« {unpublishModalDoc.title} »</span> sera immédiatement retiré de l&apos;assistant de chat et ne pourra plus être cité dans les réponses RAG.
              </p>
              <p className="text-xs text-ink-400 mt-2">
                Ses versions et métadonnées restent intactes en base de données, et vous pourrez le republier à tout moment.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-ink-100">
              <button
                type="button"
                onClick={() => setUnpublishModalDoc(null)}
                className="px-4 py-2 text-sm font-medium text-ink-600 hover:bg-paper-100 rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmUnpublish}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer shadow-xs focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
              >
                Dépublier le document
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-lime-700 transition-colors mb-4 focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none rounded"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Retour au tableau de bord
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold text-ink-950 tracking-tight">
              Documents à réviser
            </h1>
            {/* ÉTAPE 4 : Phrase de synthèse dynamique */}
            <p className="text-sm text-ink-500 mt-1">
              {loading ? (
                "Vérification des cycles de révision en cours…"
              ) : overdueCount > 0 ? (
                `${overdueCount} document${overdueCount > 1 ? "s" : ""} nécessite${
                  overdueCount > 1 ? "nt" : ""
                } une action — ${maxDays} jours de retard maximum.`
              ) : (
                "Tous les documents sont à jour — aucune action urgente requise."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            title="Rafraîchir les données d'obsolescence"
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-lime-800 border border-ink-100 rounded-lg px-3.5 py-2 bg-white hover:bg-paper-50 transition-colors disabled:opacity-40 cursor-pointer shadow-2xs focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
          >
            <RefreshCw size={14} strokeWidth={2} className={refreshing ? "animate-spin text-lime-700" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {/* ÉTAPE 5 : Skeletons au chargement initial */}
      {loading && (
        <div className="space-y-8 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white border border-ink-100 rounded-2xl p-4 space-y-3">
                <div className="w-8 h-8 rounded-xl bg-paper-200" />
                <div className="h-8 bg-paper-200 rounded w-1/2" />
                <div className="h-3 bg-paper-200 rounded w-3/4" />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="h-6 bg-paper-200 rounded w-48" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white border border-ink-100 rounded-2xl p-5 space-y-4">
                  <div className="flex justify-between">
                    <div className="h-5 bg-paper-200 rounded w-2/3" />
                    <div className="h-5 bg-paper-200 rounded w-20" />
                  </div>
                  <div className="h-12 bg-paper-100 rounded-xl" />
                  <div className="h-4 bg-paper-200 rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-white border border-red-200 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} />
          </div>
          <h3 className="text-base font-semibold text-ink-900 mb-1">Impossible de charger les documents</h3>
          <p className="text-sm text-ink-500 mb-6">{error}</p>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-lime-700 hover:bg-lime-800 rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
          >
            <RefreshCw size={16} />
            Réessayer
          </button>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ÉTAPE 4 : Summary strip — 4 cartes KPI cliquables avec pastilles sémantiques */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* KPI 1 : En retard */}
            <button
              type="button"
              onClick={() => scrollToSection("section-overdue")}
              className="bg-white border border-red-200 hover:border-red-300 rounded-2xl p-4 text-left transition-all hover:shadow-sm cursor-pointer group focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <AlertTriangle size={16} />
                </span>
                <span className="text-[11px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  Action requise
                </span>
              </div>
              <p className="text-3xl font-display font-bold text-red-600">
                {data.overdue.length}
              </p>
              <p className="text-xs text-ink-500 mt-1 font-medium">En retard</p>
            </button>

            {/* KPI 2 : dont retard ≥ 30 j */}
            <button
              type="button"
              onClick={() => scrollToSection("section-overdue")}
              className="bg-white border border-amber-200 hover:border-amber-300 rounded-2xl p-4 text-left transition-all hover:shadow-sm cursor-pointer group focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Flame size={16} />
                </span>
                <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  Urgence
                </span>
              </div>
              <p className="text-3xl font-display font-bold text-amber-600">
                {criticalCount}
              </p>
              <p className="text-xs text-ink-500 mt-1 font-medium">dont retard ≥ 30 j.</p>
            </button>

            {/* KPI 3 : À venir */}
            <button
              type="button"
              onClick={() => scrollToSection("section-approaching")}
              className="bg-white border border-sky-200 hover:border-sky-300 rounded-2xl p-4 text-left transition-all hover:shadow-sm cursor-pointer group focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Clock size={16} />
                </span>
                <span className="text-[11px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                  À surveiller
                </span>
              </div>
              <p className="text-3xl font-display font-bold text-sky-600">
                {data.approaching.length}
              </p>
              <p className="text-xs text-ink-500 mt-1 font-medium">
                À venir ({data.approachingDays} j.)
              </p>
            </button>

            {/* KPI 4 : Dépubliés */}
            <button
              type="button"
              onClick={() => scrollToSection("section-unpublished")}
              className="bg-white border border-zinc-200 hover:border-zinc-300 rounded-2xl p-4 text-left transition-all hover:shadow-sm cursor-pointer group focus-visible:ring-2 focus-visible:ring-lime-400 focus:outline-none"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <EyeOff size={16} />
                </span>
                <span className="text-[11px] font-medium text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-full">
                  Exclus du chat
                </span>
              </div>
              <p className="text-3xl font-display font-bold text-zinc-600">
                {data.unpublished.length}
              </p>
              <p className="text-xs text-ink-500 mt-1 font-medium">Dépubliés</p>
            </button>
          </div>

          {/* Overdue section */}
          <section id="section-overdue" className="space-y-4 scroll-mt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle size={17} className="text-amber-500 shrink-0" strokeWidth={2} />
              <h2 className="font-semibold text-ink-900 text-lg">
                Révision dépassée
              </h2>
              <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                {data.overdue.length}
              </span>
            </div>

            {data.overdue.length === 0 ? (
              /* ÉTAPE 5 : État vide Révision dépassée soigné */
              <div className="bg-white border border-ink-100 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-2">
                <div className="w-12 h-12 rounded-full bg-lime-50 text-lime-600 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 size={24} />
                </div>
                <h3 className="font-semibold text-ink-900 text-base">Aucun document en retard</h3>
                <p className="text-xs text-ink-500 leading-relaxed">
                  Tous les documents de votre organisation sont conformes à leur cycle de validité.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.overdue.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    onAction={executeAction}
                    acting={actingDocId === doc.id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Approaching section */}
          <section id="section-approaching" className="space-y-4 scroll-mt-6">
            <div className="flex items-center gap-2">
              <Clock size={17} className="text-sky-500 shrink-0" strokeWidth={2} />
              <h2 className="font-semibold text-ink-900 text-lg">
                Révision à venir
              </h2>
              <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800">
                {data.approaching.length}
              </span>
              <span className="text-xs text-ink-400 ml-1">
                (dans les {data.approachingDays} prochains jours)
              </span>
            </div>

            {data.approaching.length === 0 ? (
              /* ÉTAPE 5 : État vide À venir soigné */
              <div className="flex items-center gap-2.5 text-sm text-ink-600 bg-white border border-ink-100 rounded-2xl px-5 py-4 shadow-2xs">
                <CheckCircle2 size={17} className="text-lime-600 shrink-0" />
                <span>Aucune révision dans les {data.approachingDays} prochains jours — tout est à jour.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.approaching.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    onAction={executeAction}
                    acting={actingDocId === doc.id}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Unpublished section */}
          <section id="section-unpublished" className="space-y-4 scroll-mt-6 pt-4 border-t border-ink-100">
            <div className="flex items-center gap-2">
              <EyeOff size={17} className="text-zinc-500 shrink-0" strokeWidth={2} />
              <h2 className="font-semibold text-ink-900 text-lg">
                Documents dépubliés
              </h2>
              <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700">
                {data.unpublished.length}
              </span>
              <span className="text-xs text-ink-400 ml-1">
                (exclus du chat RAG · réversibles à tout moment)
              </span>
            </div>

            {data.unpublished.length === 0 ? (
              /* ÉTAPE 5 : État vide Dépubliés soigné */
              <div className="flex items-center gap-2.5 text-sm text-ink-600 bg-white border border-ink-100 rounded-2xl px-5 py-4 shadow-2xs">
                <ShieldCheck size={17} className="text-lime-600 shrink-0" />
                <span>Aucun document dépublié — le catalogue est 100% accessible dans le chat.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.unpublished.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    onAction={executeAction}
                    acting={actingDocId === doc.id}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
