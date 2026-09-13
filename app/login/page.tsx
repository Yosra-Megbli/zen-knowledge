"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogoMark } from "../components/Logo.tsx";
import { AlertCircle, Check, ExternalLink, Eye, EyeOff, FileText, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeQuickEmail, setActiveQuickEmail] = useState<string | null>(null);

  const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "ZenDemo2026!";

  const QUICK_LOGINS = [
    { label: "ZEN Retail Tunisia", role: "Admin", email: "admin@zenretail.example" },
    { label: "ZEN Home & Lifestyle", role: "Admin", email: "admin@zenhomelifestyle.example" },
    { label: "ZEN Retail Tunisia", role: "Employé", email: "employee@zenretail.example" },
  ];

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email: loginEmail,
      password: loginPassword,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Email ou mot de passe incorrect.");
    } else {
      router.push("/chat");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(email, password);
  }

  async function handleQuickLogin(qEmail: string) {
    setEmail(qEmail);
    setPassword(DEMO_PASSWORD);
    setActiveQuickEmail(qEmail);
    try {
      await doLogin(qEmail, DEMO_PASSWORD);
    } finally {
      setActiveQuickEmail(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:grid md:grid-cols-12 bg-ink-950 font-sans antialiased text-ink-100">
      {/* ── Left Branding Panel (~60% on desktop) ────────────────────────── */}
      <div className="md:col-span-6 lg:col-span-7 bg-ink-950 p-6 sm:p-10 lg:p-14 flex flex-col justify-between relative overflow-hidden border-b md:border-b-0 md:border-r border-ink-700/60">
        {/* Subtle radial CSS glow behind mockup */}
        <div
          className="absolute top-1/2 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[460px] h-[460px] rounded-full blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(212,241,104,0.09) 0%, rgba(18,22,15,0) 70%)" }}
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(199,235,61,0.05) 0%, rgba(18,22,15,0) 70%)" }}
          aria-hidden="true"
        />

        {/* 1 & 2. Top Header & Title in upper third */}
        <div className="relative z-10 space-y-6 sm:space-y-8">
          <div className="flex items-center gap-3">
            <LogoMark className="w-9 h-9 sm:w-10 sm:h-10" />
            <span className="font-display font-semibold text-lg sm:text-xl tracking-tight text-white">
              ZEN Knowledge
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight space-y-1 sm:space-y-1.5">
            <span className="block text-white">Plateforme RAG</span>
            <span className="block text-white">interne</span>
            <span className="block text-lime-400 font-extrabold">multi-entreprises</span>
          </h1>
        </div>

        {/* 3. Central RAG Mockup Card (Focal point — desktop only) */}
        <div
          className="relative z-10 hidden md:block my-6 lg:my-8 pointer-events-none select-none max-w-md w-full"
          aria-hidden="true"
        >
          <div className="bg-ink-900 border border-ink-700/60 rounded-2xl p-4 sm:p-5 shadow-2xl shadow-black/50 transform -rotate-1">
            {/* Conversation header bar */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-ink-700/40 text-[11px] text-ink-500">
              <span className="flex items-center gap-1.5 font-medium text-ink-300">
                <span className="w-2 h-2 rounded-full bg-lime-400"></span>
                Assistant ZEN RAG
              </span>
              <span className="text-[10px] tracking-wider uppercase font-mono text-ink-500">
                Session sécurisée
              </span>
            </div>

            {/* Conversation messages */}
            <div className="space-y-3">
              {/* Message utilisateur (bulle alignée à droite, fond ink-700) */}
              <div className="flex justify-end">
                <div className="bg-ink-700 text-white text-xs sm:text-[13px] rounded-xl rounded-tr-xs px-3.5 py-2.5 max-w-[88%] leading-relaxed shadow-sm">
                  Quelle est la procédure en cas d&apos;incident client ?
                </div>
              </div>

              {/* Réponse assistant (bulle gauche, fond ink-950/70) */}
              <div className="flex justify-start">
                <div className="bg-ink-950/70 border border-ink-700/50 rounded-xl rounded-tl-xs p-3 sm:p-3.5 max-w-[95%] space-y-2.5 shadow-sm">
                  <p className="text-xs text-ink-300 leading-relaxed">
                    L&apos;incident doit être qualifié sous 2h et notifié au responsable support. Un ticket prioritaire P1 est automatiquement ouvert avec suivi dédié.
                  </p>

                  {/* Citation interne */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-ink-900/90 border border-ink-700/60">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-lime-400 shrink-0" />
                      <span className="text-[11px] font-medium text-ink-100 truncate">
                        Procédure incidents — Service Client
                      </span>
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-lime-400/15 text-lime-400 rounded">
                        v1
                      </span>
                    </div>
                    <ExternalLink className="w-3 h-3 text-ink-500 shrink-0" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Bottom Value Props (3 checkmarks) */}
        <div className="relative z-10 pt-6 mt-4 md:mt-0 border-t border-ink-700/40">
          <ul className="space-y-2.5 text-xs sm:text-sm text-ink-300">
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-lime-400 shrink-0" />
              <span>Réponses sourcées et citées</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-lime-400 shrink-0" />
              <span>Permissions appliquées avant la recherche</span>
            </li>
            <li className="flex items-center gap-2.5">
              <Check className="w-4 h-4 text-lime-400 shrink-0" />
              <span>Isolation stricte multi-sociétés</span>
            </li>
          </ul>
        </div>
      </div>

      {/* ── Right Authentication Panel (~40% on desktop) ─────────────────── */}
      <div className="md:col-span-6 lg:col-span-5 bg-ink-900 p-6 sm:p-10 lg:p-12 flex flex-col justify-center relative">
        <div className="w-full max-w-sm mx-auto space-y-6">
          {/* Panel Header */}
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight">
              Connexion
            </h2>
            <p className="text-xs sm:text-sm text-ink-300 mt-1">
              Accédez à votre espace documentaire d&apos;entreprise
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink-300 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full bg-ink-950/80 border border-ink-700/60 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all"
                placeholder="admin@zenretail.example"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink-300 uppercase tracking-wider">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full bg-ink-950/80 border border-ink-700/60 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-white placeholder-ink-500 focus:outline-none focus:ring-2 focus:ring-lime-400 focus:border-transparent transition-all"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-200 transition-colors cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error banner (Dark adapted) */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-950/40 border border-red-900/60 text-xs text-red-300 animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={16} className="shrink-0 text-red-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Primary Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-lime-500 hover:bg-lime-400 text-ink-950 font-bold rounded-xl py-3 text-sm transition-all shadow-md shadow-lime-500/10 hover:shadow-lime-500/20 disabled:opacity-60 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading && !activeQuickEmail ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Connexion…</span>
                </>
              ) : (
                <span>Se connecter</span>
              )}
            </button>
          </form>

          {/* Quick Logins Section */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="h-px bg-ink-800 flex-1" />
              <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wider whitespace-nowrap">
                Connexion rapide — comptes démo
              </p>
              <div className="h-px bg-ink-800 flex-1" />
            </div>

            <div className="grid grid-cols-1 gap-2">
              {QUICK_LOGINS.map((q) => {
                const isSelected = activeQuickEmail === q.email;
                return (
                  <button
                    key={q.email}
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickLogin(q.email)}
                    className={`group w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-ink-950 border-lime-400 shadow-sm shadow-lime-500/10"
                        : "bg-ink-950/60 hover:bg-ink-950 border-ink-700/50 hover:border-lime-500/40 hover:-translate-y-0.5 hover:shadow-sm"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="font-semibold text-white text-xs group-hover:text-lime-300 transition-colors">
                        {q.label}
                      </div>
                      <div className="text-[11px] text-ink-400 truncate mt-0.5 font-mono">
                        {q.email}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <Loader2 size={14} className="animate-spin text-lime-400" />
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            q.role === "Admin"
                              ? "bg-lime-500/20 text-lime-400 border border-lime-500/30"
                              : "bg-ink-700/50 text-ink-300 border border-ink-500/30"
                          }`}
                        >
                          {q.role}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-center text-[11px] text-ink-400 pt-1">
              Mot de passe partagé :{" "}
              <code className="text-ink-200 bg-ink-950 px-1.5 py-0.5 rounded font-mono border border-ink-700/50">
                {DEMO_PASSWORD}
              </code>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
