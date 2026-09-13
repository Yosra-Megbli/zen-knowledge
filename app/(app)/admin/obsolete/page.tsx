"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Clock,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Bell,
  Send,
  EyeOff,
  Eye,
  X,
  ShieldAlert,
} from "lucide-react";

export interface ObsoleteDoc {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  visibility: string;
  review_date: string;
  owner_email: string;
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
    ? "border-ink-100 bg-paper-50 opacity-90"
    : isOverdue
    ? doc.days_overdue >= 30
      ? "border-red-200 bg-red-50/40"
      : "border-amber-200 bg-amber-50/40"
    : "border-ink-100 bg-white";

  const daysBadge = isUnpublished
    ? "bg-ink-100 text-ink-600 border border-ink-200"
    : isOverdue
    ? doc.days_overdue >= 30
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700"
    : "bg-sky-100 text-sky-700";

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
          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold ${daysBadge}`}>
            {daysLabel(doc.days_overdue, doc.status)}
          </span>
        </div>

        {/* Metadata info */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-400 mb-3">
          <span>
            <span className="font-medium text-ink-700">Date d&apos;échéance : </span>
            {new Date(doc.review_date).toLocaleDateString("fr-FR")}
          </span>
          <span>
            <span className="font-medium text-ink-700">Propriétaire : </span>
            {doc.owner_email}
          </span>
          {doc.department_name && (
            <span>
              <span className="font-medium text-ink-700">Dép. : </span>
              {doc.department_name}
            </span>
          )}
        </div>

        {/* W3 Workflow state tracker badge */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pt-2 border-t border-black/5 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-100 text-ink-500"}`}>
            {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
          </span>

          {isUnpublished ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-zinc-100 text-zinc-700 border border-zinc-200">
              <EyeOff size={12} className="text-zinc-500" />
              Dépublié · Exclu du chat RAG
            </span>
          ) : (
            <>
              {isNotified ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <Bell size={12} className="text-amber-500" />
                  Notifié le {new Date(doc.rt_notified_at!).toLocaleDateString("fr-FR")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium bg-paper-100 text-ink-400 border border-ink-100">
                  En attente de notification
                </span>
              )}

              {reminderCount > 0 && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-medium ${
                    reminderCount >= 2
                      ? "bg-red-100 text-red-700 font-semibold border border-red-200"
                      : "bg-orange-50 text-orange-700 border border-orange-200"
                  }`}
                >
                  <Send size={11} />
                  Relances : {reminderCount}
                  {doc.rt_reminded_at && (
                    <span className="opacity-80 text-[11px]">
                      ({new Date(doc.rt_reminded_at).toLocaleDateString("fr-FR")})
                    </span>
                  )}
                </span>
              )}
            </>
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
            className="inline-flex items-center gap-1 text-xs font-medium text-lime-700 hover:text-lime-900 transition-colors"
          >
            Aperçu <ExternalLink size={11} strokeWidth={2} />
          </a>
          <Link
            href="/documents"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-ink-700 transition-colors"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-lime-700 hover:bg-lime-800 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Eye size={13} strokeWidth={2} />
              Republier
            </button>
          ) : (
            <>
              {!isNotified ? (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => onAction(doc, "notify")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Bell size={13} strokeWidth={2} className="text-amber-600" />
                  Notifier
                </button>
              ) : (
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => onAction(doc, "remind")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-900 bg-amber-100/70 hover:bg-amber-100 border border-amber-300 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send size={13} strokeWidth={2} className="text-amber-700" />
                  Relancer
                </button>
              )}

              <button
                type="button"
                disabled={acting}
                onClick={() => onAction(doc, "unpublish")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-white hover:bg-red-50 border border-red-200 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <EyeOff size={13} strokeWidth={2} />
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
        setData({
          overdue: json.overdue ?? [],
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
            className="text-ink-400 hover:text-ink-700 ml-2 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Confirmation Modal for Dépublier */}
      {unpublishModalDoc && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-ink-100 p-6 max-w-md w-full shadow-xl space-y-4">
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
                className="px-4 py-2 text-sm font-medium text-ink-600 hover:bg-paper-100 rounded-lg transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmUnpublish}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer shadow-xs"
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
          className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-lime-700 transition-colors mb-4"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Retour au tableau de bord
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold text-ink-950 tracking-tight">
              Documents à réviser
            </h1>
            <p className="text-xs text-ink-400 mt-1">
              Workflow W3 — Détection des documents obsolètes, notifications aux propriétaires et dépublication.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-500 hover:text-lime-700 border border-ink-100 rounded-lg px-3 py-2 bg-white transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw size={14} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center text-ink-300 py-20">Chargement…</div>
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
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-lime-700 hover:bg-lime-800 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw size={16} />
            Réessayer
          </button>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary strip — 4 counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-red-200 rounded-2xl p-4 text-center">
              <p className="text-3xl font-display font-bold text-red-600">
                {data.overdue.length}
              </p>
              <p className="text-xs text-ink-400 mt-1 font-medium">En retard</p>
            </div>
            <div className="bg-white border border-amber-200 rounded-2xl p-4 text-center">
              <p className="text-3xl font-display font-bold text-amber-600">
                {data.overdue.filter((d) => d.days_overdue >= 30).length}
              </p>
              <p className="text-xs text-ink-400 mt-1 font-medium">Retard ≥ 30 j.</p>
            </div>
            <div className="bg-white border border-sky-200 rounded-2xl p-4 text-center">
              <p className="text-3xl font-display font-bold text-sky-600">
                {data.approaching.length}
              </p>
              <p className="text-xs text-ink-400 mt-1 font-medium">
                À venir ({data.approachingDays} j.)
              </p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4 text-center">
              <p className="text-3xl font-display font-bold text-zinc-600">
                {data.unpublished.length}
              </p>
              <p className="text-xs text-ink-400 mt-1 font-medium">Dépubliés (W3)</p>
            </div>
          </div>

          {/* Overdue section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500 shrink-0" strokeWidth={2} />
              <h2 className="font-semibold text-ink-900 text-lg">
                Révision dépassée
              </h2>
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                {data.overdue.length}
              </span>
            </div>

            {data.overdue.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-ink-500 bg-white border border-ink-100 rounded-2xl px-5 py-4">
                <CheckCircle2 size={16} className="text-lime-600 shrink-0" />
                Aucun document en retard de révision.
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
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-sky-500 shrink-0" strokeWidth={2} />
              <h2 className="font-semibold text-ink-900 text-lg">
                Révision à venir
              </h2>
              <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-700">
                {data.approaching.length}
              </span>
              <span className="text-xs text-ink-400 ml-1">
                (dans les {data.approachingDays} prochains jours)
              </span>
            </div>

            {data.approaching.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-ink-500 bg-white border border-ink-100 rounded-2xl px-5 py-4">
                <CheckCircle2 size={16} className="text-lime-600 shrink-0" />
                Aucune révision à venir dans les {data.approachingDays} prochains jours.
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
          {data.unpublished.length > 0 && (
            <section className="space-y-3 pt-4 border-t border-ink-100">
              <div className="flex items-center gap-2">
                <EyeOff size={16} className="text-zinc-500 shrink-0" strokeWidth={2} />
                <h2 className="font-semibold text-ink-900 text-lg">
                  Documents dépubliés (W3)
                </h2>
                <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700">
                  {data.unpublished.length}
                </span>
                <span className="text-xs text-ink-400 ml-1">
                  (exclus du chat RAG · prêts à être republiés)
                </span>
              </div>

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
            </section>
          )}
        </>
      )}
    </div>
  );
}
