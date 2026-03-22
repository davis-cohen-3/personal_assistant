import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchApi } from "@/lib/fetchApi";
import type { ChatMessage, WsServerMessage } from "../../shared/types.js";

interface Props {
  conversationId: string | null;
  onAgentDone: () => void;
  onTitleUpdate: () => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export default function Chat({ conversationId, onAgentDone, onTitleUpdate }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [toolsUsed, setToolsUsed] = useState<{ id: string; name: string }[]>([]);
  const toolIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(BACKOFF_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingIntentionallyRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);

  // Stable refs for callbacks — prevents openSocket from changing identity
  // when parent re-renders (which would tear down the WebSocket via effect cleanup)
  const onAgentDoneRef = useRef(onAgentDone);
  const onTitleUpdateRef = useRef(onTitleUpdate);
  onAgentDoneRef.current = onAgentDone;
  onTitleUpdateRef.current = onTitleUpdate;

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
        // Clear any streaming text — it's intermediate (pre-tool)
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
          return [];
        });
        setLoading(false);
        onAgentDoneRef.current();
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
      // Only null out the ref if it still points to THIS socket.
      // When switching conversations, socket B may already be assigned
      // before socket A's onclose fires (async). Without this check,
      // socket A's onclose would clobber socket B's reference.
      if (wsRef.current === socket) {
        wsRef.current = null;
      }

      // Intentional close (conversation switch / unmount) — don't reconnect
      if (closingIntentionallyRef.current) {
        closingIntentionallyRef.current = false;
        return;
      }

      // Stale close — user already switched to a different conversation
      if (convId !== activeConversationIdRef.current) {
        return;
      }

      // Normal close (code 1000) — server intentionally closed, no reconnect
      if (event.code === 1000) {
        return;
      }

      // Unexpected close — reconnect with backoff
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

  // Empty state — no conversation selected
  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-muted-foreground">
        Select a conversation or start a new chat
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full">
      {connectionLost && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-2 flex items-center justify-between">
          <span>Connection lost</span>
          <Button variant="outline" size="sm" onClick={handleReconnect}>
            Reconnect
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-muted-foreground">Ready when you are.</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`message flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : msg.role === "system"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted"
                  } ${msg.streaming ? "opacity-80" : ""}`}
                >
                  {msg.tools && msg.tools.length > 0 && (
                    <details className="mb-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">
                        Thinking ({msg.tools.length} {msg.tools.length === 1 ? "tool" : "tools"})
                      </summary>
                      <ul className="mt-1 ml-4 space-y-0.5">
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
                          <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>
                        ),
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc ml-4 mb-2">{children}</ul>,
                        ol: ({ children }) => (
                          <ol className="list-decimal ml-4 mb-2">{children}</ol>
                        ),
                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        strong: ({ children }) => (
                          <strong className="font-semibold">{children}</strong>
                        ),
                        code: ({ children, className }) =>
                          className ? (
                            <pre className="bg-background/50 rounded p-2 my-2 overflow-x-auto text-xs">
                              <code>{children}</code>
                            </pre>
                          ) : (
                            <code className="bg-background/50 rounded px-1 py-0.5 text-xs">
                              {children}
                            </code>
                          ),
                        table: ({ children }) => (
                          <table className="border-collapse my-2 text-xs w-full">{children}</table>
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
                            className="underline text-primary"
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
                <div className="max-w-[80%] rounded-lg px-4 py-3 text-sm bg-muted opacity-80">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                    <span>Thinking...</span>
                  </div>
                  <ul className="mt-2 text-xs text-muted-foreground space-y-1 ml-4">
                    {toolsUsed.map((tool, idx) => (
                      <li
                        key={tool.id}
                        className={idx === toolsUsed.length - 1 ? "animate-pulse" : ""}
                      >
                        {idx === toolsUsed.length - 1 ? "●" : "✓"} {tool.name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {loading && toolsUsed.length === 0 && messages.length > 0 && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-4 py-3 text-sm bg-muted opacity-80">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                    <span>Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <form
        className="p-4 border-t"
        onSubmit={(e) => {
          e.preventDefault();
          if (!loading && input.trim()) send(input.trim());
        }}
      >
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
