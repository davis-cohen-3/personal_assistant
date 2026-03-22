import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchApi } from "@/lib/fetchApi";

interface Message {
  gmail_message_id: string;
  from: string;
  date: string;
  body_text: string;
}

interface Thread {
  id: string;
  subject: string;
  messages: Message[];
}

interface Props {
  threadId: string;
  onClose: () => void;
  onTrash: () => void;
}

export default function ThreadDetail({ threadId, onClose, onTrash }: Props) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [replySent, setReplySent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(
    async (markRead: boolean) => {
      setLoading(true);
      try {
        const r = await fetchApi(`/api/gmail/threads/${threadId}`);
        const data: Thread = await r.json();
        setThread(data);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
        if (markRead) {
          const latest = data.messages[data.messages.length - 1];
          if (latest) {
            fetchApi(`/api/gmail/messages/${latest.gmail_message_id}/read`, {
              method: "POST",
            }).catch((err: unknown) => {
              console.error("Failed to mark message as read", { error: err });
            });
          }
        }
      } catch (err) {
        console.error("Failed to load thread", { threadId, error: err });
      } finally {
        setLoading(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    fetchThread(true);
  }, [fetchThread]);

  const handleReply = async () => {
    if (!thread || !replyBody.trim()) return;
    const lastMessage = thread.messages[thread.messages.length - 1];
    setSending(true);
    try {
      await fetchApi(`/api/gmail/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody, messageId: lastMessage.gmail_message_id }),
      });
      setReplyBody("");
      setReplySent(true);
      setTimeout(() => setReplySent(false), 3000);
      await fetchThread(false);
    } catch (err) {
      console.error("Failed to send reply", { error: err });
    } finally {
      setSending(false);
    }
  };

  const handleTrash = async () => {
    try {
      await fetchApi(`/api/gmail/threads/${threadId}/trash`, { method: "POST" });
      onTrash();
    } catch (err) {
      console.error("Failed to trash thread", { threadId, error: err });
    }
  };

  return (
    <div className="px-6 py-4">
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold truncate pr-4 text-foreground">
              {thread?.subject ?? "Loading\u2026"}
            </h4>
            <div className="flex gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleTrash}>
                Trash
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {thread?.messages.map((msg) => (
              <div key={msg.gmail_message_id} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{msg.from}</span>
                  <span>{new Date(msg.date).toLocaleString()}</span>
                </div>
                <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
                  {msg.body_text}
                </pre>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {replySent && <div className="text-xs text-emerald-400 font-medium">Reply sent</div>}
            <textarea
              className="w-full rounded-md border border-border bg-background text-foreground px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              rows={2}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a reply\u2026"
            />
            <Button
              onClick={handleReply}
              disabled={sending || !replyBody.trim()}
              size="sm"
              className="h-7 text-xs"
            >
              {sending ? "Sending\u2026" : "Reply"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
