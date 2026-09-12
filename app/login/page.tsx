"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { LogoMark } from "../components/Logo.tsx";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const DEMO_PASSWORD = "ZenDemo2026!";
  const QUICK_LOGINS = [
    { label: "ZEN Retail Tunisia", role: "Admin", email: "admin@zenretail.example" },
    { label: "ZEN Home & Lifestyle", role: "Admin", email: "admin@zenhomelifestyle.example" },
    { label: "ZEN Retail Tunisia", role: "Employé", email: "employee@zenretail.example" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="inline-flex mb-4">
            <LogoMark className="w-11 h-11" />
          </span>
          <h1 className="font-display text-4xl font-bold text-ink-950 tracking-tight">ZEN Knowledge</h1>
          <p className="text-ink-500 mt-2 text-sm">Plateforme RAG interne multi-entreprises</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-sm border border-ink-100 p-8 flex flex-col gap-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink-700">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
              placeholder="admin@acmecorp.example"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink-700">Mot de passe</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-ink-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="bg-ink-950 hover:bg-ink-900 text-white font-medium rounded-lg py-2.5 text-sm transition-colors disabled:opacity-60"
          >
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <div className="mt-6">
          <p className="text-center text-xs font-medium text-ink-300 uppercase tracking-wide mb-2">
            Connexion rapide — comptes de démo
          </p>
          <div className="grid grid-cols-1 gap-2">
            {QUICK_LOGINS.map((q) => (
              <button
                key={q.email}
                type="button"
                disabled={loading}
                onClick={() => doLogin(q.email, DEMO_PASSWORD)}
                className="flex items-center justify-between bg-white border border-ink-100 rounded-lg px-3 py-2 text-left text-xs hover:border-lime-400 hover:shadow-sm transition-all disabled:opacity-50"
              >
                <span>
                  <span className="block font-semibold text-ink-950">{q.label}</span>
                  <span className="text-ink-300 truncate text-xs">{q.email}</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-lime-100 text-lime-700 font-medium">
                  {q.role}
                </span>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-ink-300 mt-3">
            Mot de passe pour tous les comptes : {DEMO_PASSWORD}
          </p>
        </div>
      </div>
    </div>
  );
}
