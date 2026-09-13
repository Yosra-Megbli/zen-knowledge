"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Clock, ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";

interface ObsoleteDoc {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  visibility: string;
  review_date: string;
  owner_email: string;
  department_name: string | null;
  days_overdue: number;
  status: "overdue" | "approaching";
}

interface ObsoleteData {
  overdue: ObsoleteDoc[];
  approaching: ObsoleteDoc[];
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

function daysLabel(days: number, status: "overdue" | "approaching"): string {
  if (status === "overdue") {
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return "1 jour de retard";
    return `${days} jours de retard`;
  }
  // approaching: days_overdue is negative (days from now until due date)
  const daysUntil = -days;
  if (daysUntil === 0) return "Aujourd'hui";
  if (daysUntil === 1) return "Demain";
  return `Dans ${daysUntil} jours`;
}

function DocCard({ doc, isOverdue }: { doc: ObsoleteDoc; isOverdue: boolean }) {
  const urgency = isOverdue
    ? doc.days_overdue >= 30
      ? "border-red-200 bg-red-50"
      : "border-amber-200 bg-amber-50"
    : "border-ink-100 bg-white";

  const daysBadge = isOverdue
    ? doc.days_overdue >= 30
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700"
    : "bg-sky-100 text-sky-700";

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${urgency}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink-950 truncate">{doc.title}</p>
          {doc.description && (
            <p className="text-xs text-ink-400 truncate mt-0.5">{doc.description}</p>
          )}
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${daysBadge}`}>
          {daysLabel(doc.days_overdue, doc.status)}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400 mb-3">
        <span>
          <span className="font-medium text-ink-700">Révision : </span>
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

      <div className="flex items-center gap-3 pt-2 border-t border-black/5">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VISIBILITY_COLORS[doc.visibility] ?? "bg-paper-100 text-ink-500"}`}>
          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
        </span>
        <a
          href={`/documents/${doc.version_id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-lime-700 hover:text-lime-900 transition-colors"
        >
          Aperçu <ExternalLink size={11} strokeWidth={2} />
        </a>
        <Link
          href={`/documents`}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-ink-700 transition-colors"
        >
          Bibliothèque <ExternalLink size={11} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}

export default function ObsoletePage() {
  const [data, setData] = useState<ObsoleteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
        setData(await res.json());
      }
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
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
              Documents publiés dont la date de révision est dépassée ou approche dans les{" "}
              {data?.approachingDays ?? 30} prochains jours.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-500 hover:text-lime-700 border border-ink-100 rounded-lg px-3 py-2 bg-white transition-colors disabled:opacity-40"
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
        <div className="text-center text-red-500 py-10">{error}</div>
      )}

      {!loading && data && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
            <div className="bg-white border border-sky-200 rounded-2xl col-span-2 sm:col-span-1 rounded-2xl p-4 text-center">
              <p className="text-3xl font-display font-bold text-sky-600">
                {data.approaching.length}
              </p>
              <p className="text-xs text-ink-400 mt-1 font-medium">
                À venir ({data.approachingDays} j.)
              </p>
            </div>
          </div>

          {/* Overdue section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
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
                  <DocCard key={doc.id} doc={doc} isOverdue />
                ))}
              </div>
            )}
          </section>

          {/* Approaching section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
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
                  <DocCard key={doc.id} doc={doc} isOverdue={false} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
