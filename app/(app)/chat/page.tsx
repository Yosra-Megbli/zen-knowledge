"use client";

import { useState, useRef, useEffect } from "react";

interface Citation {
  chunkId: string;
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
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
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
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
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
            <p className="text-sm">Posez une question sur vos documents d'entreprise.</p>
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
                  {msg.citations.map((c) => (
                    <button
                      key={c.chunkId}
                      onClick={() => setExpanded(expanded === i * 100 + c.sourceIndex ? null : i * 100 + c.sourceIndex)}
                      className="w-full text-left bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-700 truncate">
                          [{c.sourceIndex}] {c.documentTitle}
                        </span>
                        <span className="text-gray-400 shrink-0">
                          v{c.versionNumber}{c.pageNumber ? ` · p.${c.pageNumber}` : ""}
                        </span>
                      </div>
                      {expanded === i * 100 + c.sourceIndex && (
                        <p className="mt-2 text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
                          {c.snippetText}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Metadata */}
              {msg.latencyMs && (
                <p className="text-xs text-gray-300 mt-1 px-1">{(msg.latencyMs / 1000).toFixed(1)}s</p>
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
