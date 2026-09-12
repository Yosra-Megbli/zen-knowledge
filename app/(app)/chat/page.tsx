"use client";

import { useState, useRef, useEffect, useCallback, Fragment, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  Package,
  Users,
  Truck,
  Lock,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  ArrowUp,
  Plus,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "../../components/Logo.tsx";

interface Citation {
  chunkId: string | null;
  documentId?: string;
  documentVersionId: string;
  documentTitle: string;
  versionNumber: number;
  versionStatus?: string;
  documentStatus?: string;
  pageNumber: number | null;
  snippetText: string;
  sourceIndex: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  refusal?: boolean;
  latencyMs?: number | null;
  messageId?: string | null;
  feedback?: "useful" | "not_useful" | null;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

// Real questions the seeded demo dataset can actually answer (not
// placeholder copy) — clicking one shows the full RAG flow (question
// -> answer -> citation -> source document) in one click instead of
// requiring a blank page and a typed question.
const SUGGESTIONS: { icon: LucideIcon; label: string; question: string }[] = [
  { icon: Package, label: "Politique produit", question: "Quel est le délai de retour produit ?" },
  { icon: Users, label: "RH", question: "Quelle est la procédure d'intégration des nouveaux employés ?" },
  { icon: Truck, label: "Logistique", question: "Quelle est la politique de livraison ?" },
  { icon: Lock, label: "Confidentialité", question: "Quelle est la grille salariale et les primes pour 2026 ?" },
];

export default function ChatPage() {
  // useSearchParams() requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeConversationParam = searchParams.get("c");

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConversations();
  }, [fetchConversations]);

  // Loads whichever conversation the URL points to (?c=<id>), or
  // resets to the empty "new conversation" state when absent — this
  // is the ONLY place conversationId/messages are driven by the URL,
  // so the browser back/forward buttons and a pasted link both work.
  useEffect(() => {
    if (!activeConversationParam) {
      // Synchronizing local state with the URL (the external source of
      // truth for which conversation is active) — the same accepted
      // pattern as fetchDocs() elsewhere in this codebase.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConversationId(null);
      setMessages([]);
      return;
    }
    if (activeConversationParam === conversationId) return;

    let cancelled = false;
    setLoadingHistory(true);
    fetch(`/api/conversations/${activeConversationParam}/messages`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { messages: (Message & { id: string })[] }) => {
        if (cancelled) return;
        setMessages(
          data.messages.map((m) => ({
            role: m.role,
            content: m.content,
            citations: m.citations,
            latencyMs: m.latencyMs,
            messageId: m.role === "assistant" ? m.id : null,
            feedback: m.feedback ?? null,
          }))
        );
        setConversationId(activeConversationParam);
      })
      .catch(() => {
        // Conversation not found / not ours (404) or any other
        // failure — fall back to a fresh conversation rather than
        // leaving the page stuck on a broken load.
        if (!cancelled) router.replace("/chat");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationParam]);

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
      const isNewConversation = !conversationId && !!data.conversationId;
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

      // First turn of a brand new conversation: reflect it in the URL
      // (without a history entry per keystroke-triggered send) and
      // refresh the sidebar so it appears immediately.
      if (isNewConversation) {
        router.replace(`/chat?c=${data.conversationId}`, { scroll: false });
        fetchConversations();
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
  // normalize the same variants before matching, or the raw marker
  // leaks into the visible answer text.
  //
  // Renders markdown (the model reliably emits "**bold**" etc., which
  // was previously shown as literal asterisks) and turns each [n]
  // marker into a real clickable citation — not just the source card
  // below the bubble — opening the exact document version at the
  // cited page, per "chaque citation ouvre le bon document au passage
  // utilisé".
  // The citation's primary destination: the in-app preview page,
  // opened at the cited passage (chunkId highlights it there; the
  // snippet is also passed so the highlight still works even if the
  // chunk row was later deleted — see the preview page's fallback).
  function previewUrl(citation: Citation) {
    const params = new URLSearchParams();
    if (citation.chunkId) params.set("chunk", citation.chunkId);
    else params.set("snippet", citation.snippetText);
    return `/documents/${citation.documentVersionId}/preview?${params.toString()}`;
  }

  function renderAnswer(content: string, citations: Citation[]) {
    const normalized = content
      .replace(/[​-‍﻿]/g, "")
      .replace(/[[［【]\s*SOURCE\s+(\d+)\s*[\]］】]/gi, (_, n) => `[${n}]`);

    const parts = normalized.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (!match) {
        return (
          <ReactMarkdown key={i} allowedElements={["strong", "em", "code"]} unwrapDisallowed>
            {part}
          </ReactMarkdown>
        );
      }
      const citation = citations.find((c) => c.sourceIndex === Number(match[1]));
      // A citation index the model mentioned but that extractCitations()
      // didn't keep (fabricated / out of range) renders as plain text,
      // never as a button pointing nowhere.
      if (!citation) return <Fragment key={i}>{part}</Fragment>;
      return (
        <a
          key={i}
          href={previewUrl(citation)}
          target="_blank"
          rel="noopener noreferrer"
          title={`${citation.documentTitle} — v${citation.versionNumber}${citation.pageNumber ? `, page ${citation.pageNumber}` : ""}`}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-lime-100 px-1 align-super text-[10px] font-bold text-lime-700 no-underline transition-colors hover:bg-lime-400"
        >
          {match[1]}
        </a>
      );
    });
  }

  const inputForm = (
    <form onSubmit={send} className="max-w-3xl mx-auto flex gap-3">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Posez une question sur vos documents…"
        disabled={loading}
        className="flex-1 border border-ink-100 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-lime-400 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={loading || !input.trim()}
        title="Envoyer"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white transition-colors hover:bg-lime-500 hover:text-ink-950 disabled:opacity-30 disabled:hover:bg-ink-950 disabled:hover:text-white"
      >
        <ArrowUp size={18} strokeWidth={2.5} />
      </button>
    </form>
  );

  const sidebar = (
    <div className="hidden md:flex w-64 shrink-0 flex-col border-r border-ink-100 bg-paper-100 h-full">
      <div className="p-3">
        <button
          onClick={() => router.push("/chat")}
          className="w-full flex items-center gap-2 rounded-lg border border-ink-100 bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-lime-400 hover:text-lime-700 transition-colors"
        >
          <Plus size={15} strokeWidth={2.5} />
          Nouvelle conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {conversations.length === 0 ? (
          <p className="text-xs text-ink-300 px-2 py-2">Aucune conversation.</p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/chat?c=${c.id}`)}
              className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm truncate transition-colors ${
                c.id === conversationId
                  ? "bg-lime-100 text-ink-950 font-medium"
                  : "text-ink-500 hover:bg-white hover:text-ink-900"
              }`}
              title={c.title ?? "Nouvelle conversation"}
            >
              <MessageSquare size={14} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{c.title || "Nouvelle conversation"}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  // Empty state: title + suggestions + input form centered together as
  // one block (ChatGPT/Claude-style), not a title floating above a
  // large empty gap with the input pinned to the bottom. Once a first
  // message exists, the layout switches to a scrollable history with
  // the input pinned as a sticky bottom bar.
  if (messages.length === 0 && !loadingHistory) {
    return (
      <div className="flex h-[calc(100vh-57px)]">
        {sidebar}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-xl text-center">
            <span className="inline-flex mb-5">
              <LogoMark className="w-12 h-12" />
            </span>
            <p className="font-display text-4xl font-bold text-ink-950 mb-3 tracking-tight">Comment puis-je vous aider ?</p>
            <p className="text-sm text-ink-500 mb-8">
              Interrogez les documents autorisés de votre entreprise.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-8">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.question}
                  onClick={(e) => send(e, s.question)}
                  disabled={loading}
                  className="flex items-start gap-3 bg-white border border-ink-100 rounded-lg p-4 hover:border-lime-400 hover:shadow-sm transition-all disabled:opacity-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-100 text-lime-700">
                    <s.icon size={16} strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-lime-700 mb-1">
                      {s.label}
                    </span>
                    <span className="block text-sm text-ink-950">{s.question}</span>
                  </span>
                </button>
              ))}
            </div>
            {inputForm}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {sidebar}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-3xl mx-auto w-full">
          {loadingHistory ? (
            <p className="text-center text-ink-300 text-sm py-10">Chargement de la conversation…</p>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${msg.role === "user" ? "order-2" : ""}`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-ink-950 text-white rounded-br-sm"
                        : msg.refusal
                        ? "bg-amber-50 border border-amber-200 text-amber-800 rounded-bl-sm"
                        : "bg-white border border-ink-100 text-ink-900 rounded-bl-sm shadow-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? renderAnswer(msg.content, msg.citations ?? []) : msg.content}
                  </div>

                  {/* Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-ink-300 font-medium px-1">Sources</p>
                      {msg.citations.map((c) => {
                        const key = `${i}-${c.sourceIndex}`;
                        // Only a deleted DOCUMENT blocks access — an
                        // "archived" version (superseded by a newer
                        // one) stays fully viewable, historical
                        // citations must remain verifiable.
                        const isDeleted = c.documentStatus === "deleted";
                        return (
                          <div key={key} className="bg-white border border-ink-100 rounded-xl text-xs">
                            <div className="flex items-center justify-between gap-2 px-3 py-2">
                              <button
                                onClick={() => setExpanded(expanded === key ? null : key)}
                                className="flex-1 text-left font-medium text-ink-700 truncate hover:text-lime-600 transition-colors"
                              >
                                [{c.sourceIndex}] {c.documentTitle}
                                {isDeleted && (
                                  <span className="ml-1.5 text-ink-300 font-normal">(document supprimé)</span>
                                )}
                              </button>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-ink-300">
                                  v{c.versionNumber}{c.pageNumber ? ` · p.${c.pageNumber}` : ""}
                                </span>
                                {!isDeleted && (
                                  <a
                                    href={previewUrl(c)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-lime-600 hover:text-lime-800 transition-colors"
                                    title="Ouvrir le document"
                                  >
                                    <ExternalLink size={13} strokeWidth={2} />
                                  </a>
                                )}
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
                        <span className="flex items-center gap-1 text-xs text-ink-300">
                          {msg.feedback === "useful" ? <ThumbsUp size={13} /> : <ThumbsDown size={13} />}
                          {msg.feedback === "useful" ? "Utile" : "Pas utile"}
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => sendFeedback(i, "useful")}
                            className="text-ink-300 hover:text-lime-700 transition-colors"
                            title="Réponse utile"
                          >
                            <ThumbsUp size={14} strokeWidth={2} />
                          </button>
                          <button
                            onClick={() => sendFeedback(i, "not_useful")}
                            className="text-ink-300 hover:text-red-500 transition-colors"
                            title="Réponse pas utile"
                          >
                            <ThumbsDown size={14} strokeWidth={2} />
                          </button>
                        </>
                      )}
                      {msg.latencyMs != null && (
                        <span className="text-xs text-ink-300">{(msg.latencyMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-ink-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1 items-center h-4">
                  <span className="w-1.5 h-1.5 bg-lime-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-lime-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-lime-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-ink-100 bg-white px-4 py-4">
          {inputForm}
        </div>
      </div>
    </div>
  );
}
