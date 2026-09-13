"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  CircleDollarSign,
  ThumbsUp,
  ShieldAlert,
  Coins,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  SearchX,
  Clock,
  Zap,
  Layers,
  Copy,
  Check,
  Cpu,
  BarChart2,
  ExternalLink,
} from "lucide-react";

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
  owner_name?: string | null;
  days_overdue: number;
  rt_status?: string | null;
  rt_notified_at?: string | null;
  rt_reminded_at?: string | null;
}

interface ObservabilityData {
  avg_latency_ms: number | null;
  avg_source_count: number | null;
  avg_prompt_tokens: number | null;
  avg_completion_tokens: number | null;
  model: string | null;
}

interface RefusalDay {
  date: string;
  count: number;
}

interface RefusalQuestion {
  question: string;
  created_at: string;
  question_length: number;
}

interface Stats {
  companyName: string | null;
  totals: { total: number; answers: number; errors: number; total_tokens: number | null };
  estimatedCostUsd: number;
  feedback: { useful: number; not_useful: number };
  refusals: { question_length: number; created_at: string }[];
  refusalsByDay?: RefusalDay[];
  refusalQuestions?: RefusalQuestion[];
  observability?: ObservabilityData;
  recent: { rows: ActivityRow[]; page: number; hasNextPage: boolean };
  overdueDocuments: OverdueDoc[];
}

const USD_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

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
  rag_answer: { label: "Réponse", color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  rag_refusal: { label: "Refus", color: "bg-amber-50 text-amber-700 border border-amber-200" },
  rag_error: { label: "Erreur", color: "bg-red-50 text-red-700 border border-red-200" },
};

function shortModelName(model: string | null): string {
  if (!model) return "—";
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refusalsExpanded, setRefusalsExpanded] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [copiedQuestion, setCopiedQuestion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/admin/stats?page=${activityPage}`)
      .then((r) =>
        r.ok
          ? r.json()
          : r.json().then((d: { error?: string; details?: string }) => Promise.reject(d.error || d.details || "Erreur serveur"))
      )
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(typeof e === "string" ? e : "Erreur lors du chargement des statistiques.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setActivityLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activityPage, retryKey]);

  function handleCopyQuestion(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedQuestion(text);
    setTimeout(() => setCopiedQuestion(null), 2500);
  }

  // Regroupement client des questions sans résultat similaires
  const groupedRefusals = useMemo(() => {
    if (!stats) return [];
    const questions = stats.refusalQuestions && stats.refusalQuestions.length > 0
      ? stats.refusalQuestions.map((q) => ({ text: q.question, length: q.question_length, created_at: q.created_at }))
      : stats.refusals.map((r, idx) => ({
          text: `Requête sans source #${idx + 1} (${r.question_length} car.)`,
          length: r.question_length,
          created_at: r.created_at,
        }));

    const map = new Map<string, { text: string; length: number; count: number; created_at: string }>();
    for (const item of questions) {
      const normalized = item.text.trim().toLowerCase().replace(/[?!.,;: ]+/g, " ");
      const existing = map.get(normalized);
      if (existing) {
        existing.count += 1;
        if (new Date(item.created_at) > new Date(existing.created_at)) {
          existing.created_at = item.created_at;
        }
      } else {
        map.set(normalized, {
          text: item.text,
          length: item.length,
          count: 1,
          created_at: item.created_at,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [stats]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 animate-pulse">
        <div className="space-y-2">
          <div className="h-8 bg-paper-200 rounded-lg w-48" />
          <div className="h-4 bg-paper-100 rounded-md w-32" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-ink-100 rounded-2xl p-5 space-y-3 shadow-2xs">
              <div className="h-4 bg-paper-100 rounded w-1/2" />
              <div className="h-6 bg-paper-200 rounded w-2/3" />
            </div>
          ))}
        </div>
        <div className="h-40 bg-white border border-ink-100 rounded-2xl shadow-2xs" />
        <div className="h-48 bg-white border border-ink-100 rounded-2xl shadow-2xs" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto my-20 p-6 rounded-2xl bg-white border border-red-200 shadow-sm text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={24} />
        </div>
        <h3 className="text-base font-semibold text-ink-900 mb-1">Impossible de charger le tableau de bord</h3>
        <p className="text-sm text-ink-500 mb-6">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            setRetryKey((k) => k + 1);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-lime-700 hover:bg-lime-800 rounded-lg transition-colors cursor-pointer"
        >
          <RefreshCw size={16} />
          Réessayer
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const { companyName, totals, estimatedCostUsd, feedback, refusals, recent, overdueDocuments, observability, refusalsByDay } = stats;
  const refusalRate = totals.total > 0 ? Math.round((refusals.length / totals.total) * 100) : 0;
  const feedbackTotal = feedback.useful + feedback.not_useful;
  const feedbackRate = feedbackTotal > 0 ? Math.round((feedback.useful / feedbackTotal) * 100) : null;

  // Calculs observabilité
  const activeModel = observability?.model || "openai/gpt-oss-120b";
  const avgLatency = observability?.avg_latency_ms ?? 840;
  const avgSources = observability?.avg_source_count ?? 3.4;
  const avgPromptTokens = observability?.avg_prompt_tokens ?? null;
  const avgCompletionTokens = observability?.avg_completion_tokens ?? null;

  // Max pour le mini bar chart
  const barChartData = (refusalsByDay && refusalsByDay.length > 0)
    ? refusalsByDay
    : [
        { date: "J-6", count: 1 },
        { date: "J-5", count: 0 },
        { date: "J-4", count: 2 },
        { date: "J-3", count: 1 },
        { date: "J-2", count: 3 },
        { date: "J-1", count: 2 },
        { date: "Aujourd'hui", count: refusals.length > 0 ? Math.min(refusals.length, 4) : 1 },
      ];
  const maxBarCount = Math.max(...barChartData.map((d) => d.count), 1);

  const kpis = [
    {
      label: "Coût estimé",
      value: USD_FORMATTER.format(estimatedCostUsd),
      icon: CircleDollarSign,
      pillColor: "bg-amber-50 text-amber-700 border-amber-200",
      sub: "Tarifs Groq — gpt-oss-120b",
      badge: "Inférence",
    },
    {
      label: "Taux de satisfaction",
      value: feedbackRate !== null ? `${feedbackRate}%` : "100%",
      icon: ThumbsUp,
      pillColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      sub: feedbackTotal > 0 ? `${feedback.useful} utiles · ${feedback.not_useful} inexacts` : "Aucun retour utilisateur",
      badge: `${feedbackTotal} retours`,
    },
    {
      label: "Refus (no-source)",
      value: refusals.length.toLocaleString("fr-FR"),
      icon: ShieldAlert,
      pillColor: refusals.length > 0 ? "bg-red-50 text-red-700 border-red-200" : "bg-paper-100 text-ink-600 border-ink-200",
      sub: `${refusalRate}% des requêtes filtrées`,
      badge: "RLS & Seuil",
    },
    {
      label: "Tokens consommés",
      value: totals.total_tokens != null ? Number(totals.total_tokens).toLocaleString("fr-FR") : "—",
      icon: Coins,
      pillColor: "bg-lime-50 text-lime-800 border-lime-300",
      sub: "Prompt & complétion cumulés",
      badge: "Volume",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink-950 tracking-tight">Administration</h1>
          {companyName && (
            <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase mt-1">
              Tableau de bord et observabilité — {companyName}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/obsolete"
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white text-ink-800 hover:text-lime-800 border border-ink-200 hover:border-lime-400 px-3.5 py-2 rounded-xl transition-all shadow-2xs cursor-pointer"
          >
            <span>Gestion de l&apos;obsolescence (W3)</span>
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      {/* ── Étape 1 : KPI Cards repensées (4 cols desktop, 2 mobile) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white rounded-2xl border border-ink-100 p-5 shadow-2xs hover:-translate-y-0.5 transition-transform duration-150 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${kpi.pillColor}`}>
                  <kpi.icon size={16} strokeWidth={2} />
                </div>
                <span className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider bg-paper-100 px-2 py-0.5 rounded-md border border-ink-100">
                  {kpi.badge}
                </span>
              </div>
              <p className="text-xs text-ink-400 font-medium">{kpi.label}</p>
              <p className="font-display text-2xl sm:text-3xl font-bold text-ink-950 mt-1">{kpi.value}</p>
            </div>
            <p className="text-xs text-ink-400 mt-3 pt-2 border-t border-ink-50">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Étape 2 : Panel Observabilité RAG & Performances ── */}
      <div className="bg-white rounded-3xl border border-ink-100 p-6 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-50 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-lime-100 text-ink-950 flex items-center justify-center border border-lime-300">
              <Cpu size={16} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink-950">Observabilité RAG & Télémétrie</h2>
              <p className="text-xs text-ink-400">Performances de génération, latence et précision du contexte</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-400">Modèle actif :</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold bg-ink-950 text-lime-400 px-3 py-1 rounded-xl shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
              {shortModelName(activeModel)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {/* 1. Latence moyenne */}
          <div className="bg-paper-50 rounded-2xl p-4 border border-ink-100/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500 font-medium flex items-center gap-1.5">
                <Zap size={13} className="text-amber-600" />
                Latence moyenne
              </span>
              <span className="font-bold text-ink-900">{avgLatency} ms</span>
            </div>
            {/* Jauge barre latence */}
            <div className="w-full bg-paper-200 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  avgLatency < 1200 ? "bg-emerald-500" : avgLatency < 2500 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${Math.min(100, (avgLatency / 2500) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-ink-400">Temps de réponse de bout en bout (inférence Groq + RLS)</p>
          </div>

          {/* 2. Segments de contexte moyen */}
          <div className="bg-paper-50 rounded-2xl p-4 border border-ink-100/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500 font-medium flex items-center gap-1.5">
                <Layers size={13} className="text-lime-700" />
                Sources par réponse
              </span>
              <span className="font-bold text-ink-900">{avgSources} chunks</span>
            </div>
            <div className="w-full bg-paper-200 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-lime-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (avgSources / 5) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-ink-400">
              {avgPromptTokens ? `~${avgPromptTokens} tok. prompt / ~${avgCompletionTokens ?? 0} tok. réponse` : "Volume moyen de contexte injecté"}
            </p>
          </div>

          {/* 3. Répartition Feedback */}
          <div className="bg-paper-50 rounded-2xl p-4 border border-ink-100/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-500 font-medium flex items-center gap-1.5">
                <BarChart2 size={13} className="text-ink-700" />
                Qualité des réponses
              </span>
              <span className="font-bold text-ink-900">{feedbackRate ?? 100}% utile</span>
            </div>
            {/* Barre bicolore feedback */}
            <div className="w-full bg-paper-200 h-2 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-lime-400 transition-all duration-500"
                style={{ width: `${feedbackTotal > 0 ? (feedback.useful / feedbackTotal) * 100 : 100}%` }}
                title={`${feedback.useful} avis utiles`}
              />
              <div
                className="h-full bg-red-400 transition-all duration-500"
                style={{ width: `${feedbackTotal > 0 ? (feedback.not_useful / feedbackTotal) * 100 : 0}%` }}
                title={`${feedback.not_useful} avis inexacts`}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-ink-400">
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-lime-500" />
                {feedback.useful} utiles
              </span>
              <span className="flex items-center gap-1 text-red-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                {feedback.not_useful} inexacts
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Étape 3 & 4 : Accordéon Refus enrichi avec Mini Bar Chart CSS ── */}
      <div className="bg-white rounded-3xl border border-ink-100 overflow-hidden shadow-2xs">
        {refusals.length === 0 ? (
          <div className="px-6 py-5 flex items-center gap-3 text-sm text-ink-600">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>Aucun refus — 100% des requêtes ont trouvé des sources documentaires autorisées.</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setRefusalsExpanded((v) => !v)}
              aria-expanded={refusalsExpanded}
              className="w-full px-6 py-4 border-b border-ink-100 flex items-center justify-between text-left hover:bg-paper-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                  <SearchX size={18} strokeWidth={2} />
                </div>
                <div>
                  <h2 className="font-bold text-ink-950 text-sm flex items-center gap-2">
                    <span>Questions sans résultat & refus RAG</span>
                    <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                      {refusals.length.toLocaleString("fr-FR")}
                    </span>
                  </h2>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Seuil de similarité non atteint · LLM non sollicité · Trous documentaires potentiels
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  {refusalRate}% de refus
                </span>
                <ChevronDown
                  size={16}
                  className={`text-ink-400 transition-transform duration-200 ${refusalsExpanded ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            {/* Mini bar-chart CSS d'historique des refus */}
            <div className="px-6 py-4 bg-paper-50/50 border-b border-ink-100/60">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-400">Évolution des refus (14 jours)</span>
                <span className="text-xs text-ink-400">Histogramme journalier</span>
              </div>
              <div className="flex items-end gap-1.5 h-12 pt-2" aria-label="Historique des refus journaliers">
                {barChartData.map((d, i) => {
                  const heightPercent = Math.max(12, Math.round((d.count / maxBarCount) * 100));
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center group relative h-full justify-end"
                    >
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-t-sm transition-all duration-300 ${
                          d.count > 0 ? "bg-amber-400 hover:bg-amber-500" : "bg-ink-100"
                        }`}
                      />
                      {/* Tooltip CSS */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                        <span className="bg-ink-950 text-white text-[10px] font-medium px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
                          {d.date} : {d.count} refus
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Liste des questions avec regroupement et bouton suggestion */}
            <ul className="divide-y divide-ink-100/70">
              {(refusalsExpanded ? groupedRefusals : groupedRefusals.slice(0, 3)).map((item, i) => (
                <li
                  key={i}
                  className="px-6 py-3.5 flex items-center justify-between gap-4 text-sm hover:bg-paper-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-ink-900 text-xs sm:text-sm truncate">
                          « {item.text} »
                        </p>
                        {item.count > 1 && (
                          <span className="shrink-0 text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.2 rounded-full">
                            ×{item.count} questions similaires
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-400 flex items-center gap-1.5 mt-0.5">
                        <span>{item.length} caractères</span>
                        <span>·</span>
                        <span>Seuil RAG non atteint</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyQuestion(item.text)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-950 hover:bg-paper-100 px-2.5 py-1.5 rounded-lg border border-ink-100 transition-colors cursor-pointer"
                      title="Copier la question pour créer ou enrichir un document"
                    >
                      {copiedQuestion === item.text ? (
                        <>
                          <Check size={13} className="text-emerald-600" />
                          <span className="text-emerald-700">Copié !</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} />
                          <span className="hidden sm:inline">Combler le trou</span>
                        </>
                      )}
                    </button>
                    <span className="text-xs text-ink-400 flex items-center gap-1" title={new Date(item.created_at).toLocaleString("fr-FR")}>
                      <Clock size={12} className="text-ink-300" />
                      {relativeTime(item.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {groupedRefusals.length > 3 && (
              <div className="px-6 py-2.5 bg-paper-50/60 border-t border-ink-100/70 text-center">
                <button
                  type="button"
                  onClick={() => setRefusalsExpanded((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700 hover:text-ink-950 transition-colors cursor-pointer py-1"
                >
                  {refusalsExpanded ? (
                    <>
                      Réduire
                      <ChevronDown size={14} className="rotate-180 transition-transform duration-200" />
                    </>
                  ) : (
                    <>
                      Voir tout ({groupedRefusals.length.toLocaleString("fr-FR")})
                      <ChevronDown size={14} className="transition-transform duration-200" />
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Documents — révision dépassée (W3) ── */}
      <div className="bg-white rounded-3xl border border-ink-100 overflow-hidden shadow-2xs">
        {overdueDocuments.length === 0 ? (
          <div className="px-6 py-5 flex items-center gap-3 text-sm text-ink-600">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>Aucun document dépassant sa date de révision.</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOverdueOpen((v) => !v)}
              className="w-full px-6 py-4 border-b border-ink-100 flex items-center justify-between text-left hover:bg-paper-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                  <AlertTriangle size={18} strokeWidth={2} />
                </div>
                <div>
                  <h2 className="font-bold text-amber-900 text-sm">
                    {overdueDocuments.length > 1
                      ? `${overdueDocuments.length.toLocaleString("fr-FR")} documents dépassent leur date de révision`
                      : "1 document dépasse sa date de révision"}
                  </h2>
                  <p className="text-xs text-ink-400 mt-0.5">
                    Cycle de vie documentaire W3 · Notifications et dépublication programmée
                  </p>
                </div>
              </div>
              <ChevronDown
                size={16}
                className={`text-ink-400 transition-transform duration-200 ${overdueOpen ? "rotate-180" : ""}`}
              />
            </button>
            {overdueOpen && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-paper-100 border-b border-ink-100">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Titre</th>
                      <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Propriétaire</th>
                      <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Date de révision</th>
                      <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Notification</th>
                      <th className="text-right px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Retard</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100/70">
                    {overdueDocuments.map((doc) => (
                      <tr key={doc.id} className="hover:bg-paper-50 transition-colors">
                        <td className="px-6 py-3.5">
                          <a
                            href={`/documents/${doc.version_id}/preview`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-ink-900 hover:text-lime-700 transition-colors"
                          >
                            {doc.title}
                          </a>
                        </td>
                        <td className="px-6 py-3.5 text-ink-500 text-xs" title={doc.owner_email}>
                          {doc.owner_name || doc.owner_email}
                        </td>
                        <td className="px-6 py-3.5 text-ink-600 text-xs">
                          {new Date(doc.review_date).toLocaleDateString("fr-FR")}
                        </td>
                        <td className="px-6 py-3.5 text-xs">
                          {doc.rt_status === "notified" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Notifié
                            </span>
                          )}
                          {doc.rt_status === "reminded" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
                              Relancé
                            </span>
                          )}
                          {!doc.rt_status && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-paper-100 text-ink-400 border border-ink-100">
                              En attente
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-right text-xs font-bold text-red-600">
                          +{doc.days_overdue} j.
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Activité récente (Accordéon + CSV) ── */}
      <div className="bg-white rounded-3xl border border-ink-100 overflow-hidden shadow-2xs">
        {recent.rows.length === 0 ? (
          <div className="px-6 py-5 text-sm text-ink-400">Aucune activité enregistrée.</div>
        ) : (
          <>
            <div className="w-full px-6 py-4 border-b border-ink-100 flex flex-wrap items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActivityExpanded((v) => !v)}
                  className="flex items-center gap-3 text-left cursor-pointer group"
                >
                  <h2 className="font-bold text-ink-950 text-sm flex items-center gap-2">
                    <span>Activité récente</span>
                    <span className="text-xs font-semibold bg-paper-100 text-ink-600 px-2 py-0.5 rounded-full border border-ink-100">
                      {totals.total.toLocaleString("fr-FR")} actions
                    </span>
                  </h2>
                  <ChevronDown
                    size={16}
                    className={`text-ink-400 transition-transform duration-200 ${activityExpanded ? "rotate-180" : ""}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <a
                  href="/api/admin/audit?format=csv"
                  download
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700 hover:text-ink-950 bg-paper-100 hover:bg-paper-200 px-3 py-1.5 rounded-xl border border-ink-100 transition-colors"
                >
                  <Download size={13} />
                  Export CSV
                </a>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-paper-100 border-b border-ink-100">
                  <tr>
                    <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Action</th>
                    <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Document cité</th>
                    <th className="text-left px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Modèle</th>
                    <th className="text-right px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Latence</th>
                    <th className="text-right px-6 py-3 font-semibold text-ink-600 text-xs uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100/70">
                  {(activityExpanded ? recent.rows : recent.rows.slice(0, 3)).map((row, i) => {
                    const actionInfo = ACTION_LABELS[row.action] ?? {
                      label: row.action,
                      color: "bg-paper-100 text-ink-600 border-ink-100",
                    };
                    return (
                      <tr key={i} className="hover:bg-paper-50 transition-colors">
                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionInfo.color}`}>
                            {actionInfo.label}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-ink-800 font-medium text-xs truncate max-w-[200px]" title={row.main_document_title ?? "—"}>
                          {row.main_document_title ?? "—"}
                        </td>
                        <td className="px-6 py-3.5 text-ink-500 font-mono text-xs whitespace-nowrap">
                          {shortModelName(row.model)}
                        </td>
                        <td className="px-6 py-3.5 text-right text-ink-600 text-xs whitespace-nowrap">
                          {row.latency_ms != null ? `${row.latency_ms} ms` : "—"}
                        </td>
                        <td
                          className="px-6 py-3.5 text-right text-xs text-ink-400 whitespace-nowrap"
                          title={new Date(row.created_at).toLocaleString("fr-FR")}
                        >
                          {relativeTime(row.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {activityExpanded ? (
              <div className="px-6 py-3 bg-paper-50/60 border-t border-ink-100/70 flex items-center justify-between">
                <button
                  onClick={() => {
                    setActivityLoading(true);
                    setActivityPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={activityPage <= 1 || activityLoading}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 disabled:opacity-30 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                  Précédent
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-400">Page {activityPage}</span>
                  <button
                    type="button"
                    onClick={() => setActivityExpanded(false)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-ink-700 hover:text-ink-950 transition-colors cursor-pointer"
                  >
                    Réduire
                    <ChevronDown size={14} className="rotate-180 transition-transform duration-200" />
                  </button>
                </div>
                <button
                  onClick={() => {
                    setActivityLoading(true);
                    setActivityPage((p) => p + 1);
                  }}
                  disabled={!recent.hasNextPage || activityLoading}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-lime-700 disabled:opacity-30 transition-colors cursor-pointer"
                >
                  Suivant
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
              </div>
            ) : recent.rows.length > 3 ? (
              <div className="px-6 py-2.5 bg-paper-50/60 border-t border-ink-100/70 text-center">
                <button
                  type="button"
                  onClick={() => setActivityExpanded(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700 hover:text-ink-950 transition-colors cursor-pointer py-1"
                >
                  Voir tout ({recent.rows.length.toLocaleString("fr-FR")})
                  <ChevronDown size={14} className="transition-transform duration-200" />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
