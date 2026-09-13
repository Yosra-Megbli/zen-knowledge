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
  History,
  X,
  Trash2,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  FileText,
  Zap,
  Layers,
  ShieldCheck,
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

// Local (browser) date/time — grouping matches the viewer's own calendar day
function groupConversationsByDate(items: ConversationSummary[]): { label: string; items: ConversationSummary[] }[] {
  const todayStr = new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const today: ConversationSummary[] = [];
  const yest: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];
  for (const c of items) {
    const d = new Date(c.updated_at).toDateString();
    if (d === todayStr) today.push(c);
    else if (d === yesterdayStr) yest.push(c);
    else older.push(c);
  }

  return [
    { label: "Aujourd'hui", items: today },
    { label: "Hier", items: yest },
    { label: "Plus ancien", items: older },
  ].filter((g) => g.items.length > 0);
}

// Extract up to 3 meaningful keyword terms (> 3 letters, excluding common stop words)
function getQuestionKeywords(question?: string): string[] {
  if (!question) return [];
  const stopWords = new Set([
    "quel", "quelle", "quels", "quelles", "dans", "pour", "avec", "sont",
    "cette", "plus", "tout", "tous", "toute", "toutes", "faire", "comme",
    "leur", "leurs", "nous", "vous", "elles", "mais", "comment", "quand",
    "pourquoi", "est-ce", "avez", "avoir", "etre", "peut", "peux",
    "votre", "vos", "notre", "nos"
  ]);
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
  return Array.from(new Set(words)).slice(0, 3);
}

// Highlights key terms within snippet text
function renderHighlightedSnippet(text: string, keywords: string[]) {
  if (!keywords.length) return text;
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, idx) => {
    if (keywords.some((k) => k.toLowerCase() === part.toLowerCase())) {
      return (
        <mark
          key={idx}
          className="bg-lime-200/90 text-ink-950 font-semibold px-1 py-0.5 rounded not-italic"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

const SUGGESTIONS: { icon: LucideIcon; label: string; question: string; restrictedToAdmin?: boolean }[] = [
  { icon: Package, label: "Politique produit", question: "Quel est le délai de retour produit ?" },
  { icon: Users, label: "RH", question: "Quelle est la procédure d'intégration des nouveaux employés ?" },
  { icon: Truck, label: "Logistique", question: "Quelle est la politique de livraison ?" },
  { icon: Lock, label: "Confidentialité", question: "Quelle est la grille salariale et les primes pour 2026 ?", restrictedToAdmin: true },
];

export default function ChatPage() {
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
  const [loadingPhase, setLoadingPhase] = useState<"retrieving" | "generating">("retrieving");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedSnippets, setExpandedSnippets] = useState<Record<string, boolean>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string | null } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [sourcesPanelOpen, setSourcesPanelOpen] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setIsAdmin(s?.user?.role === "admin"))
      .catch(() => {});
  }, []);

  const visibleSuggestions = SUGGESTIONS.filter((s) => !s.restrictedToAdmin || isAdmin);

  // Auto scroll down smoothly on new messages or loading updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, loadingPhase]);

  // Handle textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConversations();
  }, [fetchConversations]);

  function handleDeleteConversation(e: React.MouseEvent, id: string, title: string | null) {
    e.stopPropagation();
    setConfirmDelete({ id, title });
  }

  async function confirmAndDeleteConversation() {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    setDeletingConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}/delete`, { method: "POST" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (id === conversationId) router.push("/chat");
      }
    } finally {
      setDeletingConversationId(null);
    }
  }

  async function handleConfirmDeleteAll() {
    setConfirmDeleteAll(false);
    setDeletingAll(true);
    try {
      const res = await fetch("/api/conversations", { method: "DELETE" });
      if (res.ok) {
        setConversations([]);
        setConversationId(null);
        setMessages([]);
        router.push("/chat");
      } else {
        // Fallback: delete conversation-by-conversation
        await Promise.all(
          conversations.map((c) =>
            fetch(`/api/conversations/${c.id}/delete`, { method: "POST" })
          )
        );
        setConversations([]);
        setConversationId(null);
        setMessages([]);
        router.push("/chat");
      }
    } finally {
      setDeletingAll(false);
    }
  }

  function handleScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 140);
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBottom(false);
  }

  function handleCopy(index: number, content: string) {
    navigator.clipboard.writeText(content);
    setCopiedMessageIndex(index);
    setTimeout(() => {
      setCopiedMessageIndex((prev) => (prev === index ? null : prev));
    }, 2000);
  }

  // Synchronize conversation state from URL (?c=<id>)
  useEffect(() => {
    if (!activeConversationParam) {
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
        if (!cancelled) router.replace("/chat");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversationParam, conversationId, router]);

  async function send(e?: React.FormEvent, overrideQuestion?: string) {
    if (e) e.preventDefault();
    const question = (overrideQuestion ?? input).trim();
    if (!question || loading) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);
    setLoadingPhase("retrieving");

    const phaseTimer = setTimeout(() => {
      setLoadingPhase("generating");
    }, 700);

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
            content: data.reason || "Je n'ai pas de sources autorisées suffisantes pour répondre à cette question.",
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

      if (isNewConversation) {
        router.replace(`/chat?c=${data.conversationId}`, { scroll: false });
        fetchConversations();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Erreur réseau. Veuillez réessayer.", refusal: true },
      ]);
    } finally {
      clearTimeout(phaseTimer);
      setLoading(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading) {
        send();
      }
    }
  }

  async function sendFeedback(msgIndex: number, rating: "useful" | "not_useful") {
    const msg = messages[msgIndex];
    if (!msg.messageId) return;
    if (msg.feedback === rating) return; // already in this state

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
      if (!citation) return <Fragment key={i}>{part}</Fragment>;

      return (
        <span key={i} className="relative inline-block group/cite">
          <a
            href={previewUrl(citation)}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-lime-100 px-1.5 align-super text-[10px] font-bold text-lime-800 no-underline transition-all hover:bg-lime-400 hover:scale-105 active:scale-95 shadow-2xs outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-500"
          >
            {match[1]}
          </a>

          {/* Source preview tooltip on hover */}
          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/cite:flex flex-col w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-ink-100 bg-white p-3 shadow-xl z-50 text-left transition-all">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-950 mb-1">
              <FileText size={13} className="text-lime-600 shrink-0" />
              <span className="truncate">{citation.documentTitle}</span>
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-ink-400 mb-1.5 font-medium">
              <span className="bg-paper-200 px-1.5 py-0.5 rounded text-ink-700">v{citation.versionNumber}</span>
              {citation.pageNumber && (
                <span className="bg-paper-200 px-1.5 py-0.5 rounded text-ink-700">p.{citation.pageNumber}</span>
              )}
            </span>
            <span className="text-[11px] leading-relaxed text-ink-600 line-clamp-3 bg-paper-50 p-2 rounded border border-ink-50 italic">
              &ldquo;{citation.snippetText}&rdquo;
            </span>
            <span className="text-[9px] text-lime-700 font-medium mt-1.5 text-right">
              Cliquer pour ouvrir au passage ↗
            </span>
          </span>
        </span>
      );
    });
  }

  const inputForm = (
    <form onSubmit={(e) => send(e)} className="max-w-3xl mx-auto flex items-end gap-2.5">
      <div className="relative flex-1 rounded-2xl border border-ink-100 bg-white shadow-xs focus-within:border-lime-400 focus-within:ring-2 focus-within:ring-lime-400/20 transition-all">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Posez une question sur vos documents… (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"
          disabled={loading}
          className="w-full resize-none border-0 bg-transparent px-4 py-3 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-0 disabled:opacity-50 max-h-40 overflow-y-auto leading-relaxed"
          style={{ minHeight: "44px" }}
        />
      </div>
      <button
        type="submit"
        disabled={loading || !input.trim()}
        title={loading ? "Recherche en cours…" : "Envoyer"}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all ${
          input.trim() && !loading
            ? "bg-lime-500 text-ink-950 shadow-sm hover:bg-lime-400 hover:scale-105 active:scale-95 cursor-pointer"
            : "bg-paper-200 text-ink-300 cursor-not-allowed opacity-60"
        } outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400`}
      >
        {loading ? (
          <Loader2 size={18} className="animate-spin text-ink-950" />
        ) : (
          <ArrowUp size={18} strokeWidth={2.5} />
        )}
      </button>
    </form>
  );

  const sidebar = (
    <>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden transition-opacity"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-200 ease-out ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:z-auto md:w-64 md:translate-x-0 md:transition-none flex shrink-0 flex-col border-r border-ink-100 bg-paper-100 h-full`}
      >
        <div className="p-3 border-b border-ink-100/60">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                router.push("/chat");
                setMobileSidebarOpen(false);
              }}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-2 text-sm font-medium text-ink-800 hover:border-lime-400 hover:text-lime-800 hover:shadow-2xs transition-all outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
            >
              <Plus size={15} strokeWidth={2.5} className="text-lime-600" />
              Nouvelle conversation
            </button>
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="md:hidden p-2 text-ink-400 hover:text-ink-800 outline-none focus:outline-none"
              title="Fermer"
            >
              <X size={18} />
            </button>
          </div>
          {conversations.length > 0 && (
            <div className="mt-2.5 pt-2 flex items-center justify-between border-t border-ink-100/50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                Historique
              </span>
              <button
                onClick={() => setConfirmDeleteAll(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-red-600 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                title="Supprimer toutes les conversations"
              >
                <Trash2 size={13} strokeWidth={2} />
                <span>Tout supprimer</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-10 h-10 rounded-full bg-paper-200 flex items-center justify-center mb-2.5 text-ink-300">
                <MessageSquare size={18} strokeWidth={1.8} />
              </div>
              <p className="text-xs font-medium text-ink-600">Aucune conversation</p>
              <p className="text-[11px] text-ink-300 mt-0.5">Posez une question pour commencer.</p>
            </div>
          ) : (
            groupConversationsByDate(conversations).map((group) => (
              <div key={group.label} className="mb-3">
                <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-300">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((c) => (
                    <div
                      key={c.id}
                      className={`group relative flex items-center rounded-lg pr-1 transition-all border-l-2 ${
                        c.id === conversationId
                          ? "bg-lime-50/80 border-lime-500 text-ink-950 font-medium shadow-2xs"
                          : "border-transparent hover:bg-white text-ink-600 hover:text-ink-900"
                      }`}
                    >
                      <button
                        onClick={() => {
                          router.push(`/chat?c=${c.id}`);
                          setMobileSidebarOpen(false);
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left text-sm outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 rounded-md"
                        title={c.title || "Nouvelle conversation"}
                      >
                        <MessageSquare
                          size={14}
                          strokeWidth={2}
                          className={`shrink-0 ${
                            c.id === conversationId ? "text-lime-600" : "text-ink-300 group-hover:text-ink-500"
                          }`}
                        />
                        <span className="truncate">{c.title || "Nouvelle conversation"}</span>
                      </button>
                      <button
                        onClick={(e) => handleDeleteConversation(e, c.id, c.title)}
                        disabled={deletingConversationId === c.id}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 shrink-0 p-1.5 rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        title="Supprimer la conversation"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete Single Conversation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-red-600" strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1">Supprimer la conversation ?</h2>
                <p className="text-sm text-ink-500">
                  <span className="font-medium text-ink-900">« {confirmDelete.title || "Nouvelle conversation"} »</span> sera
                  définitivement supprimée. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-ink-100 rounded-xl py-2.5 text-sm font-medium text-ink-600 hover:bg-paper-100 transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmAndDeleteConversation}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-medium transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Conversations Modal */}
      {confirmDeleteAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 size={22} className="text-red-600" strokeWidth={2} />
              </div>
              <div>
                <h2 className="font-semibold text-ink-950 text-base mb-1">
                  Supprimer toutes les conversations ?
                </h2>
                <p className="text-sm text-ink-500 leading-relaxed">
                  Toutes vos conversations ainsi que leur historique seront définitivement supprimés. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setConfirmDeleteAll(false)}
                className="flex-1 border border-ink-100 rounded-xl py-2.5 text-sm font-medium text-ink-600 hover:bg-paper-100 transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAll}
                disabled={deletingAll}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-50 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                {deletingAll ? "Suppression…" : "Tout supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const mobileHistoryButton = (
    <button
      onClick={() => setMobileSidebarOpen(true)}
      className="md:hidden inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-lime-700 transition-colors px-2.5 py-1.5 rounded-lg border border-ink-100 bg-white shadow-2xs outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
      title="Historique des conversations"
    >
      <History size={14} strokeWidth={2} />
      Historique
    </button>
  );

  // Empty state: centered welcome with interactive suggestion cards
  if (messages.length === 0 && !loadingHistory) {
    return (
      <div className="flex h-[calc(100vh-57px)]">
        {sidebar}
        <div className="flex-1 flex flex-col min-w-0 bg-paper-50/40">
          <div className="md:hidden px-4 pt-3">{mobileHistoryButton}</div>
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
            <div className="w-full max-w-xl text-center">
              <span className="inline-flex mb-4">
                <LogoMark className="w-12 h-12" />
              </span>
              <h1 className="font-display text-2xl sm:text-4xl font-bold text-ink-950 mb-2 tracking-tight">
                Comment puis-je vous aider ?
              </h1>
              <p className="text-sm text-ink-500 mb-8">
                Interrogez les documents autorisés de votre entreprise en toute confiance.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-left mb-8">
                {visibleSuggestions.map((s) => (
                  <button
                    key={s.question}
                    onClick={() => send(undefined, s.question)}
                    disabled={loading}
                    className="group flex items-start gap-3.5 bg-white border border-ink-100 rounded-xl p-4 hover:border-lime-400 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 disabled:opacity-50 text-left cursor-pointer outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lime-100 text-lime-700 group-hover:bg-lime-500 group-hover:text-ink-950 transition-colors">
                      <s.icon size={17} strokeWidth={2} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-lime-700 mb-1">
                        {s.label}
                      </span>
                      <span className="block text-sm font-medium text-ink-950 group-hover:text-ink-900 transition-colors leading-snug">
                        {s.question}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {inputForm}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const latestAssistantMessage = [...messages].reverse().find(
    (m) => m.role === "assistant" && m.citations && m.citations.length > 0
  );
  const currentCitations = latestAssistantMessage?.citations ?? [];

  const currentConversation = conversations.find((c) => c.id === conversationId);
  const conversationTitle =
    currentConversation?.title ||
    (messages.length > 0
      ? messages.find((m) => m.role === "user")?.content.slice(0, 45) || "Conversation active"
      : "Nouvelle conversation");

  const rightSourcesPanel = (
    <div className="flex flex-col h-full bg-white">
      {/* Panel Header */}
      <div className="h-12 px-4 border-b border-ink-100/70 flex items-center justify-between shrink-0 bg-paper-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lime-100 text-lime-800">
            <Layers size={14} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-ink-950 truncate">
              {currentCitations.length > 0 ? "Sources citées" : "Contexte RAG"}
            </h3>
            <p className="text-[10px] text-ink-400 truncate">
              {currentCitations.length > 0
                ? `${currentCitations.length} référence${currentCitations.length > 1 ? "s" : ""} active${currentCitations.length > 1 ? "s" : ""}`
                : "Gouvernance & Sécurité"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSourcesPanelOpen(false)}
          className="p-1.5 text-ink-400 hover:text-ink-950 hover:bg-paper-100 rounded-lg transition-colors cursor-pointer"
          title="Masquer le volet des sources"
        >
          <X size={15} />
        </button>
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {currentCitations.length > 0 ? (
          currentCitations.map((c) => {
            const isDeleted = c.documentStatus === "deleted" || c.versionStatus === "deleted";
            const userMsg = [...messages].reverse().find((m) => m.role === "user")?.content;
            const keywords = getQuestionKeywords(userMsg);
            return (
              <div
                key={c.sourceIndex}
                className="rounded-xl border border-ink-100 bg-white p-3.5 shadow-2xs hover:border-lime-300 hover:shadow-xs transition-all space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime-100 text-[11px] font-bold text-lime-800">
                      {c.sourceIndex}
                    </span>
                    <span className="font-semibold text-ink-950 text-xs truncate" title={c.documentTitle}>
                      {c.documentTitle}
                    </span>
                  </div>
                  {!isDeleted && (
                    <a
                      href={previewUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-ink-400 hover:text-lime-700 hover:bg-paper-100 rounded transition-colors shrink-0"
                      title="Ouvrir le document au passage utilisé"
                    >
                      <ExternalLink size={13} strokeWidth={2} />
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-ink-500 font-medium flex-wrap">
                  <span className="bg-paper-100 px-1.5 py-0.5 rounded border border-ink-100 text-ink-700">
                    v{c.versionNumber}
                  </span>
                  {c.pageNumber && (
                    <span className="bg-paper-100 px-1.5 py-0.5 rounded border border-ink-100 text-ink-700">
                      Page {c.pageNumber}
                    </span>
                  )}
                  {isDeleted && (
                    <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-200">
                      Supprimé
                    </span>
                  )}
                </div>

                <div className="border-l-2 border-lime-400 bg-paper-50 p-2.5 rounded-r-lg text-ink-800">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
                    Extrait cité
                  </p>
                  <p className="text-xs leading-relaxed italic line-clamp-6">
                    &ldquo;{renderHighlightedSnippet(c.snippetText, keywords)}&rdquo;
                  </p>
                </div>

                {!isDeleted && (
                  <div className="pt-0.5 text-right">
                    <a
                      href={previewUrl(c)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-lime-700 hover:text-lime-800 hover:underline transition-colors"
                    >
                      <span>Voir le document complet</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="space-y-3.5 py-1">
            <div className="rounded-xl border border-ink-100 bg-paper-50/60 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-ink-900">
                <ShieldCheck size={16} className="text-lime-700" />
                <span>Cloisonnement multi-sociétés</span>
              </div>
              <p className="text-ink-500 leading-relaxed text-[11px]">
                Vos requêtes s&apos;exécutent sous contrôle strict de sécurité Row-Level Security (RLS). Aucune information d&apos;une autre société ne peut être divulguée.
              </p>
            </div>

            <div className="rounded-xl border border-ink-100 bg-paper-50/60 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-ink-900">
                <Lock size={15} className="text-amber-600" />
                <span>Filtrage par rôle & visibilité</span>
              </div>
              <p className="text-ink-500 leading-relaxed text-[11px]">
                Le moteur filtre les documents autorisés selon votre rôle (Public, Entreprise, Département, Restreint).
              </p>
            </div>

            <div className="rounded-xl border border-ink-100 bg-paper-50/60 p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-ink-900">
                <FileText size={15} className="text-blue-600" />
                <span>Preuves & traçabilité</span>
              </div>
              <p className="text-ink-500 leading-relaxed text-[11px]">
                Chaque affirmation de l&apos;assistant s&apos;appuie sur des extraits numérotés vérifiables. En l&apos;absence de source, le système refuse de répondre au lieu d&apos;halluciner.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-57px)] overflow-hidden">
      {sidebar}

      {/* Main chat section (center) */}
      <div className="flex-1 flex flex-col min-w-0 relative bg-paper-50/30 h-full overflow-hidden">
        {/* Top Chat Bar with title, latency and sources toggle */}
        <div className="h-12 border-b border-ink-100/70 bg-white/80 backdrop-blur-xs px-4 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="md:hidden">{mobileHistoryButton}</div>
            <h2 className="text-xs sm:text-sm font-semibold text-ink-900 truncate">
              {conversationTitle}
            </h2>
            {latestAssistantMessage?.latencyMs && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-ink-500 font-mono bg-paper-100 px-2 py-0.5 rounded-full border border-ink-100">
                <Zap size={11} className="text-amber-500" />
                {latestAssistantMessage.latencyMs} ms
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSourcesPanelOpen((prev) => !prev)}
              className={`hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                sourcesPanelOpen
                  ? "bg-lime-50 text-lime-800 border-lime-300 font-semibold shadow-2xs"
                  : "bg-white text-ink-600 hover:text-ink-950 border-ink-100 hover:bg-paper-50"
              }`}
              title={sourcesPanelOpen ? "Masquer le volet des sources" : "Afficher les sources et le contexte"}
            >
              <FileText size={13} className={sourcesPanelOpen ? "text-lime-700" : "text-ink-400"} />
              <span>Sources</span>
              {currentCitations.length > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-bold bg-lime-500 text-ink-950">
                  {currentCitations.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Messages Area — overflow-y-auto on FULL WIDTH */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto w-full px-4 sm:px-6 py-6"
        >
          <div className="max-w-3xl mx-auto space-y-6">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-20 gap-2 text-ink-400 text-sm">
                <Loader2 size={18} className="animate-spin text-lime-600" />
                <span>Chargement de la conversation…</span>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] sm:max-w-[85%] ${msg.role === "user" ? "order-2" : ""}`}>
                    <div
                      className={`rounded-2xl px-4 py-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-ink-950 text-white rounded-br-sm shadow-sm"
                          : msg.refusal
                          ? "bg-amber-50 text-amber-950 border border-amber-200 rounded-bl-sm"
                          : "bg-white text-ink-900 border border-ink-100 rounded-bl-sm shadow-2xs"
                      }`}
                    >
                      {msg.role === "assistant" && !msg.refusal
                        ? renderAnswer(msg.content, msg.citations ?? [])
                        : msg.content}
                    </div>

                    {/* Citations Preview Accordion below message */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                            Sources citées ({msg.citations.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => setSourcesPanelOpen(true)}
                            className="hidden lg:inline-flex items-center gap-1 text-[11px] font-medium text-lime-700 hover:text-lime-800 hover:underline"
                          >
                            <span>Inspecter dans le volet</span>
                            <ExternalLink size={10} />
                          </button>
                        </div>
                        {msg.citations.map((c) => {
                          const key = `${i}-${c.sourceIndex}`;
                          const isExpanded = expanded === key;
                          const isSnippetFull = !!expandedSnippets[key];
                          const isDeleted = c.documentStatus === "deleted" || c.versionStatus === "deleted";
                          const userMsg = messages[i - 1]?.role === "user" ? messages[i - 1].content : undefined;
                          const keywords = getQuestionKeywords(userMsg);

                          return (
                            <div
                              key={c.sourceIndex}
                              className={`group/source rounded-xl border text-xs transition-all duration-200 ${
                                isExpanded
                                  ? "border-lime-400 bg-lime-50/20 shadow-xs ring-1 ring-lime-400/40"
                                  : "border-ink-100 bg-white hover:border-lime-300 hover:bg-paper-50/50"
                              }`}
                            >
                              <div
                                onClick={() => setExpanded(isExpanded ? null : key)}
                                className="flex items-center justify-between p-2.5 cursor-pointer select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime-100 text-[11px] font-bold text-lime-800 group-hover/source:bg-lime-400 transition-colors">
                                    {c.sourceIndex}
                                  </span>
                                  <span className="font-semibold text-ink-900 truncate" title={c.documentTitle}>
                                    {c.documentTitle}
                                  </span>
                                  <span className="shrink-0 text-ink-400 text-[11px]">v{c.versionNumber}</span>
                                  {c.pageNumber && (
                                    <span className="shrink-0 text-ink-400 text-[11px]">p.{c.pageNumber}</span>
                                  )}
                                  {isDeleted && (
                                    <span className="shrink-0 text-red-600 bg-red-50 text-[10px] px-1.5 py-0.5 rounded border border-red-200">
                                      Supprimé
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                  <ChevronDown
                                    size={14}
                                    className={`text-ink-400 transition-transform duration-200 ${
                                      isExpanded ? "rotate-180 text-lime-700" : ""
                                    }`}
                                  />
                                  {!isDeleted && (
                                    <a
                                      href={previewUrl(c)}
                                      onClick={(e) => e.stopPropagation()}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 text-ink-400 hover:text-lime-700 transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-500 rounded"
                                      title="Ouvrir le document au passage utilisé"
                                    >
                                      <ExternalLink size={13} strokeWidth={2} />
                                    </a>
                                  )}
                                </div>
                              </div>

                              {/* Hierarchical Preview with smooth height transition */}
                              <div
                                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                                  isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                                }`}
                              >
                                <div className="overflow-hidden">
                                  <div className="px-3 pb-3 pt-1 border-t border-ink-100/60">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5 mt-1">
                                      Extrait cité
                                    </p>
                                    <div className="border-l-2 border-lime-400 bg-paper-100 p-3 rounded-r-lg text-ink-800">
                                      <p
                                        className={`text-[12px] leading-relaxed italic ${
                                          isSnippetFull ? "" : "line-clamp-3"
                                        }`}
                                      >
                                        &ldquo;{renderHighlightedSnippet(c.snippetText, keywords)}&rdquo;
                                      </p>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedSnippets((prev) => ({
                                            ...prev,
                                            [key]: !prev[key],
                                          }));
                                        }}
                                        className="mt-1.5 text-[11px] font-medium text-lime-700 hover:text-lime-800 hover:underline outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-lime-500 rounded cursor-pointer"
                                      >
                                        {isSnippetFull ? "Voir moins" : "Voir plus"}
                                      </button>
                                    </div>
                                    {!isDeleted && (
                                      <div className="mt-2 text-right">
                                        <a
                                          href={previewUrl(c)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-lime-700 hover:text-lime-800 hover:underline transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 rounded"
                                        >
                                          Voir le document complet →
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions (Feedback, Copier) + Latency */}
                    {msg.role === "assistant" && !msg.refusal && (
                      <div className="flex items-center justify-between gap-3 mt-2 px-1">
                        <div className="flex items-center gap-1.5">
                          {msg.messageId && (
                            <>
                              <button
                                onClick={() => sendFeedback(i, "useful")}
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 ${
                                  msg.feedback === "useful"
                                    ? "bg-lime-100 text-lime-700 ring-1 ring-lime-400 font-semibold"
                                    : "text-ink-400 hover:bg-paper-200 hover:text-ink-700"
                                }`}
                                title="Réponse utile"
                              >
                                <ThumbsUp size={13} strokeWidth={2} />
                                <span className="text-[11px]">Utile</span>
                              </button>
                              <button
                                onClick={() => sendFeedback(i, "not_useful")}
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                                  msg.feedback === "not_useful"
                                    ? "bg-red-100 text-red-700 ring-1 ring-red-400 font-semibold"
                                    : "text-ink-400 hover:bg-paper-200 hover:text-ink-700"
                                }`}
                                title="Réponse inexacte ou incomplète"
                              >
                                <ThumbsDown size={13} strokeWidth={2} />
                                <span className="text-[11px]">Inexact</span>
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleCopy(i, msg.content)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-400 hover:bg-paper-200 hover:text-ink-700 transition-colors ml-1 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300"
                            title="Copier la réponse"
                          >
                            {copiedMessageIndex === i ? (
                              <>
                                <Check size={13} className="text-lime-600" />
                                <span className="text-[11px] text-lime-700 font-medium">Copié !</span>
                              </>
                            ) : (
                              <>
                                <Copy size={13} strokeWidth={2} />
                                <span className="text-[11px]">Copier</span>
                              </>
                            )}
                          </button>
                        </div>
                        {msg.latencyMs != null && (
                          <span className="text-[10px] text-ink-300 font-mono" title="Temps de réponse de l'IA">
                            {msg.latencyMs} ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Typing Indicator during generation */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-ink-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-2xs flex items-center gap-3 text-sm text-ink-600">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-lime-500 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-lime-500 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-lime-500 animate-bounce" />
                  </div>
                  <span className="text-xs font-medium text-ink-500">
                    {loadingPhase === "retrieving"
                      ? "Recherche dans vos documents…"
                      : "Génération de la réponse…"}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Floating Scroll-to-bottom Button */}
        {showScrollBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-20 right-6 md:right-8 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white border border-ink-100 shadow-md text-ink-600 hover:text-ink-950 hover:bg-paper-100 transition-all hover:scale-105 active:scale-95 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
            title="Défiler vers le bas"
          >
            <ChevronDown size={18} strokeWidth={2.5} />
          </button>
        )}

        {/* Sticky Input Bar */}
        <div className="border-t border-ink-100 bg-white/95 backdrop-blur-xs px-4 py-3 shrink-0">
          <div className="max-w-3xl mx-auto">
            {inputForm}
          </div>
        </div>
      </div>

      {/* Right-Hand Sources & Context Panel */}
      {sourcesPanelOpen && (
        <div className="hidden lg:flex w-80 xl:w-96 border-l border-ink-100 bg-white flex-col shrink-0 h-full overflow-hidden shadow-2xs">
          {rightSourcesPanel}
        </div>
      )}
    </div>
  );
}
