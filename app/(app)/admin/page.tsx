"use client";

import { useState, useEffect } from "react";

interface Stats {
  totals: { total: number; answers: number; errors: number; total_tokens: number | null };
  refusals: { question_length: number; created_at: string }[];
  recent: { action: string; model: string | null; latency_ms: number | null; source_count: number; created_at: string }[];
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  rag_answer: { label: "Réponse", color: "bg-green-100 text-green-700" },
  rag_refusal: { label: "Refus", color: "bg-amber-100 text-amber-700" },
  rag_error: { label: "Erreur", color: "bg-red-100 text-red-700" },
};

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.ok ? r.json() : r.json().then((d: { error: string }) => Promise.reject(d.error)))
      .then(setStats)
      .catch((e: string) => setError(typeof e === "string" ? e : "Erreur"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-ink-300 py-20">Chargement…</div>;
  if (error) return <div className="text-center text-red-500 py-20">{error}</div>;
  if (!stats) return null;

  const { totals, refusals, recent } = stats;
  const refusalRate = totals.total > 0 ? Math.round((refusals.length / totals.total) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <h1 className="font-display text-xl font-semibold text-ink-950">Administration</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Requêtes totales", value: totals.total },
          { label: "Réponses générées", value: totals.answers },
          { label: "Refus (no-source)", value: refusals.length },
          { label: "Tokens consommés", value: totals.total_tokens?.toLocaleString("fr-FR") ?? "—" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-ink-100 p-5">
            <p className="text-xs text-ink-300 font-medium mb-1">{kpi.label}</p>
            <p className="font-display text-2xl font-semibold text-ink-950">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Questions sans résultat */}
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <h2 className="font-medium text-ink-700">Questions sans résultat (refus récents)</h2>
          <span className="text-xs text-ink-300">{refusalRate}% de refus</span>
        </div>
        {refusals.length === 0 ? (
          <p className="text-sm text-ink-300 px-5 py-6">Aucun refus enregistré.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {refusals.map((r, i) => (
              <li key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                <span className="text-ink-500">Question de {r.question_length} caractères</span>
                <span className="text-xs text-ink-300">
                  {new Date(r.created_at).toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Activité récente */}
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-medium text-ink-700">Activité récente</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-cream-100 border-b border-ink-100">
            <tr>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Action</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Modèle</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Latence</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Sources</th>
              <th className="text-left px-5 py-3 font-medium text-ink-300">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {recent.map((r, i) => {
              const a = ACTION_LABELS[r.action] ?? { label: r.action, color: "bg-ink-100 text-ink-500" };
              return (
                <tr key={i} className="hover:bg-cream-100">
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.color}`}>{a.label}</span>
                  </td>
                  <td className="px-5 py-3 text-ink-500 text-xs">{r.model ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-500 text-xs">
                    {r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-500">{r.source_count}</td>
                  <td className="px-5 py-3 text-ink-300 text-xs">
                    {new Date(r.created_at).toLocaleString("fr-FR")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
