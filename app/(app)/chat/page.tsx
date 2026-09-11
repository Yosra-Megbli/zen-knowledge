"use client";

import { useState, useRef, useEffect } from "react";

interface Citation {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  pageNumber: number | null;
  snippetText: string;
  sourceIndex: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  refusal?: boolean;
  latencyMs?: number;
  messageId?: string | null;
  feedback?: "useful" | "not_useful" | null;
}

// Real questions the seeded demo dataset can actually answer (not
// placeholder copy) — clicking one shows the full RAG flow (question
// -> answer -> citation -> source document) in one click instead of
// requiring a blank page and a typed question.
const SUGGESTIONS = [
  { icon: "📦", label: "Politique produit", question: "Quel est le délai de retour produit ?" },
  { icon: "👋", label: "RH", question: "Quelle est la procédure d'intégration des nouveaux employés ?" },
  { icon: "🚚", label: "Logistique", question: "Quelle est la politique de livraison ?" },
  { icon: "🔒", label: "Confidentialité", question: "Quelle est la grille salariale et les primes pour 2026 ?" },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent, overrideQuestion?: string) {
    e.preventDefault();
    const question = (overrideQuestion ?? input).trim();
    if (!question || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);
    try {
      const res = await fetch("/api/rag/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId }),
      });
      const data = await res.json();
      if (data.conversationId) setConversationId(data.conversationId);

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Erreur inattendue.", refusal: true },
        ]);
      } else if (data.refusal) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Je n'ai pas trouvé de sources autorisées suffisantes pour répondre à cette question.",
            refusal: true,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer,
            citations: data.citations,
            latencyMs: data.metadata?.latencyMs,
            messageId: data.messageId ?? null,
            feedback: null,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erreur réseau. Veuillez réessayer.", refusal: true },
      ]);
    }
    setLoading(false);
  }

  async function sendFeedback(msgIndex: number, rating: "useful" | "not_useful") {
    const msg = messages[msgIndex];
    if (!msg.messageId || msg.feedback) return;
    // Optimistic update
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, feedback: rating } : m))
    );
    await fetch("/api/rag/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: msg.messageId, rating }),
    }).catch(() => {});
  }

  // Mirrors the bracket-variant tolerance in lib/rag/answerQuestion.ts'
  // extractCitations(): the model doesn't always emit plain ASCII
  // "[SOURCE n]" (observed fullwidth CJK brackets and stray zero-width
  // characters from the real Groq/gpt-oss-120b provider), so this must
  // normalize the same variants or the raw marker leaks into the
  // visible answer text.
  function renderAnswer(content: string) {
    const normalized = content.replace(/[​-‍﻿]/g, "");
    return normalized.replace(/[[［【]\s*SOURCE\s+(\d+)\s*[\]］】]/gi, (_, n) => `[${n}]`);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-3xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="text-center mt-16">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-clay-50 text-clay-500 font-display text-xl mb-4">
              Z
            </span>
            <p className="font-display text-2xl font-semibold text-ink-500 mb-2">Comment puis-je vous aider ?</p>
            <p className="text-sm text-ink-300 mb-8">
              Interrogez les documents autorisés de votre entreprise.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left max-w-xl mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.question}
                  onClick={(e) => send(e, s.question)}
                  disabled={loading}
                  className="bg-white border border-ink-100 rounded-xl p-4 hover:border-clay-300 hover:shadow-sm transition-all disabled:opacity-50"
                >
                  <p className="text-xs font-medium text-clay-600 mb-1">
                    {s.icon} {s.label}
                  </p>
                  <p className="text-sm text-ink-700">{s.question}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${msg.role === "user" ? "order-2" : ""}`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-clay-500 text-white rounded-br-sm"
                    : msg.refusal
                    ? "bg-amber-50 border border-amber-200 text-amber-800 rounded-bl-sm"
                    : "bg-white border border-ink-100 text-ink-900 rounded-bl-sm shadow-sm"
                }`}
              >
                {msg.role === "assistant" ? renderAnswer(msg.content) : msg.content}
              </div>

              {/* Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-ink-300 font-medium px-1">Sources</p>
                  {msg.citations.map((c) => {
                    const key = `${i}-${c.sourceIndex}`;
                    const fileUrl = `/api/documents/${c.documentVersionId}/file`;
                    return (
                      <div key={c.chunkId} className="bg-white border border-ink-100 rounded-xl text-xs">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <button
                            onClick={() => setExpanded(expanded === key ? null : key)}
                            className="flex-1 text-left font-medium text-ink-700 truncate hover:text-clay-600 transition-colors"
                          >
                            [{c.sourceIndex}] {c.documentTitle}
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-ink-300">
                              v{c.versionNumber}{c.pageNumber ? ` · p.${c.pageNumber}` : ""}
                            </span>
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-clay-500 hover:text-clay-700 font-medium transition-colors"
                              title="Ouvrir le document"
                            >
                              ↗
                            </a>
                          </div>
                        </div>
                        {expanded === key && (
                          <p className="px-3 pb-2 text-ink-500 leading-relaxed border-t border-ink-100 pt-2">
                            {c.snippetText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Feedback + latency */}
              {msg.role === "assistant" && !msg.refusal && msg.messageId && (
                <div className="flex items-center gap-3 mt-1.5 px-1">
                  {msg.feedback ? (
                    <span className="text-xs text-ink-300">
                      {msg.feedback === "useful" ? "👍 Utile" : "👎 Pas utile"}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => sendFeedback(i, "useful")}
                        className="text-xs text-ink-300 hover:text-green-600 transition-colors"
                        title="Réponse utile"
                      >
                        👍
                      </button>
                      <button
                        onClick={() => sendFeedback(i, "not_useful")}
                        className="text-xs text-ink-300 hover:text-red-500 transition-colors"
                        title="Réponse pas utile"
                      >
                        👎
                      </button>
                    </>
                  )}
                  {msg.latencyMs && (
                    <span className="text-xs text-ink-300">{(msg.latencyMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-ink-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-clay-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-clay-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-clay-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-ink-100 bg-white px-4 py-4">
        <form onSubmit={send} className="max-w-3xl mx-auto flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez une question sur vos documents…"
            disabled={loading}
            className="flex-1 border border-ink-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-clay-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-clay-500 hover:bg-clay-600 text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}
