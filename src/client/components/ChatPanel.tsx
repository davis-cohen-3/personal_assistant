import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { useConversations } from "@/hooks/useConversations";
import { fetchApi } from "@/lib/fetchApi";
import type { ChatMessage, WsServerMessage } from "../../shared/types.js";

interface Props {
  conversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onNewChat: (id: string) => void;
  onAgentDone: (toolNames: string[]) => void;
  onTitleUpdate: () => void;
  conversationsHook: ReturnType<typeof useConversations>;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

export default function ChatPanel({
  conversationId,
  onSelectConversation,
  onNewChat,
  onAgentDone,
  onTitleUpdate,
  conversationsHook,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [toolsUsed, setToolsUsed] = useState<{ id: string; name: string }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const toolIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(BACKOFF_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingIntentionallyRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { conversations, createConversation, deleteConversation } = conversationsHook;

  // Stable refs for callbacks
  const onAgentDoneRef = useRef(onAgentDone);
  const onTitleUpdateRef = useRef(onTitleUpdate);
  onAgentDoneRef.current = onAgentDone;
  onTitleUpdateRef.current = onTitleUpdate;

  // Auto-scroll when messages or tools change
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional scroll triggers
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, toolsUsed.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load message history when conversationId changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    fetchApi(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data: { messages: { role: "user" | "assistant" | "system"; content: string }[] }) => {
        setMessages(
          data.messages.map((m, i) => ({ id: `hist-${i}`, role: m.role, text: m.content })),
        );
      })
      .catch((err: unknown) => {
        console.error("Failed to load conversation history", { conversationId, error: err });
      })
      .finally(() => setLoading(false));
  }, [conversationId]);

  const openSocket = useCallback((convId: string) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${window.location.host}/ws?conversationId=${convId}`);
    wsRef.current = socket;

    socket.onmessage = (event: MessageEvent<string>) => {
      const data = JSON.parse(event.data) as WsServerMessage;

      if (data.type === "tool_status") {
        const id = `tool-${++toolIdRef.current}`;
        setToolsUsed((prev) => [...prev, { id, name: data.displayName }]);
        setMessages((prev) => prev.filter((m) => !m.streaming));
      } else if (data.type === "text_delta") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, text: last.text + data.content }];
          }
          return [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text: data.content, streaming: true },
          ];
        });
      } else if (data.type === "text_done") {
        setToolsUsed((prevTools) => {
          const toolNames = prevTools.map((t) => t.name);
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => !m.streaming);
            return [
              ...withoutStreaming,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                text: data.content,
                tools: toolNames.length > 0 ? toolNames : undefined,
              },
            ];
          });
          onAgentDoneRef.current(toolNames);
          return [];
        });
        setLoading(false);
      } else if (data.type === "error") {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "system", text: data.message },
        ]);
        setLoading(false);
        setToolsUsed([]);
      } else if (data.type === "conversation_updated") {
        onTitleUpdateRef.current();
      }
    };

    socket.onopen = () => {
      setConnectionLost(false);
      backoffRef.current = BACKOFF_BASE_MS;
    };

    socket.onclose = (event: CloseEvent) => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }

      if (closingIntentionallyRef.current) {
        closingIntentionallyRef.current = false;
        return;
      }

      if (convId !== activeConversationIdRef.current) {
        return;
      }

      if (event.code === 1000) {
        return;
      }

      console.warn("WebSocket closed unexpectedly", {
        code: event.code,
        wasClean: event.wasClean,
        convId,
      });
      setConnectionLost(true);
      const delay = Math.min(backoffRef.current, BACKOFF_MAX_MS);
      backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
      reconnectTimerRef.current = setTimeout(() => {
        if (convId === activeConversationIdRef.current) {
          openSocket(convId);
        }
      }, delay);
    };
  }, []);

  // Manage WebSocket — one per conversation
  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    if (!conversationId) return;

    backoffRef.current = BACKOFF_BASE_MS;
    openSocket(conversationId);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      closingIntentionallyRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [conversationId, openSocket]);

  const send = useCallback(
    (content: string) => {
      if (loading) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not open, cannot send", {
          readyState: wsRef.current?.readyState,
          convId: activeConversationIdRef.current,
        });
        setConnectionLost(true);
        return;
      }
      wsRef.current.send(JSON.stringify({ type: "chat", content }));
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: content }]);
      setInput("");
      setLoading(true);
      setToolsUsed([]);
    },
    [loading],
  );

  const handleReconnect = useCallback(() => {
    if (!conversationId) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    closingIntentionallyRef.current = true;
    wsRef.current?.close();
    wsRef.current = null;
    backoffRef.current = BACKOFF_BASE_MS;
    setLoading(false);
    openSocket(conversationId);
  }, [conversationId, openSocket]);

  const handleNewChat = async () => {
    const conversation = await createConversation();
    onNewChat(conversation.id);
    setDropdownOpen(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteConversation(id);
    if (conversationId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      onSelectConversation(remaining.length > 0 ? remaining[0].id : null);
    }
    setDropdownOpen(false);
  };

  const activeTitle = conversations.find((c) => c.id === conversationId)?.title ?? "Select chat";

  return (
    <div className="w-[380px] border-l border-border flex flex-col h-full shrink-0 bg-card">
      {/* Header with conversation dropdown */}
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2" ref={dropdownRef}>
        <div className="flex-1 relative">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background text-foreground px-3 py-1.5 text-[13px] hover:bg-muted/50 transition-colors"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="truncate font-medium">{activeTitle}</span>
            <svg
              aria-hidden="true"
              className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto py-1">
              {conversations.map((conv) => (
                <button
                  type="button"
                  key={conv.id}
                  className={`group w-full text-left px-3 py-2 text-[13px] hover:bg-muted flex items-center justify-between transition-colors ${
                    conv.id === conversationId ? "bg-accent" : ""
                  }`}
                  onClick={() => {
                    onSelectConversation(conv.id);
                    setDropdownOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{conv.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(conv.updated_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 rounded shrink-0 ml-2 transition-opacity"
                    onClick={(e) => handleDelete(e, conv.id)}
                    aria-label="Delete conversation"
                  >
                    <svg
                      aria-hidden="true"
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </button>
              ))}
              {conversations.length === 0 && (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">No conversations yet</p>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="shrink-0 w-8 h-8 rounded-lg border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="New chat"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {connectionLost && (
        <div className="bg-destructive/5 text-destructive text-[12px] px-3 py-1.5 flex items-center justify-between border-b border-destructive/10">
          <span>Connection lost</span>
          <Button variant="outline" size="sm" onClick={handleReconnect} className="h-6 text-[11px]">
            Reconnect
          </Button>
        </div>
      )}

      {/* Messages */}
      {!conversationId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
              />
            </svg>
          </div>
          <p className="text-[13px]">Start a new chat</p>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {loading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <Spinner />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <p className="text-muted-foreground text-[13px]">Ready when you are.</p>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2 text-[13px] leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : msg.role === "system"
                            ? "bg-destructive/10 text-destructive border border-destructive/20"
                            : "bg-secondary text-secondary-foreground"
                      } ${msg.streaming ? "opacity-70" : ""}`}
                    >
                      {msg.tools && msg.tools.length > 0 && (
                        <details className="mb-2 text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground transition-colors">
                            Used {msg.tools.length} {msg.tools.length === 1 ? "tool" : "tools"}
                          </summary>
                          <ul className="mt-1 ml-3 space-y-0.5">
                            {msg.tools.map((tool) => (
                              <li key={tool}>{tool}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {msg.role === "assistant" ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => (
                              <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-[14px] font-bold mt-3 mb-1">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-[13px] font-bold mt-2 mb-1">{children}</h3>
                            ),
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => (
                              <ul className="list-disc ml-4 mb-2">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal ml-4 mb-2">{children}</ol>
                            ),
                            li: ({ children }) => <li className="mb-0.5">{children}</li>,
                            strong: ({ children }) => (
                              <strong className="font-semibold">{children}</strong>
                            ),
                            code: ({ children, className }) =>
                              className ? (
                                <pre className="bg-background/40 rounded-md p-2 my-2 overflow-x-auto text-[11px]">
                                  <code>{children}</code>
                                </pre>
                              ) : (
                                <code className="bg-background/40 rounded px-1 py-0.5 text-[11px]">
                                  {children}
                                </code>
                              ),
                            table: ({ children }) => (
                              <table className="border-collapse my-2 text-[11px] w-full">
                                {children}
                              </table>
                            ),
                            th: ({ children }) => (
                              <th className="border border-border px-2 py-1 text-left font-semibold bg-background/50">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="border border-border px-2 py-1">{children}</td>
                            ),
                            hr: () => <hr className="my-3 border-border" />,
                            a: ({ children, href }) => (
                              <a
                                href={href}
                                className="underline text-primary hover:text-primary/80"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}
                {loading && toolsUsed.length > 0 && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] bg-secondary">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[12px] font-medium">Working...</span>
                      </div>
                      <ul className="mt-1.5 text-[11px] text-muted-foreground space-y-0.5 ml-3.5">
                        {toolsUsed.map((tool, idx) => (
                          <li
                            key={tool.id}
                            className={idx === toolsUsed.length - 1 ? "animate-pulse" : ""}
                          >
                            {idx === toolsUsed.length - 1 ? "\u25CF" : "\u2713"} {tool.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {loading && toolsUsed.length === 0 && messages.length > 0 && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] bg-secondary">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[12px] font-medium">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <form
            className="px-3 py-3 border-t border-border"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && input.trim()) send(input.trim());
            }}
          >
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-border bg-background text-foreground px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 placeholder:text-muted-foreground"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                disabled={loading}
              />
              <Button
                type="submit"
                size="sm"
                disabled={loading || !input.trim()}
                className="rounded-lg px-4"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
