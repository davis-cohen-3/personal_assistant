import { useCallback, useEffect, useRef, useState } from "react";
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
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(BACKOFF_BASE_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingIntentionallyRef = useRef(false);
  const cleanCloseCountRef = useRef(0);
  const MAX_CLEAN_RECONNECTS = 3;

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

  const openSocket = useCallback(
    (convId: string) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(
        `${proto}://${window.location.host}/ws?conversationId=${convId}`,
      );
      wsRef.current = socket;

      socket.onmessage = (event: MessageEvent<string>) => {
        const data = JSON.parse(event.data) as WsServerMessage;

        if (data.type === "text_delta") {
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
          setMessages((prev) => {
            const withoutStreaming = prev.filter((m) => !m.streaming);
            return [
              ...withoutStreaming,
              { id: crypto.randomUUID(), role: "assistant", text: data.content },
            ];
          });
          setLoading(false);
          onAgentDone();
        } else if (data.type === "error") {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "system", text: data.message },
          ]);
          setLoading(false);
        } else if (data.type === "conversation_updated") {
          onTitleUpdate();
        }
      };

      socket.onopen = () => {
        setConnectionLost(false);
        backoffRef.current = BACKOFF_BASE_MS;
        cleanCloseCountRef.current = 0;
      };

      socket.onclose = (event: CloseEvent) => {
        wsRef.current = null;
        setLoading(false);
        if (closingIntentionallyRef.current) {
          closingIntentionallyRef.current = false;
          return;
        }
        if (event.wasClean && cleanCloseCountRef.current < MAX_CLEAN_RECONNECTS) {
          // Clean close (e.g. after agent response) — reconnect immediately
          cleanCloseCountRef.current++;
          openSocket(convId);
        } else if (!event.wasClean || cleanCloseCountRef.current >= MAX_CLEAN_RECONNECTS) {
          // Unclean close (server down) — backoff and show banner
          setConnectionLost(true);
          const delay = Math.min(backoffRef.current, BACKOFF_MAX_MS);
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          reconnectTimerRef.current = setTimeout(() => {
            openSocket(convId);
          }, delay);
        }
      };
    },
    [onAgentDone, onTitleUpdate],
  );

  // Manage WebSocket — one per conversation
  useEffect(() => {
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
      if (!wsRef.current || loading) return;
      wsRef.current.send(JSON.stringify({ type: "chat", content }));
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: content }]);
      setInput("");
      setLoading(true);
    },
    [loading],
  );

  const handleReconnect = useCallback(() => {
    if (!conversationId) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    backoffRef.current = BACKOFF_BASE_MS;
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
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <p className="text-muted-foreground">Ready when you are.</p>
            <Button onClick={() => send("Start my day")}>Start Day</Button>
          </div>
        ) : (
          messages.map((msg) => (
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
                {msg.text}
              </div>
            </div>
          ))
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
