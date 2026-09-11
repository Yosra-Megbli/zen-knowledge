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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
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

  function renderAnswer(content: string) {
    return content.replace(/\[SOURCE\s+(\d+)\]/gi, (_, n) => `[${n}]`);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-3xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-24">
            <p className="text-2xl font-semibold text-gray-300 mb-2">ZEN Knowledge</p>
            <p className="text-sm">Posez une question sur vos documents d&apos;entreprise.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${msg.role === "user" ? "order-2" : ""}`}>
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : msg.refusal
                    ? "bg-amber-50 border border-amber-200 text-amber-800 rounded-bl-sm"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                }`}
              >
                {msg.role === "assistant" ? renderAnswer(msg.content) : msg.content}
              </div>

              {/* Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-gray-400 font-medium px-1">Sources</p>
                  {msg.citations.map((c) => {
                    const key = `${i}-${c.sourceIndex}`;
                    const fileUrl = `/api/documents/${c.documentVersionId}/file`;
                    return (
                      <div key={c.chunkId} className="bg-white border border-gray-200 rounded-xl text-xs">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <button
                            onClick={() => setExpanded(expanded === key ? null : key)}
                            className="flex-1 text-left font-medium text-gray-700 truncate hover:text-indigo-600 transition-colors"
                          >
                            [{c.sourceIndex}] {c.documentTitle}
                          </button>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-gray-400">
                              v{c.versionNumber}{c.pageNumber ? ` · p.${c.pageNumber}` : ""}
                            </span>
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
                              title="Ouvrir le document"
                            >
                              ↗
                            </a>
                          </div>
                        </div>
                        {expanded === key && (
                          <p className="px-3 pb-2 text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
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
                    <span className="text-xs text-gray-400">
                      {msg.feedback === "useful" ? "👍 Utile" : "👎 Pas utile"}
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => sendFeedback(i, "useful")}
                        className="text-xs text-gray-400 hover:text-green-600 transition-colors"
                        title="Réponse utile"
                      >
                        👍
                      </button>
                      <button
                        onClick={() => sendFeedback(i, "not_useful")}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                        title="Réponse pas utile"
                      >
                        👎
                      </button>
                    </>
                  )}
                  {msg.latencyMs && (
                    <span className="text-xs text-gray-300">{(msg.latencyMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-4">
        <form onSubmit={send} className="max-w-3xl mx-auto flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Posez une question sur vos documents…"
            disabled={loading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );
}
