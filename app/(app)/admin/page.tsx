"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CircleDollarSign, ThumbsUp, ThumbsDown, ShieldAlert, Coins, ChevronDown, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";

interface ActivityRow {
  action: string;
  model: string | null;
  latency_ms: number | null;
  source_count: number;
  main_document_title: string | null;
  created_at: string;
}

interface OverdueDoc {
  id: string;
  version_id: string;
  title: string;
  review_date: string;
  owner_email: string;
  days_overdue: number;
}

interface Stats {
  companyName: string | null;
  totals: { total: number; answers: number; errors: number; total_tokens: number | null };
  estimatedCostUsd: number;
  feedback: { useful: number; not_useful: number };
  refusals: { question_length: number; created_at: string }[];
  recent: { rows: ActivityRow[]; page: number; hasNextPage: boolean };
  overdueDocuments: OverdueDoc[];
}

const USD_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// Compact "il y a X" phrasing for the recent-activity table — a raw
// timestamp on every row forces the reader to do the subtraction
// themselves; the full date is still available via the title attribute.
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  rag_answer: { label: "Réponse", color: "bg-green-100 text-green-700" },
  rag_refusal: { label: "Refus", color: "bg-amber-100 text-amber-700" },
  rag_error: { label: "Erreur", color: "bg-red-100 text-red-700" },
};

// "openai/gpt-oss-120b" -> "gpt-oss-120b" — the provider prefix is
// noise repeated on every row; the model name itself is what varies
// and what's worth scanning at a glance.
function shortModelName(model: string | null): string {
  if (!model) return "—";
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refusalsOpen, setRefusalsOpen] = useState(true);
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [activityPage, setActivityPage] = useState(1);
  // Separate from the initial full-page `loading` gate — paging
  // through activity shouldn't blank out the KPI cards that already
  // loaded, just show a brief disabled state on the table itself.
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    const isFirstLoad = activityPage === 1 && !stats;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isFirstLoad) setLoading(true);
    else setActivityLoading(true);

    fetch(`/api/admin/stats?page=${activityPage}`)
      .then((r) => r.ok ? r.json() : r.json().then((d: { error: string }) => Promise.reject(d.error)))
      .then(setStats)
      .catch((e: string) => setError(typeof e === "string" ? e : "Erreur"))
      .finally(() => {
        setLoading(false);
        setActivityLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityPage]);

  if (loading) return <div className="text-center text-ink-300 py-20">Chargement…</div>;
  if (error) return <div className="text-center text-red-500 py-20">{error}</div>;
  if (!stats) return null;

  const { companyName, totals, estimatedCostUsd, feedback, refusals, recent, overdueDocuments } = stats;
  const refusalRate = totals.total > 0 ? Math.round((refusals.length / totals.total) * 100) : 0;
  const feedbackTotal = feedback.useful + feedback.not_useful;
  const feedbackRate = feedbackTotal > 0 ? Math.round((feedback.useful / feedbackTotal) * 100) : null;

  const kpis = [
    {
      label: "Coût estimé",
      value: USD_FORMATTER.format(estimatedCostUsd),
      icon: CircleDollarSign,
      sub: "Tarifs Groq — gpt-oss-120b",
    },
    {
      label: "Feedback",
      value: (
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><ThumbsUp size={16} strokeWidth={2} />{feedback.useful.toLocaleString("fr-FR")}</span>
          <span className="inline-flex items-center gap-1"><ThumbsDown size={16} strokeWidth={2} />{feedback.not_useful.toLocaleString("fr-FR")}</span>
        </span>
      ),
      icon: ThumbsUp,
      sub: feedbackRate !== null ? `${feedbackRate}% positif` : "Aucun retour pour le moment",
    },
    {
      label: "Refus (no-source)",
      value: refusals.length.toLocaleString("fr-FR"),
      icon: ShieldAlert,
      sub: "Sans source — LLM jamais appelé",
    },
    {
      label: "Tokens consommés",
      value: totals.total_tokens != null ? Number(totals.total_tokens).toLocaleString("fr-FR") : "—",
      icon: Coins,
      sub: "Consommation LLM cumulée",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink-950 tracking-tight">Administration</h1>
        {companyName && (
          <p className="text-xs font-semibold tracking-wide text-ink-300 uppercase mt-1">
            Activité — {companyName}
          </p>
        )}
      </div>

      {/* KPI Cards — 1 col mobile → 2 sm → 4 lg */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-ink-100 p-5">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon size={15} className="text-lime-600" />
              <p className="text-xs text-ink-300 font-medium">{kpi.label}</p>
            </div>
            <p className="font-display text-2xl font-semibold text-ink-950">{kpi.value}</p>
            <p className="text-xs text-ink-300 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Questions sans résultat */}
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {refusals.length === 0 ? (
          <div className="px-5 py-4 flex items-center gap-2 text-sm text-ink-500">
            <CheckCircle2 size={16} className="text-lime-600" />
            Aucun refus — toutes les questions ont trouvé des sources autorisées.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setRefusalsOpen((v) => !v)}
              className="w-full px-5 py-4 border-b border-ink-100 flex items-center justify-between text-left"
            >
              <h2 className="font-medium text-ink-700">Questions sans résultat (refus récents)</h2>
              <span className="flex items-center gap-2 text-xs text-ink-300">
                {refusalRate}% de refus
                <ChevronDown
                  size={14}
                  className={`transition-transform ${refusalsOpen ? "rotate-180" : ""}`}
                />
              </span>
            </button>
            {refusalsOpen && (
              <ul className="divide-y divide-ink-100">
                {refusals.map((r, i) => (
                  <li key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                    <span className="text-ink-500">Question de {r.question_length.toLocaleString("fr-FR")} caractères</span>
                    <span className="text-xs text-ink-300" title={new Date(r.created_at).toLocaleString("fr-FR")}>
                      {relativeTime(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Documents — révision dépassée
          Pattern identique à la bannière refus : CheckCircle2 si vide,
          bouton dépliable avec AlertTriangle si ≥ 1 document.           */}
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {overdueDocuments.length === 0 ? (
          <div className="px-5 py-4 flex items-center gap-2 text-sm text-ink-500">
            <CheckCircle2 size={16} className="text-lime-600" />
            Aucun document dépassant sa date de révision.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOverdueOpen((v) => !v)}
              className="w-full px-5 py-4 border-b border-ink-100 flex items-center justify-between text-left"
            >
              <h2 className="font-medium text-amber-700 flex items-center gap-2">
                <AlertTriangle size={15} strokeWidth={2} className="text-amber-500 shrink-0" />
                {overdueDocuments.length.toLocaleString("fr-FR")} document{overdueDocuments.length > 1 ? "s" : ""} {overdueDocuments.length > 1 ? "dépassent" : "dépasse"} leur date de révision
              </h2>
              <ChevronDown
                size={14}
                className={`text-ink-300 transition-transform shrink-0 ${overdueOpen ? "rotate-180" : ""}`}
              />
            </button>
            {overdueOpen && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-paper-100 border-b border-ink-100">
                    <tr>
                      <th className="text-left px-5 py-3 font-medium text-ink-300">Titre</th>
                      <th className="text-left px-5 py-3 font-medium text-ink-300">Propriétaire</th>
                      <th className="text-left px-5 py-3 font-medium text-ink-300">Date de révision</th>
                      <th className="text-right px-5 py-3 font-medium text-ink-300">Retard (j.)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {overdueDocuments.map((doc) => (
                      <tr key={doc.id} className="hover:bg-paper-100">
                        <td className="px-5 py-3">
                          <a
                            href={`/documents/${doc.version_id}/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-ink-900 hover:text-lime-700 transition-colors"
                          >
                            {doc.title}
                          </a>
                        </td>
                        <td className="px-5 py-3 text-ink-500 text-xs">{doc.owner_email}</td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            {new Date(doc.review_date).toLocaleDateString("fr-FR")} · Révision dépassée
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-amber-700 text-xs">
                          {doc.days_overdue.toLocaleString("fr-FR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Link to dedicated view */}
            <div className="px-5 py-3 border-t border-ink-100 flex justify-end">
              <Link
                href="/admin/obsolete"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-lime-700 hover:text-lime-900 transition-colors"
              >
                Vue complète (dépassés + à venir) →
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Activité récente */}
      <div className={`bg-white rounded-2xl border border-ink-100 overflow-hidden ${activityLoading ? "opacity-60" : ""}`}>
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between gap-3">
          <h2 className="font-medium text-ink-700">Activité récente</h2>
          <span className="sm:hidden text-xs text-ink-300 italic shrink-0">← Faites glisser pour voir plus →</span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-paper-100 border-b border-ink-100">
            <tr>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Action</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Modèle</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Latence</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Document principal</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {recent.rows.map((r, i) => {
              const a = ACTION_LABELS[r.action] ?? { label: r.action, color: "bg-ink-100 text-ink-500" };
              return (
                <tr key={i} className="hover:bg-paper-100">
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.color}`}>{a.label}</span>
                  </td>
                  <td className="px-5 py-3 text-ink-500 text-xs">{shortModelName(r.model)}</td>
                  <td className={`px-5 py-3 text-xs ${r.latency_ms != null && r.latency_ms > 2000 ? "text-orange-600 font-medium" : "text-ink-500"}`}>
                    {r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-500 max-w-[220px] truncate" title={r.main_document_title ?? undefined}>
                    {r.main_document_title
                      ? `${r.main_document_title}${r.source_count > 1 ? ` (+${r.source_count - 1})` : ""}`
                      : "—"}
                  </td>
                  <td
                    className="px-5 py-3 text-ink-300 text-xs"
                    title={new Date(r.created_at).toLocaleString("fr-FR")}
                  >
                    {relativeTime(r.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="px-5 py-3 border-t border-ink-100 flex items-center justify-between">
          <button
            onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
            disabled={recent.page <= 1 || activityLoading}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 disabled:opacity-30 disabled:hover:text-ink-500 transition-colors"
          >
            <ChevronLeft size={14} strokeWidth={2} />
            Précédent
          </button>
          <span className="text-xs text-ink-300">Page {recent.page.toLocaleString("fr-FR")}</span>
          <button
            onClick={() => setActivityPage((p) => p + 1)}
            disabled={!recent.hasNextPage || activityLoading}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 disabled:opacity-30 disabled:hover:text-ink-500 transition-colors"
          >
            Suivant
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
